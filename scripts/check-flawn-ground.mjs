import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import R from '@dimforge/rapier3d-compat';
registerHooks({load(url,c,next){if(!url.endsWith('.ts'))return next(url,c);return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};}});
const {buildGradedGround}=await import('../lib/campus/inner-campus.ts');
const plan=JSON.parse(readFileSync('public/data/flawn-ground-plan.json')),oldPlan=JSON.parse(readFileSync('public/data/inner-campus-plan.json'));
const material=new T.MeshStandardMaterial(),ground=buildGradedGround(plan,material,material,material,'Flawn approach'),old=buildGradedGround(oldPlan,material,material,material,'Old');
await R.init();const world=new R.World({x:0,y:-24,z:0}),scene=new T.Group();
for(const mesh of ground.meshes){scene.add(mesh);const p=mesh.geometry.attributes.position.array;world.createCollider(R.ColliderDesc.trimesh(p,Uint32Array.from({length:p.length/3},(_,i)=>i),R.TriMeshFlags.FIX_INTERNAL_EDGES));}
scene.updateWorldMatrix(true,true);old.meshes.forEach(m=>m.updateMatrixWorld(true));world.step();const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0);let samples=0,maxError=0,maxGrade=0,joins=0,maxJoinError=0;const curbSlivers=[];
for(const cell of plan.surfaces){const points=cell.ring.map(p=>new T.Vector3(...p)),center=points.reduce((s,p)=>s.add(p),new T.Vector3()).divideScalar(points.length),normal=new T.Vector3().crossVectors(points[1].clone().sub(points[0]),points[2].clone().sub(points[0])).normalize();const grade=Math.hypot(normal.x,normal.z)/Math.abs(normal.y);maxGrade=Math.max(maxGrade,grade);if(grade>.8){const cross=new T.Vector3().crossVectors(points[1].clone().sub(points[0]),points[2].clone().sub(points[0]));const longest=Math.max(...points.flatMap(a=>points.map(b=>Math.hypot(a.x-b.x,a.z-b.z))));const width=Math.abs(cross.y)/longest,rise=Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y));assert(width<.04&&rise<.08,`Steep surface beyond adjoining curb: ${width},${rise}`);curbSlivers.push({width,rise,center:center.toArray()});}
 const o=center.clone().add(new T.Vector3(0,2,0));ray.set(o,down);ray.far=4;const visible=ray.intersectObject(scene,true)[0],physical=world.castRay(new R.Ray(o,down),4,true);assert(visible&&physical);const error=Math.abs(visible.distance-physical.timeOfImpact);assert(error<.004);maxError=Math.max(error,maxError);samples++;
 for(const p of points){ray.set(new T.Vector3(p.x,24,p.z),down);ray.far=12;const h=ray.intersectObjects(old.meshes,false)[0];if(h){const d=Math.abs(p.y-h.point.y);assert(d<.005,`Existing edge mismatch ${d}`);maxJoinError=Math.max(d,maxJoinError);joins++;}}
}
assert(joins>20);
const witnesses=[[-305.1,18.2,-56.7],[-305.48,18.55,-56.53]];for(const p of witnesses)assert(ground.volumes.some(v=>v.planes.every(plane=>plane.distanceToPoint(new T.Vector3(...p))<=0)),'Known scan fragment outside repair');
// Replay the narrow old/new curb with the ordinary capsule/autostep settings.
for(const mesh of old.meshes){const p=mesh.geometry.attributes.position.array;world.createCollider(R.ColliderDesc.trimesh(p,Uint32Array.from({length:p.length/3},(_,i)=>i),R.TriMeshFlags.FIX_INTERNAL_EDGES));}
world.step();const yAt=(x,z)=>{const h=world.castRay(new R.Ray({x,y:20,z},down),10,true);assert(h);return 20-h.timeOfImpact;};
const start=[-271.2,16.8],finish=[-270.5,15.8],body=world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(start[0],yAt(...start)+.905,start[1])),capsule=world.createCollider(R.ColliderDesc.capsule(.54,.34),body),controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);controller.setMaxSlopeClimbAngle(Math.PI*.25);world.step();let curbFrames=0;
for(const target of [finish,start]){let reached=false;for(let i=0;i<300;i++){const p=body.translation(),dx=target[0]-p.x,dz=target[1]-p.z,d=Math.hypot(dx,dz);if(d<.05){reached=true;break;}const length=Math.min(d,1.65/60);controller.computeColliderMovement(capsule,{x:dx/d*length,y:-.05,z:dz/d*length});const move=controller.computedMovement();assert(controller.computedGrounded(),'Lost curb support');body.setNextKinematicTranslation({x:p.x+move.x,y:p.y+move.y,z:p.z+move.z});world.step();curbFrames++;}assert(reached,'Curb crossing blocked');}
world.removeCharacterController(controller);world.removeRigidBody(body);
const result={passed:true,curbFrames,samples,maxError,maxGrade,curbSlivers,joins,maxJoinError,knownFragmentWitnesses:witnesses,stats:ground.stats,planAudit:plan.audit,limits:'Authored geometry and physics plus exact adjoining ground; streamed scan removal and normal controls require browser replay.'};writeFileSync('/tmp/ut-iteration-47/flawn-ground-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));world.free();
