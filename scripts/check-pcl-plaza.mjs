import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';
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
const {buildPclPlaza,pclPlazaOutline,inPclPlaza}=await import('../lib/campus/pcl-plaza.ts');
const {pclMaterials}=await import('../lib/campus/pcl-materials.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const {Terrain}=await import('../lib/campus/terrain.ts');
const {characterSupported}=await import('../lib/campus/character-support.ts');
const data=JSON.parse(readFileSync('public/data/campus.json'));
const terrain=new Terrain(JSON.parse(readFileSync('public/data/terrain.json')));
const m=pclMaterials(),concrete=new THREE.MeshStandardMaterial();
const plaza=buildPclPlaza(data,(x,z)=>terrain.height(x,z),concrete,m.brick);
await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0});const visual=new THREE.Group();
let triangles=0;
for(const mesh of plaza.meshes){
  visual.add(mesh);const p=mesh.geometry.attributes.position;
  assert([...p.array].every(Number.isFinite));triangles+=p.count/3;
  world.createCollider(RAPIER.ColliderDesc.trimesh(p.array,Uint32Array.from({length:p.count},(_,i)=>i),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
}
visual.updateWorldMatrix(true,true);world.step();
const ray=new THREE.Raycaster();let surfaceChecks=0;
function surface(x,z,from=6){
  ray.set(new THREE.Vector3(x,from,z),new THREE.Vector3(0,-1,0));
  const hit=ray.intersectObject(visual,true).find(h=>h.face.normal.y>.5);
  const physical=world.castRay(new RAPIER.Ray({x,y:from,z},{x:0,y:-1,z:0}),20,true);
  assert(hit && physical,`ground or furniture exists at ${x}, ${z}`);
  assert(Math.abs(hit.point.y-(from-physical.timeOfImpact))<.002,'visible/collision surface agreement');
  surfaceChecks++;return hit.point.y;
}
for(const [x,z] of [[-40,299],[-40,310],[-44,333],[-70,324],[-80,332],...plaza.tables])surface(x,z);
const stairRuns=[];
for(const stair of plaza.stairRecords){
  const a=new THREE.Vector3(stair.a[0],0,stair.a[1]),b=new THREE.Vector3(stair.b[0],0,stair.b[1]);
  const u=b.clone().sub(a).normalize(),n=new THREE.Vector3(u.z,0,-u.x);
  for(const t of [.2,.4,.6,.8])for(const side of [-.7,0,.7]){
    const p=a.clone().lerp(b,t).addScaledVector(n,side);surface(p.x,p.z);
  }
  for(const sideOffset of stair.count===3?[-4.8,0,4.8]:[0]) {
  const start=a.clone().addScaledVector(u,-1.5).addScaledVector(n,sideOffset);start.y=surface(start.x,start.z)+.905;
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...start.toArray()));
  const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body);
  const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);
  controller.enableSnapToGround(.38);controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();
  let vertical=0;
  function walk(direction,seconds){
    for(let f=0;f<seconds*60;f++){
      vertical=Math.max(-35,vertical-24/60);
      controller.computeColliderMovement(capsule,{x:u.x*direction*1.65/60,y:vertical/60,z:u.z*direction*1.65/60});
      const from=body.translation(),d=controller.computedMovement();
      if(characterSupported(controller,from.y,vertical) && vertical<0)vertical=0;
      body.setNextKinematicTranslation({x:from.x+d.x,y:from.y+d.y,z:from.z+d.z});world.step();
    }return new THREE.Vector3().copy(body.translation());
  }
  // Auto-stepping spends part of the displacement lifting the capsule; allow
  // that slower ascent instead of assuming a level-ground travel duration.
  const seconds=(a.distanceTo(b)+6)/1.65,up=walk(1,seconds);
  assert(up.clone().sub(b).dot(u)>0,`stair ascent reaches upper landing: ${JSON.stringify(up)}`);
  assert(up.y>start.y+.12,'actual step ascent increases height');
  const returnSeconds=(up.clone().sub(start).dot(u)+.3)/1.65;
  const down=walk(-1,returnSeconds);
  assert(down.clone().sub(a).dot(u)<0,'descent reaches lower approach');
  assert(Math.abs(down.y-start.y)<.12,'descending feet return to ground');
  stairRuns.push({a:stair.a,b:stair.b,count:stair.count,sideOffset,start:start.toArray(),up:up.toArray(),down:down.toArray()});
  world.removeCharacterController(controller);world.removeRigidBody(body);
  }
}
const canopy=new THREE.PlaneGeometry(5,6).translate(-59,7,304);
const cut=subtractVolumes(canopy,new THREE.Matrix4(),plaza.volumes);
assert(cut && cut.attributes.position.count===0,'synthetic canopy inside seating area is removed');
assert(plaza.trees.every(p=>inPclPlaza(p.x,p.z)),'new trees stay in the authored ground region');
const report={surfaceChecks,stairRuns,triangles,tables:plaza.tables.length,lamps:plaza.lamps.length,trees:plaza.trees.length,
  volumes:plaza.volumes.length,outline:pclPlazaOutline,limits:'Authored geometry checks; real browser navigation and source-fragment review remain required.'};
const prefix=process.argv[2]??'plaza-current';assert(/^[a-z0-9-]+$/.test(prefix));
writeFileSync(`evidence/${prefix}-plaza-check.json`,JSON.stringify(report,null,2)+'\n');
console.log('PASS',JSON.stringify(report,null,2));world.free();
