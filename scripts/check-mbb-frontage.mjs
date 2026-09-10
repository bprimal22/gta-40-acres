import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Run the public landscape builder against actual contour terrain. Suppressing
// texture requests removes the browser requirement without changing geometry.
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){
    const u=new URL(`${s}.ts`,c.parentURL);if(existsSync(u))return{url:u.href,shortCircuit:true};
  }return next(s,c);
},load(url,c,next){
  if(!url.endsWith('.ts'))return next(url,c);
  return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
}});
const {SpeedwayWalkway}=await import('../lib/campus/walkway.ts');
const {Terrain}=await import('../lib/campus/terrain.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const {characterSupported}=await import('../lib/campus/character-support.ts');
const prefix=process.argv[2]??'iteration-36';assert(/^[a-z0-9-]+$/.test(prefix),'safe evidence prefix');
const data=JSON.parse(readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const terrain=new Terrain(JSON.parse(readFileSync(new URL('../public/data/terrain.json',import.meta.url))));
await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0});
const textureLoad=Object.getOwnPropertyDescriptor(T.TextureLoader.prototype,'load');assert(textureLoad);
let walkway;
try{
  T.TextureLoader.prototype.load=()=>new T.Texture();
  walkway=new SpeedwayWalkway(data,terrain,world,{capabilities:{getMaxAnisotropy:()=>8}},true);
}finally{Object.defineProperty(T.TextureLoader.prototype,'load',textureLoad);}
walkway.group.updateWorldMatrix(true,true);world.step();
const {mbbPoint}=await import('../lib/campus/mbb-frontage.ts');
const thinEdgeQueries=[];
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),identity=new T.Matrix4(),checks=[],failures=[];
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){checks.push({name,passed:false});failures.push({name,error:e.message});}}
function ground(x,z){
  const y=terrain.height(x,z)+2,origin=new T.Vector3(x,y,z);ray.set(origin,down);ray.far=6;
  const shown=ray.intersectObject(walkway.surfaces,true)[0];
  let solid=world.castRay(new RAPIER.Ray(origin,down),6,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
  if(!solid&&shown){
    // A zero-radius Float32 ray can miss a shared triangle edge. Preserve the
    // failed query, verify it with a 0.1mm sphere, and replay the exact seam with
    // the normal character below. This does not hide a missing support surface.
    const hit=world.castShape(origin,{x:0,y:0,z:0,w:1},down,new RAPIER.Ball(.0001),0,6,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    if(hit&&hit.normal1.y>.8){
      solid={timeOfImpact:hit.time_of_impact+.0001};
      thinEdgeQueries.push({x,z,rayMiss:true,sphereRadius:.0001,witness:hit.witness1,normal:hit.normal1});
    }
  }
  assert(shown&&solid,`missing walking ground at ${x},${z} (render=${JSON.stringify(shown&&{name:shown.object.name,y:shown.point.y,normal:shown.face.normal.toArray()})}, collision=${!!solid})`);
  assert(shown.face.normal.y>.8,`ground does not face upward at ${x},${z}`);
  const disagreement=Math.abs(shown.point.y-(y-solid.timeOfImpact));
  assert(disagreement<.003,`ground/collider disagreement ${disagreement.toFixed(4)}m at ${x.toFixed(3)},${z.toFixed(3)}`);
  return{height:shown.point.y,disagreement,material:shown.object.material,mesh:shown.object.name};
}
function witness(p){
  const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([
    p[0]-.025,p[1]-.025,p[2],p[0]+.025,p[1]-.025,p[2],p[0],p[1]+.025,p[2]+.015],3));
  g.computeVertexNormals();return g;
}
function sourcePatch(name,p,cleared){
  const g=witness(p),trimmed=subtractVolumes(g,identity,walkway.volumes);
  try{
    if(cleared)assert(trimmed&&trimmed.attributes.position.count===0,`${name}: source triangle was not fully removed`);
    else assert(trimmed===null,`${name}: source beyond the repair was changed`);
  }finally{g.dispose();trimmed?.dispose();}
}
function capsuleAt(x,z){
  const y=ground(x,z).height,body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x,y+.905,z));
  const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34).setFriction(0),body);
  const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);
  controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();let vertical=0;
  return{body,step(dx,dz){
    const p=body.translation();vertical=Math.max(-35,vertical-24/60);controller.computeColliderMovement(capsule,{x:dx,y:vertical/60,z:dz});
    const d=controller.computedMovement(),supported=characterSupported(controller,p.y,vertical);if(supported&&vertical<0)vertical=0;
    body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();return supported;
  },dispose(){world.removeCharacterController(controller);world.removeRigidBody(body);world.step();}};
}

const at=(s,t)=>{const p=mbbPoint(s,t);return[p.x,p.z];};
check('MBB garden and service lane have upward visible ground matching physics',()=>{
 let samples=0,maxError=0;
 for(let s=-15;s<42;s+=1.75)for(const t of [6.5,12,16,20,23.3]){
  const g=ground(...at(s,t));samples++;maxError=Math.max(maxError,g.disagreement);
 }
 return{samples,maxError};
});
check('NHB-to-service-lane and Speedway-edge transects have continuous ground',()=>{
 let samples=0,maxIncrement=0;
 for(const t of [10,15,20]){
  let last;
  for(let s=-19;s<-12;s+=.125){
   const g=ground(...at(s,t));if(last!==undefined){maxIncrement=Math.max(maxIncrement,Math.abs(g.height-last));assert(Math.abs(g.height-last)<.15,`service edge jump ${g.height-last} at ${s}/${t}`);}last=g.height;samples++;
  }
 }
 for(const s of [2,13,25,39]){
  let last;
  for(let t=15;t<27;t+=.125){
   const g=ground(...at(s,t));if(last!==undefined){maxIncrement=Math.max(maxIncrement,Math.abs(g.height-last));assert(Math.abs(g.height-last)<.15,`street edge jump ${g.height-last} at ${s}/${t}`);}last=g.height;samples++;
  }
 }
 return{samples,maxIncrement};
});
check('Recorded near-MBB scan fragments are removed and neighboring architecture retained',()=>{
 const removed=[[9.5,7,-200],[11.37,10,-200],[11.63,7,-210],[16.45,10,-220],[12.51,15,-220],[-5.86,20,-200],[-5.41,20,-210],[-17.32,15,-185],[-20,20.2,-185],[-4.87033,12.21271,-178.89543],[-11.89021,16.01244,-178.59222],[-.635936,11.86269,-177.92861],[-1.927712,11.84896,-178.48783],[-.975653,10.91734,-178.10917],[-3.057937,11.77860,-178.59151]];
 removed.forEach((p,i)=>sourcePatch(`MBB observed fragment ${i}`,p,true));
 const retained=[[-12,17,-185],[-26,17,-185],[-30,21,-185],[40,15,-200],[42,15,-220],[-35,15,-210],[4,22,-270]];
 retained.forEach((p,i)=>sourcePatch(`retained bridge/Patterson/distant-MBB ${i}`,p,false));
 return{removed,retained};
});
check('MBB official front plane has recessed window geometry and solid backing',()=>{
 const samples=[];
 for(const s of [2.15,10.72,23.59]){
  const from=mbbPoint(s,20,10);ray.set(from,new T.Vector3(-.99611,0,-.08813).normalize());ray.far=28;
  const hit=ray.intersectObject(walkway.surfaces,true).find(h=>h.object.name==='MBB recessed glazing');
  assert(hit,'MBB glazing missing');assert(hit.distance>20.2&&hit.distance<20.6,'glazing is not recessed behind the mapped wall');
  const solid=world.castRay(new RAPIER.Ray(from,ray.ray.direction),28,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
  assert(solid&&solid.timeOfImpact>19.8&&solid.timeOfImpact<20.1,'mapped MBB facade lacks solid support');
  samples.push({s,visibleDistance:hit.distance,collisionDistance:solid.timeOfImpact});
 }
 return{samples};
});
check('Glazed bridge has matching roof and soffit with a clear passage below',()=>{
 const p=mbbPoint(-10,-13.4),floor=ground(p.x,p.z).height;
 const records=[];
 for(const [fromY,dy,expected] of [[30,-1,20.15],[floor+2,1,14.10]]){
  const origin=new T.Vector3(p.x,fromY,p.z),direction=new T.Vector3(0,dy,0);
  ray.set(origin,direction);ray.far=30;
  const shown=ray.intersectObject(walkway.surfaces,true)[0];
  const solid=world.castRay(new RAPIER.Ray(origin,direction),30,true);
  assert(shown&&solid,'bridge roof/soffit missing');
  assert(Math.abs(shown.point.y-expected)<.003,'bridge differs from intended source-fit height');
  assert(Math.abs(shown.point.y-(fromY+dy*solid.timeOfImpact))<.003,'bridge collision differs from visible surface');
  records.push({fromY,dy,visible:shown.point.y,collision:fromY+dy*solid.timeOfImpact});
 }
 assert(14.1-floor>7,'bridge does not retain pedestrian clearance');return{floor,clearance:14.1-floor,records};
});
check('Paving visibly continues around the projecting north bay',()=>{
 const samples=[];
 for(const s of [27,29,33,37,41])for(const t of [5.7,6.6]){
  const g=ground(...at(s,t));assert.equal(g.material.name,'MBB concrete walks',`route around bay is not paved at ${s}/${t}`);
  samples.push({s,t,height:g.height});
 }
 return{samples};
});
const routes=[{name:'exact thin-ray seam with finite capsule',points:[at(-19,10),at(-12,10)]},
 {name:'service lane from Speedway and back',points:[at(-10,25),at(-10,12),at(-10,-12)]},
 {name:'paved eastern garden edge and north junction',points:[at(-10,20),at(10,20),at(29,20),at(42,20)]},
 {name:'inner garden walk and return',points:[at(-8,7),at(8,2),at(27,2),at(29,6)]},
 {name:'projecting north bay and return',points:[at(26,2.4),at(26,6.1),at(39,6.1),at(41,6.1),at(41,20)]}];
for(const route of routes)check(`Normal capsule traverses ${route.name}`,()=>{
 const actor=capsuleAt(...route.points[0]);let frames=0,unsupportedFrames=0;const legs=[];
 try{
  for(const [x,z]of[...route.points.slice(1),...route.points.slice(0,-1).reverse()]){
   let remaining=Infinity;
   for(let i=0;i<2500;i++){
    const p=actor.body.translation(),dx=x-p.x,dz=z-p.z;remaining=Math.hypot(dx,dz);if(remaining<.08)break;
    const movement=Math.min(3/60,remaining);if(!actor.step(dx/remaining*movement,dz/remaining*movement))unsupportedFrames++;frames++;
    const q=actor.body.translation();assert(Math.abs(q.y-.905-ground(q.x,q.z).height)<.15,'capsule left visible walking ground');
   }
   assert(remaining<.08,`blocked at ${JSON.stringify(actor.body.translation())}`);legs.push({target:[x,z],end:{...actor.body.translation()}});
  }
  assert.equal(unsupportedFrames,0);return{frames,unsupportedFrames,legs};
 }finally{actor.dispose();}
});
walkway.dispose(world);world.free();
const report={passed:failures.length===0,checks,failures,thinEdgeQueries,limits:['Instantiates the full landscape against actual terrain. Streamed source behavior and tree assets require browser replay.','Witness samples do not establish all source preservation. MBB window heights and terrain grading remain approximate.']};
writeFileSync(new URL(`../evidence/${prefix}-mbb-frontage-check.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,checks:checks.map(({name,passed})=>({name,passed})),failures},null,2));
if(failures.length)process.exitCode=1;
