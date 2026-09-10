import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
registerHooks({resolve(s,c,next){
  if(s.startsWith('.') && c.parentURL && !/\.[a-z]+$/i.test(s)){
    const u=new URL(`${s}.ts`,c.parentURL);if(existsSync(u))return {url:u.href,shortCircuit:true};
  }return next(s,c);
},load(url,c,next){
  if(!url.endsWith('.ts'))return next(url,c);
  return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
}});
const {buildCentralMalls,inCentralMall}=await import('../lib/campus/central-malls.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const {Terrain}=await import('../lib/campus/terrain.ts');
const {characterSupported}=await import('../lib/campus/character-support.ts');
const terrain=new Terrain(JSON.parse(readFileSync('public/data/terrain.json')));
const mall=buildCentralMalls(()=>3.05,(x,z)=>terrain.height(x,z),new T.MeshStandardMaterial(),new T.MeshStandardMaterial());
await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0}),visual=new T.Group();
for(const mesh of mall.meshes){
  visual.add(mesh);const p=mesh.geometry.attributes.position;
  assert([...p.array].every(Number.isFinite));
  world.createCollider(RAPIER.ColliderDesc.trimesh(p.array,Uint32Array.from({length:p.count},(_,i)=>i),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
}
visual.updateWorldMatrix(true,true);world.step();
const ray=new T.Raycaster();let surfaceChecks=0;
function surface(x,z,from=35){
  ray.set(new T.Vector3(x,from,z),new T.Vector3(0,-1,0));
  const hit=ray.intersectObject(visual,true).find(h=>h.face.normal.y>.5);
  const physical=world.castRay(new RAPIER.Ray({x,y:from,z},{x:0,y:-1,z:0}),50,true);
  assert(hit && physical,`ground exists at ${x},${z}`);
  assert(Math.abs(hit.point.y-(from-physical.timeOfImpact))<.002,'visible/collision surface agreement');
  surfaceChecks++;return hit.point.y;
}
const stairRuns=[];
for(const stair of mall.stairRecords){
  const a=new T.Vector3(stair.a[0],0,stair.a[1]),b=new T.Vector3(stair.b[0],0,stair.b[1]);
  const u=b.clone().sub(a).normalize(),n=new T.Vector3(u.z,0,-u.x);
  for(const sideOffset of [-stair.width*.32,0,stair.width*.32]){
    const start=a.clone().addScaledVector(u,-1).addScaledVector(n,sideOffset);start.y=surface(start.x,start.z)+.905;
    const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...start.toArray()));
    const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body);
    const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);
    controller.enableSnapToGround(.38);controller.setMaxSlopeClimbAngle(Math.PI*.25);
    controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();
    let vertical=0;
    function walk(direction,seconds,targetProgress){
      for(let f=0;f<seconds*60;f++){
        vertical=Math.max(-35,vertical-24/60);
        controller.computeColliderMovement(capsule,{x:u.x*direction*1.65/60,y:vertical/60,z:u.z*direction*1.65/60});
        const from=body.translation(),d=controller.computedMovement();
        if(characterSupported(controller,from.y,vertical) && vertical<0)vertical=0;
        body.setNextKinematicTranslation({x:from.x+d.x,y:from.y+d.y,z:from.z+d.z});world.step();
        if(targetProgress!==undefined && new T.Vector3().copy(body.translation()).sub(a).dot(u)>=targetProgress)break;
      }return new T.Vector3().copy(body.translation());
    }
    const up=walk(1,(a.distanceTo(b)+7)/1.65,a.distanceTo(b)+1);
    const progress=up.clone().sub(b).dot(u);
    assert(progress>.35,`ascent ${stair.sourceId} side ${sideOffset}: ${JSON.stringify(up)}`);
    assert(up.y>start.y+.3,'ascent gains height');
    const down=walk(-1,(up.clone().sub(start).dot(u)+.15)/1.65);
    assert(down.clone().sub(a).dot(u)<-.35,`descent ${stair.sourceId} reaches approach`);
    assert(Math.abs(down.y-start.y)<.24,`descent ${stair.sourceId} side ${sideOffset} returns to approach height: ${JSON.stringify({start,down})}`);
    stairRuns.push({id:stair.sourceId,sideOffset,start:start.toArray(),up:up.toArray(),down:down.toArray()});
    world.removeCharacterController(controller);world.removeRigidBody(body);
  }
}
// Test the old scan obstruction location and the graded lower-mall risers.
const lowerStart=new T.Vector3(-14,surface(-14,62.7)+.905,62.7);
const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...lowerStart.toArray()));
const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body);
const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);
controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();
let vertical=0;
for(let f=0;f<42*60;f++){
  vertical=Math.max(-35,vertical-24/60);
  controller.computeColliderMovement(capsule,{x:-1.65/60,y:vertical/60,z:-.145/60});
  const p=body.translation(),d=controller.computedMovement();
  if(characterSupported(controller,p.y,vertical) && vertical<0)vertical=0;
  body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();
}
const lowerEnd={...body.translation()};assert(lowerEnd.x<-75,'all 21 lower-mall risers can be walked without jumping');
world.removeCharacterController(controller);world.removeRigidBody(body);
const canopy=new T.BoxGeometry(5,7,12).translate(-30,8,61);
const cut=subtractVolumes(canopy,new T.Matrix4(),mall.volumes);
assert(cut && cut.attributes.position.count===0,'the old canopy obstruction is removed inside repair bounds');
const outside=new T.BoxGeometry(2,10,2).translate(30,15,60);
assert.equal(subtractVolumes(outside,new T.Matrix4(),mall.volumes),null,'unrelated scenery remains untouched');
assert(mall.trees.every(p=>inCentralMall(p.x,p.z)),'authored trees remain in the mapped repair envelope');
const report={stats:mall.stats,surfaceChecks,stairRuns,lowerMall:{start:lowerStart.toArray(),end:lowerEnd},
  limits:'Authored geometry and controller tests only; browser replay and photographic comparison remain required.'};
const evidencePrefix=process.argv[2]??'iteration-26';
assert(/^iteration-\d+$/.test(evidencePrefix));
writeFileSync(`evidence/${evidencePrefix}-central-mall-check.json`,JSON.stringify(report,null,2)+'\n');
console.log('PASS',JSON.stringify(report,null,2));world.free();
