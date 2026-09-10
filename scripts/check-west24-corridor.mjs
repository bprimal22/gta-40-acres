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
const glb=readFileSync('public/assets/foreground-tree/near.glb'),jsonLength=glb.readUInt32LE(12),gltf=JSON.parse(glb.subarray(20,20+jsonLength).toString()),binary=glb.subarray(28+jsonLength);
function accessor(id){const a=gltf.accessors[id],v=gltf.bufferViews[a.bufferView],n=a.type==='VEC3'?3:1,bytes=binary.subarray((v.byteOffset??0)+(a.byteOffset??0),(v.byteOffset??0)+(a.byteOffset??0)+a.count*n*4);assert([5126,5125].includes(a.componentType)&&!v.byteStride);return a.componentType===5126?new Float32Array(Uint8Array.from(bytes).buffer):new Uint32Array(Uint8Array.from(bytes).buffer);}
const wood=gltf.meshes[0].primitives.filter(p=>gltf.materials[p.material].name==='island_tree_02');assert(wood.length);
const floorHandles=new Set(walkway.colliders.map(c=>c.handle));
const treePlacements=walkway.treePlacements.filter(p=>p.x<-65&&p.x>-250&&p.z<-35&&p.z>-180);
for(const p of treePlacements)for(const mesh of wood){const vertices=accessor(mesh.attributes.POSITION),m=new T.Matrix4().compose(new T.Vector3(p.x,p.y,p.z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),p.rotation),new T.Vector3(3.1*p.scale*(p.width??1),2.5*p.scale*(p.height??1),3.1*p.scale*(p.width??1))),v=new T.Vector3();for(let i=0;i<vertices.length;i+=3){v.fromArray(vertices,i).applyMatrix4(m).toArray(vertices,i);}world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,accessor(mesh.indices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));}world.step();

const plan=JSON.parse(readFileSync('public/data/west24-plan.json'));
const reference=JSON.parse(readFileSync('../research/west-24th-tower-reference-2026-09-06/route-reference.json'));
const route=reference.routeSegments.flatMap((s,i)=>i?s.pointsXZ.slice(1):s.pointsXZ);
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),checks=[],failures=[];
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){checks.push({name,passed:false});failures.push({name,error:e.message});}}
function ground(x,z){const origin=new T.Vector3(x,terrain.height(x,z)+5,z);ray.set(origin,down);ray.far=9;const hit=ray.intersectObject(walkway.surfaces,true).find(h=>h.face.normal.y>.6),physical=world.castRay(new RAPIER.Ray(origin,down),9,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,undefined,undefined,undefined,c=>floorHandles.has(c.handle));assert(hit&&physical,`Ground missing ${x},${z}`);const error=Math.abs(hit.point.y-(origin.y-physical.timeOfImpact));assert(error<.006,`Surface disagreement ${error} at ${x},${z}`);return {y:hit.point.y,name:hit.object.name,material:hit.object.material,error};}
function walk(points,speed){const p=points[0],body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0],ground(...p).y+.905,p[1])),capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body),controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();let vertical=0,frames=0,unsupported=0;const unsupportedAt=[];
 try{for(const target of points.slice(1)){let reached=false;for(let f=0;f<12000;f++){const p=body.translation(),dx=target[0]-p.x,dz=target[1]-p.z,d=Math.hypot(dx,dz);if(d<.09){reached=true;break;}vertical=Math.max(-35,vertical-24/60);const step=Math.min(d,speed/60);controller.computeColliderMovement(capsule,{x:dx/d*step,y:vertical/60,z:dz/d*step});const delta=controller.computedMovement();if(characterSupported(controller,p.y,vertical)&&vertical<0)vertical=0;else {unsupported++;if(unsupportedAt.length<20)unsupportedAt.push({position:{...p},vertical,delta:{...delta}});}body.setNextKinematicTranslation({x:p.x+delta.x,y:p.y+delta.y,z:p.z+delta.z});world.step();frames++;if(frames%120===0){const q=body.translation();assert(Math.abs(q.y-.905-ground(q.x,q.z).y)<.17,'Player left visible floor');}}assert(reached,`Blocked toward ${target} at ${JSON.stringify(body.translation())}`);}assert.equal(unsupported,0,'Unsupported frames '+JSON.stringify(unsupportedAt));return {frames,unsupported,final:body.translation()};}finally{world.removeCharacterController(controller);world.removeRigidBody(body);}}
check('All mapped route joins are present and MLK is preserved',()=>{for(const id of [571500824,15400170,15387933])assert.equal(data.paths.filter(p=>p.id===id).length,1);assert(data.landmarks.mlk);return {landmarks:Object.keys(data.landmarks).length};});
check('Full 327 m road has matching visible and physical floor across its width',()=>{let samples=0,maxError=0;for(let i=1;i<route.length;i++){const a=route[i-1],b=route[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz),count=Math.ceil(len/1.5);for(let j=0;j<count;j++)for(const offset of [-3,0,3]){const t=(j+.1)/count,x=a[0]+dx*t-dz/len*offset,z=a[1]+dz*t+dx/len*offset;const h=ground(x,z);maxError=Math.max(maxError,h.error);samples++;}}return{samples,maxError};});
check('Golden Speedway crossing stays gold; west road is asphalt',()=>{assert.equal(ground(13.9,-135.382).material.customProgramCacheKey(),'speedway-golden-brick-v2');for(const x of [-5,-35,-60,-90,-140])assert.equal(ground(x,-135.382+(x-12.785)*.090416).material.customProgramCacheKey(),'dkr-street-asphalt-v1');});
check('Normal running controller reaches Tower north and returns with actual tree wood colliders',()=>walk([...route,...route.slice(0,-1).reverse()],8));
check('Both sidewalks through the west segment and left turn remain walkable',()=>{const runs=[];for(const side of [-1,1]){const p=route.map((p,i)=>{const a=route[Math.max(0,i-1)],b=route[Math.min(route.length-1,i+1)],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);return [p[0]-dz/len*5.5*side,p[1]+dx/len*5.5*side];});// Stop one metre inside the finite service-road end so the capsule stays on the authored landing.
p[p.length-1][1]-=1;runs.push(walk([...p,...p.slice(0,-1).reverse()],8));}return runs;});
check('Original source obstructions on the route are cut away',()=>{for(const p of [[-120.27,10,-150.65],[-192.51,13,-154.28],[-199.75,14,-108.46]]){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([p[0]-.01,p[1],p[2],p[0]+.01,p[1],p[2],p[0],p[1]+.01,p[2]+.01],3));g.computeVertexNormals();const cut=subtractVolumes(g,new T.Matrix4(),walkway.volumes);assert(cut&&cut.attributes.position.count===0,`Blocker remained ${p}`);g.dispose();cut.dispose();}});
walkway.dispose(world);world.free();
const result={passed:!failures.length,checks,failures,trees:treePlacements.length,limits:'Actual authored scene and real tree wood colliders; no streamed source tiles. Runtime seams, appearance and actual controls require browser replay.'};
writeFileSync((process.env.UT_EVIDENCE_DIR??'/tmp/ut-iteration-41')+'/corridor-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
