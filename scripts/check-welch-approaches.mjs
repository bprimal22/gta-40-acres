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


// Test all three Welch entrances in the complete authored scene. A scan must
// never be the hidden floor that makes a replacement doorway traversable.
const selected=(process.env.UT_WELCH_FACADES??'west,east,south').split(',');
const entrances=(walkway.welchAprons?.entrances??[]).filter(e=>selected.includes(e.facade));
assert.equal(entrances.length,selected.length,'Every requested Welch ground connection must be integrated');
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),checks=[],failures=[];
const floorHandles=new Set(walkway.colliders.map(c=>c.handle));
function frame(entry){
 const origin=new T.Vector2(entry.position[0],entry.position[2]),n=new T.Vector2(entry.normal[0],entry.normal[2]),u=new T.Vector2(n.y,-n.x);
 return(t,d)=>origin.clone().addScaledVector(u,t).addScaledVector(n,d).toArray();
}
function ground(entry,x,z){
 const top=Math.max(entry.threshold,...entry.outerElevations)+.55,origin=new T.Vector3(x,top,z);
 ray.set(origin,down);ray.far=5;
 const visual=ray.intersectObject(walkway.surfaces,true).find(h=>h.face.normal.y>.6);
 const physical=world.castRay(new RAPIER.Ray(origin,down),5,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,undefined,undefined,undefined,c=>floorHandles.has(c.handle));
 assert(visual&&physical,`Missing ${entry.facade} floor at ${x},${z}`);
 const error=Math.abs(visual.point.y-(origin.y-physical.timeOfImpact));assert(error<.005,`${entry.facade} floor disagreement ${error} at ${x},${z}; visual ${visual.point.y} (${visual.object.material.name}), physical ${origin.y-physical.timeOfImpact}`);
 return {y:visual.point.y,error,material:visual.object.material.name};
}
function walk(entry,points,speed){
 const initial=points[0],body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(initial[0],ground(entry,...initial).y+.905,initial[1]));
 const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body),controller=world.createCharacterController(.025);
 controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();
 let vertical=0,frames=0,unsupported=0,minFootClearance=Infinity;
 try{for(const target of points.slice(1)){
  let reached=false;for(let f=0;f<1500;f++){
   const p=body.translation(),dx=target[0]-p.x,dz=target[1]-p.z,d=Math.hypot(dx,dz);if(d<.09){reached=true;break;}
   vertical=Math.max(-35,vertical-24/60);const step=Math.min(d,speed/60);
   controller.computeColliderMovement(capsule,{x:dx/d*step,y:vertical/60,z:dz/d*step});const delta=controller.computedMovement();
   if(characterSupported(controller,p.y,vertical)&&vertical<0)vertical=0;else unsupported++;
   body.setNextKinematicTranslation({x:p.x+delta.x,y:p.y+delta.y,z:p.z+delta.z});world.step();frames++;
   const q=body.translation(),floor=ground(entry,q.x,q.z).y,clearance=q.y-.905-floor;minFootClearance=Math.min(minFootClearance,clearance);
   assert(clearance>-.045,`Fell through ${entry.facade} ground: ${clearance}`);
  }assert(reached,`Blocked ${entry.facade} approaching ${target}, ended ${JSON.stringify(body.translation())}`);
 }assert.equal(unsupported,0,`${entry.facade} approach lost support`);return{frames,unsupported,minFootClearance,final:{...body.translation()}};
 }finally{world.removeCharacterController(controller);world.removeRigidBody(body);}
}
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){failures.push({name,error:e.message});checks.push({name,passed:false});}}
for(const entry of entrances){const point=frame(entry);
 check(`${String(entry.facade)} floor across sill and ground joins`,()=>{let samples=0,maxError=0;for(const t of[-.55,0,.55])for(let d=-.35;d<=entry.outerDistance+.16;d+=.137){const g=ground(entry,...point(t,d));samples++;maxError=Math.max(maxError,g.error);}return{samples,maxError};});
 for(const speed of[1.65,8])check(`${String(entry.facade)} approach/retreat at ${speed} m/s`,()=>[-.35,0,.35].map(t=>walk(entry,[point(t,entry.outerDistance+.35),point(t,-.4),point(t,entry.outerDistance+.35)],speed)));
}
// Ordinary arcade windows are recessed as deeply as the entry. Their pockets
// also need floors: a character can walk into them even though they are closed.
const east=entrances.find(e=>e.facade==='east');
if(east){const point=frame(east),bay=-62.361718/13;
 check('east ordinary arcade recess floor',()=>[-.3,0,.3].map(t=>[-.4,.04,.5,1.5].map(d=>ground(east,...point(bay+t,d)))));
 for(const speed of[1.65,8])check(`east ordinary arcade approach/retreat at ${speed} m/s`,()=>walk(east,[point(bay,1.8),point(bay,-.4),point(bay,1.8)],speed));
}
walkway.dispose(world);world.free();
const result={passed:failures.length===0,checks,failures,limits:'Full authored scene with actual capsule/controller settings and no streamed collision. Live source overlap and browser movement are checked separately.'};
writeFileSync(process.env.UT_WELCH_APPROACH_EVIDENCE??'/tmp/ut-iteration-53/welch-approach-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
