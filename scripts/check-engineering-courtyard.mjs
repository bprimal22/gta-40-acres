import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

registerHooks({
  resolve(s,c,next) {
    if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)) {
      const u=new URL(`${s}.ts`,c.parentURL);
      if(existsSync(u))return {url:u.href,shortCircuit:true};
    }
    return next(s,c);
  },
  load(url,c,next) {
    if(!url.endsWith('.ts'))return next(url,c);
    return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),
      {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
  },
});
const {buildEngineeringCourtyard,engineeringCourtPoint:point,engineeringCourtLocal:local}=await import('../lib/campus/engineering-courtyard.ts');
const {buildEngineeringPaths,engineeringStair}=await import('../lib/campus/engineering-paths.ts');
const {Terrain}=await import('../lib/campus/terrain.ts');
const terrain=new Terrain(JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url))));
const material=new T.MeshStandardMaterial();
const routes=buildEngineeringPaths((x,z)=>terrain.height(x,z)+.04,material);
const court=buildEngineeringCourtyard(routes.routes[0].height,routes.materials[0],material);
// Explicit witnesses in formerly exposed EER returns and PMA towers must now
// be replaced. Ground outside each footprint and the atrium approach stay open.
for(const [s,t,y] of [[160,20,25],[140,-25,25],[170,0,25],[25,-70,35],[100,-80,35]]){
  const p=point(s,t,y);
  assert(court.volumes.some(v=>v.planes.every(plane=>plane.distanceToPoint(p)<0)),`Retained scan in reconstructed building ${s},${t}`);
}
for(const m of court.materials.filter(m=>/EER.*stone|PMA/.test(m.name)))assert.equal(m.map,null,'Authored architecture must not use scan texture maps');
assert.equal(court.stats.pmaTowers,2);
await RAPIER.init();
const world=new RAPIER.World({x:0,y:-24,z:0}),scene=new T.Group();scene.add(...court.meshes);
scene.updateWorldMatrix(true,true);
for(const g of court.colliderGeometries)world.createCollider(RAPIER.ColliderDesc.trimesh(
  g.attributes.position.array,g.index?new Uint32Array(g.index.array):Uint32Array.from({length:g.attributes.position.count},(_,i)=>i),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
world.step();
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0);
let groundSamples=0,maxDisagreement=0;
// Dense independent sample lines cover both sidewalk edges, both crossings,
// the entire lawn center, and the entrance apron. Decorations are off these lines.
const samples=[];
for(const t of [-10.7,-9.5,-8.2,0,8.2,9.5,10.7])for(let s=-3;s<115;s+=.67)samples.push([s,t]);
for(const s of [18,54,86])for(let t=-11;t<11.8;t+=.37)samples.push([s,t]);
for(const [s,t] of samples) {
  const p=point(s,t),expected=s>=96?7.15:court.height(s,t);p.y=expected+1.2;
  ray.set(p,down);ray.far=3;
  const shown=ray.intersectObject(scene,true)[0],hit=world.castRay(new RAPIER.Ray(p,down),3,true);
  assert(shown&&hit,`Missing floor ${s},${t}`);
  assert(shown.face.normal.y>.85,`Invalid walkable normal ${s},${t}`);
  const error=Math.abs(shown.point.y-(p.y-hit.timeOfImpact));maxDisagreement=Math.max(maxDisagreement,error);
  assert(error<.003,`Visual/physics mismatch ${s},${t}: ${error}`);
  assert(Math.abs(shown.point.y-expected)<.12,`Unexpected obstacle ${s},${t}`);groundSamples++;
}
// Source clearance must not erase the established southern walk or GLT stair.
for(const [x,z] of [engineeringStair.upper,engineeringStair.lower,[119.5,-190],[80,-230.5]]) {
  const p=new T.Vector3(x,8,z);
  assert(!court.volumes.some(v=>v.planes.every(plane=>plane.distanceToPoint(p)<=0)),`Clearance escaped courtyard at ${x},${z}`);
}
for(const tree of court.trees) {
  const p=local(tree.x,tree.z);
  assert(Math.abs(p.t)<7.4&&Math.abs(p.t)>6.4,'Tree must sit in planting strip');
  assert(!court.paved(p.s,p.t),'Tree obstructs a cross-path');
  assert(Math.min(Math.abs(p.s-18),Math.abs(p.s-54))>3,'Trunk too near cross-path');
}
// Replay ordinary kinematic movement along each complete walk. This catches
// seams that downward rays alone miss when the capsule crosses a triangle edge.
const replays=[];
for(const t of [-9.5,9.5]) {
  const p=point(-2,t,court.height(-2,t)+.905);
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,p.y,p.z));
  const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body);
  const controller=world.createCharacterController(.025);
  controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);
  controller.setMaxSlopeClimbAngle(Math.PI/4);world.step();
  const d=point(1,0).sub(point(0,0)).multiplyScalar(3.5/60);
  for(let i=0;i<2100;i++) {
    controller.computeColliderMovement(capsule,{x:d.x,y:-.035,z:d.z});
    const move=controller.computedMovement(),now=body.translation();
    body.setNextKinematicTranslation({x:now.x+move.x,y:now.y+move.y,z:now.z+move.z});world.step();
    if(local(body.translation().x,body.translation().z).s>=110)break;
  }
  const end=body.translation(),position=local(end.x,end.z);
  assert(position.s>=110,`Walk blocked at ${position.s} on side ${t}`);
  assert(end.y>7&&end.y<9,'Character lost floor support');
  replays.push({side:t,along:position.s,height:end.y});
  world.removeCharacterController(controller);world.removeRigidBody(body);
}
const report={passed:true,groundSamples,maxDisagreement,trees:court.trees.length,replays,stats:court.stats,
  limits:'Offline geometry and capsule checks. Streamed tile seams and final appearance require live visual review.'};
writeFileSync(new URL('../evidence/engineering-courtyard-check.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));world.free();
