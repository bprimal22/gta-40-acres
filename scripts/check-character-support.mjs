import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import R from '@dimforge/rapier3d-compat';
registerHooks({load(url,c,next){
  if(!url.endsWith('.ts'))return next(url,c);
  return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
}});
const {characterSupported}=await import('../lib/campus/character-support.ts');
await R.init();
function fixture(x=0,floorEdge=false){
  const world=new R.World({x:0,y:-24,z:0});
  world.createCollider(R.ColliderDesc.cuboid(20,.1,20).setTranslation(floorEdge?-20:0,-.1,0));
  const body=world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(x,.905,0));
  const capsule=world.createCollider(R.ColliderDesc.capsule(.54,.34).setFriction(0),body);
  const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);
  controller.enableSnapToGround(.38);controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);
  world.step();let vertical=0,grounded=true;
  function step(vx=0,jump=false){
    if(jump && grounded){vertical=7.2;grounded=false;}
    vertical=Math.max(-35,vertical-24/60);
    const p=body.translation();controller.computeColliderMovement(capsule,{x:vx/60,y:vertical/60,z:0});
    const d=controller.computedMovement();grounded=characterSupported(controller,p.y,vertical);
    const contacts=Array.from({length:controller.numComputedCollisions()},(_,i)=>controller.computedCollision(i));
    if(grounded && vertical<0)vertical=0;
    if(vertical>0 && d.y<vertical/60-.01)vertical=0;
    body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();
    return {position:{...body.translation()},grounded,vertical,contacts:contacts.map(c=>({point:c.witness1,normal:c.normal1}))};
  }
  return {world,step};
}
const wall=fixture();wall.world.createCollider(R.ColliderDesc.cuboid(.2,3,4).setTranslation(5,3,0));wall.world.step();
let wallStop;for(let i=0;i<180;i++)wallStop=wall.step(5.8);
assert(wallStop.position.x<4.5 && wallStop.position.y<1,'running into a wall cannot climb it');
assert(wallStop.grounded,'the floor continues to support a character at a wall');
let retreat;for(let i=0;i<60;i++)retreat=wall.step(-1.65);
assert(retreat.position.x<wallStop.position.x-1.4,'retreat remains possible');wall.world.free();
const jump=fixture();const jumpSamples=[];
for(let i=0;i<90;i++)jumpSamples.push(jump.step(0,i===0));
assert(!jumpSamples[12].grounded && jumpSamples[12].position.y>1.6,'ascending jump is airborne');
const peak=Math.max(...jumpSamples.map(s=>s.position.y));assert(peak>1.8 && peak<2.1,'jump follows the existing gravity and impulse');
assert(jumpSamples.at(-1).grounded && Math.abs(jumpSamples.at(-1).position.y-.905)<.035,'jump lands on the floor');jump.world.free();
const ceiling=fixture();ceiling.world.createCollider(R.ColliderDesc.cuboid(4,.1,4).setTranslation(0,2,0));ceiling.world.step();
const ceilingSamples=[];for(let i=0;i<60;i++)ceilingSamples.push(ceiling.step(0,i===0));
assert(Math.max(...ceilingSamples.map(s=>s.position.y))<1.08,'low ceiling stops the ascending head');
assert(ceilingSamples.some(s=>s.contacts.some(c=>c.normal.y<-.8)),'the head actually contacts the ceiling');
assert(ceilingSamples.at(-1).grounded && ceilingSamples.at(-1).position.y<.94,'ceiling contact does not suspend the character');ceiling.world.free();
const ledge=fixture(-2,true);const ledgeSamples=[];
for(let i=0;i<150;i++)ledgeSamples.push(ledge.step(1.65));
assert(ledgeSamples.at(-1).position.x>1.5 && ledgeSamples.at(-1).position.y<-3,'walking off an edge falls normally');
assert(!ledgeSamples.at(-1).grounded && ledgeSamples.at(-1).vertical<-10,'unsupported fall keeps accelerating');ledge.world.free();
const report={passed:true,wall:{stop:wallStop,retreat},jump:{airborne:jumpSamples[12],peak,landed:jumpSamples.at(-1)},
  ceiling:{peak:Math.max(...ceilingSamples.map(s=>s.position.y)),landed:ceilingSamples.at(-1)},ledge:ledgeSamples.at(-1)};
writeFileSync('evidence/iteration-25-character-support-check.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
