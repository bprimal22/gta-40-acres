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
const {characterSupported}=await import('../lib/campus/character-support.ts');
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

// Regression for the browser fall at the Main east doorway. Deliberately omit
// all streamed tiles: the new entrance must stand on authored continuous ground.
const plan=JSON.parse(readFileSync(new URL('../public/data/main-east-entry-plan.json',import.meta.url)));
const u=new T.Vector2(plan.b[0]-plan.a[0],plan.b[1]-plan.a[1]).normalize(),n=new T.Vector2(...plan.normal),center=new T.Vector2(...plan.a).addScaledVector(u,plan.length/2);
const point=(t,d)=>center.clone().addScaledVector(u,t).addScaledVector(n,d).toArray();
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),checks=[],failures=[];
const floorHandles=new Set(walkway.colliders.map(c=>c.handle));
function ground(x,z){
 const origin=new T.Vector3(x,19.1,z);ray.set(origin,down);ray.far=3;
 const visual=ray.intersectObject(walkway.surfaces,true).find(h=>h.face.normal.y>.6);
 const physical=world.castRay(new RAPIER.Ray(origin,down),3,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,undefined,undefined,undefined,c=>floorHandles.has(c.handle));
 assert(visual&&physical,`Missing authored doorway support at ${x},${z}`);
 const error=Math.abs(visual.point.y-(origin.y-physical.timeOfImpact));assert(error<.005,`Doorway floor mismatch ${error}`);
 return {y:visual.point.y,error};
}
function walk(points,speed){
 const start=points[0],body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(start[0],ground(...start).y+.905,start[1]));
 const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body),controller=world.createCharacterController(.025);
 controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();
 let vertical=0,frames=0,unsupported=0;const unsupportedAt=[];
 try{for(const target of points.slice(1)){
  let reached=false;for(let f=0;f<1200;f++){
   const p=body.translation(),dx=target[0]-p.x,dz=target[1]-p.z,d=Math.hypot(dx,dz);if(d<.09){reached=true;break;}
   vertical=Math.max(-35,vertical-24/60);const step=Math.min(d,speed/60);
   controller.computeColliderMovement(capsule,{x:dx/d*step,y:vertical/60,z:dz/d*step});const delta=controller.computedMovement();
   if(characterSupported(controller,p.y,vertical)&&vertical<0)vertical=0;else {unsupported++;unsupportedAt.push({position:{...p},delta:{...delta},vertical,ground:ground(p.x,p.z)});}
   body.setNextKinematicTranslation({x:p.x+delta.x,y:p.y+delta.y,z:p.z+delta.z});world.step();frames++;
   assert(body.translation().y>18.9,'Character fell below doorway grade');
  }assert(reached,`Blocked approaching ${target}`);
 }assert.equal(unsupported,0,'Doorway traversal lost ground support '+JSON.stringify(unsupportedAt));return{frames,unsupported,final:body.translation()};
 }finally{world.removeCharacterController(controller);world.removeRigidBody(body);}
}
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){failures.push({name,error:e.message});checks.push({name,passed:false});}}
check('Doorway and outer approach have continuous visible/physical support without any scan',()=>{
 let samples=0,maxError=0;
 for(const t of[-.5,0,.5])for(let d=-.35;d<=5.01;d+=.15){const g=ground(...point(t,d));samples++;maxError=Math.max(maxError,g.error);}
 for(const t of[-1.3,-.65,0,.65,1.3])for(const d of[1,2,3]){const g=ground(...point(t,d));samples++;maxError=Math.max(maxError,g.error);}
 return{samples,maxError};
});
for(const speed of[1.65,8])check(`Door approach and retreat at ${speed} m/s without streamed collision`,()=>[-.35,0,.35].map(t=>walk([point(t,6),point(t,-.4),point(t,6)],speed)));
check('Side-to-side movement across the doorway apron',()=>walk([point(-1.3,2),point(1.3,2),point(-1.3,2)],1.65));
walkway.dispose(world);world.free();
const result={passed:failures.length===0,checks,failures,limits:'Authored complete scene with actual controller settings; deliberately no streamed collision. Browser replay is separate.'};
writeFileSync(process.env.UT_EAST_APPROACH_EVIDENCE??'/tmp/ut-iteration-50/east-approach-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
