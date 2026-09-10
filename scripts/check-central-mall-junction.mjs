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
const {SpeedwayWalkway}=await import('../lib/campus/walkway.ts');
const {Terrain}=await import('../lib/campus/terrain.ts');
const {characterSupported}=await import('../lib/campus/character-support.ts');
await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0});
const original=Object.getOwnPropertyDescriptor(T.TextureLoader.prototype,'load');
T.TextureLoader.prototype.load=()=>new T.Texture();
const walkway=new SpeedwayWalkway(JSON.parse(readFileSync('public/data/campus.json')),
  new Terrain(JSON.parse(readFileSync('public/data/terrain.json'))),world,{capabilities:{getMaxAnisotropy:()=>8}},true);
Object.defineProperty(T.TextureLoader.prototype,'load',original);walkway.group.updateWorldMatrix(true,true);world.step();
const ray=new T.Raycaster(new T.Vector3(-1,8,63.82),new T.Vector3(0,-1,0));
const start=ray.intersectObject(walkway.surfaces,true)[0].point.clone();start.y+=.905;
const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...start.toArray()));
const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34).setFriction(0),body);
const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);
const slide=Number(process.argv[3]??50.4);
controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(slide*Math.PI/180);world.step();
const samples=[];
const bias=Number(process.argv[2]??-1);
const contactSupport=process.argv.includes('--contact-support');
let vertical=bias,grounded=true,vx=0,vz=0;
const yaw=275*Math.PI/180;
for(let f=0;f<22*60;f++){
  const alpha=1-Math.exp(-(grounded?13:4)/60);
  vx=T.MathUtils.lerp(vx,Math.sin(yaw)*1.65,alpha);vz=T.MathUtils.lerp(vz,-Math.cos(yaw)*1.65,alpha);
  vertical=Math.max(-35,vertical-24/60);
  controller.computeColliderMovement(capsule,{x:vx/60,y:vertical/60,z:vz/60});
  const p=body.translation(),d=controller.computedMovement();grounded=controller.computedGrounded();
  if(contactSupport)grounded=characterSupported(controller,p.y,vertical);
  if(grounded && vertical<0)vertical=bias;
  body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();
  if(f%60===59){
    const contacts=Array.from({length:controller.numComputedCollisions()},(_,i)=>{
      const c=controller.computedCollision(i);return {ownedCollider:walkway.colliders.findIndex((v)=>v.handle===c.collider?.handle),
        point:c.witness1,normal:c.normal1,remaining:c.translationDeltaRemaining};
    });
    samples.push({seconds:(f+1)/60,position:{...body.translation()},grounded,contacts});
  }
}
const report={groundedVerticalBias:bias,minSlopeSlideDegrees:slide,contactSupport,start:start.toArray(),samples,passed:body.translation().x<-30};
writeFileSync(`evidence/iteration-25-mall-junction-${bias===0?'zero':'negative'}-bias-slide-${slide}${contactSupport?'-contact-support':''}.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
assert(report.passed,'combined Speedway/mall scene must pass the first risers');
walkway.dispose(world);world.free();
