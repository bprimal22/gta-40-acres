import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
const evidencePrefix=process.argv[2]??'iteration-27';
assert(/^iteration-\d+$/.test(evidencePrefix),'safe evidence prefix');
registerHooks({resolve(s,c,next){
  if(s.startsWith('.') && c.parentURL && !/\.[a-z]+$/i.test(s)){
    const u=new URL(`${s}.ts`,c.parentURL);if(existsSync(u))return {url:u.href,shortCircuit:true};
  }return next(s,c);
},load(url,c,next){
  if(!url.endsWith('.ts'))return next(url,c);
  return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
}});
const {buildCentralMalls}=await import('../lib/campus/central-malls.ts');
const {Terrain}=await import('../lib/campus/terrain.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
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

const points=[[-215,54],[-249,53],[-259,53],[-259,43],[-264,39.65],[-275,38.7],[-285,29.5],[-310,27],[-335,24.8],[-349,22.9],[-375,20.4],[-400,17.9],[-406,26.8],[-411,26.6],[-417,26.15],[-427,25.4],[-420,-63]];
const route=[];
const start=points[0],body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start[0],surface(...start)+.905,start[1]));
const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body);
const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);
controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();
let vertical=0,minimumVertical=0,unsupported=0;
function travel(target,speed){
 const from={...body.translation()};let remaining=Infinity,grounded=false;
 const maxFrames=Math.ceil((Math.hypot(target[0]-from.x,target[1]-from.z)/speed+6)*60);
 for(let f=0;f<maxFrames;f++){
   const p=body.translation(),dx=target[0]-p.x,dz=target[1]-p.z;remaining=Math.hypot(dx,dz);if(remaining<.12)break;
   vertical=Math.max(-35,vertical-24/60);minimumVertical=Math.min(minimumVertical,vertical);
   const step=Math.min(speed/60,remaining);
   controller.computeColliderMovement(capsule,{x:dx/remaining*step,y:vertical/60,z:dz/remaining*step});
   const d=controller.computedMovement();grounded=characterSupported(controller,p.y,vertical);if(!grounded)unsupported++;
   if(grounded&&vertical<0)vertical=0;
   body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();
   assert(p.y>8,'route never falls below reconstructed ground');
 }
 const to={...body.translation()};route.push({target,speed,from,to,grounded,remaining});
 assert(remaining<.12,`route blocked: ${JSON.stringify(route.at(-1))}`);
}
for(const target of points.slice(1))travel(target,1.65);
for(const target of points.slice(0,-1).reverse())travel(target,5.8);
// The low garden curb is within the controller's effective step clearance.
// Verify entering the raised bed and returning without sinking through it.
for(const target of points.slice(1,8))travel(target,5.8);travel([-320,27],1.65);
const before={...body.translation()};for(let i=0;i<78;i++){
 vertical=Math.max(-35,vertical-24/60);controller.computeColliderMovement(capsule,{x:0,y:vertical/60,z:5.8/60});
 const p=body.translation(),d=controller.computedMovement();if(characterSupported(controller,p.y,vertical)&&vertical<0)vertical=0;
 body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();
}
const contact={...body.translation()};assert(contact.z>31.5&&contact.z<36,'garden curb is climbable');
assert(Math.abs(contact.y-(mall.westHeight(contact.x,contact.z)+.23+.905))<.06,'character stands on raised garden surface');travel([-320,27],1.65);
const gardenRetreat={...body.translation()};
world.removeCharacterController(controller);world.removeRigidBody(body);
const pierStart={x:-272.412,z:31.849},pierBody=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(pierStart.x,surface(pierStart.x,pierStart.z)+.905,pierStart.z));
const pierCapsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),pierBody);
const pierController=world.createCharacterController(.025);pierController.enableAutostep(.32,.2,false);pierController.enableSnapToGround(.38);
pierController.setMaxSlopeClimbAngle(Math.PI*.25);pierController.setMinSlopeSlideAngle(Math.PI*.28);world.step();
function pierMove(sign,seconds){let v=0;for(let f=0;f<seconds*60;f++){v-=24/60;const p=pierBody.translation();
 pierController.computeColliderMovement(pierCapsule,{x:sign*5.8*.99652/60,y:v/60,z:sign*5.8*.08336/60});const d=pierController.computedMovement();
 if(characterSupported(pierController,p.y,v)&&v<0)v=0;
 pierBody.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();}return {...pierBody.translation()};}
const pierContact=pierMove(1,2);assert(pierContact.x<-270.1,`limestone pier blocks running: ${JSON.stringify(pierContact)}`);
const pierRetreat=pierMove(-1,.5);assert(pierRetreat.x<pierContact.x-2,'retreat from pier succeeds');
const syntheticCanopy=new T.BoxGeometry(1,6,1).translate(-300,19,27);
const cleared=subtractVolumes(syntheticCanopy,new T.Matrix4(),mall.volumes);
assert(cleared&&cleared.attributes.position.count===0,'old scan canopy removed inside new path');
for(const [label,x,z] of [['circular feature',-394.5,28],['Union interior',-384,-52]]){
 const source=new T.BoxGeometry(1,4,1).translate(x,18,z);
 assert.equal(subtractVolumes(source,new T.Matrix4(),mall.volumes),null,`${label} is preserved`);source.dispose();
}
syntheticCanopy.dispose();cleared.dispose();
// Actual source-ray locations on the Tower west facade. The old .15/.25 m
// footprint exclusions cut these walls, which extend ~1.2 m beyond the map.
// Small synthetic facade patches exercise the real clipper without saving any
// provider geometry. The canopy and route tests above guard useful clearance.
const facadeProbes=[[-254.836,28.839,46.862],[-254.825,26.791,46.965],
 [-253.845,24.735,37.003],[-254.337,24.723,42.041],[-254.826,24.712,47.061],
 [-253.907,22.612,37.018],[-254.302,22.619,42.122],[-254.823,22.607,47.162]];
for(const point of facadeProbes){
 const patch=new T.PlaneGeometry(.1,.1).rotateY(-Math.PI/2).translate(...point);
 assert.equal(subtractVolumes(patch,new T.Matrix4(),mall.volumes),null,`Tower facade preserved at ${point.join(',')}`);patch.dispose();
}
const report={passed:true,surfaceChecks,scanBoundsChecks:3,facadeProbes,route,pier:{pierStart,pierContact,pierRetreat},planter:{before,contact,retreat:gardenRetreat},minimumVertical,unsupported,stats:mall.stats,
 limits:'Authored geometry in Rapier using actual game capsule, gravity and step/slope settings. This does not replace streamed-scene browser play or photographic acceptance.'};
writeFileSync(`evidence/${evidencePrefix}-west-route-check.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));world.free();
