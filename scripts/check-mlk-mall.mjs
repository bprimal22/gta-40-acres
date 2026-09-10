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
const prefix=process.argv[2]??'iteration-38';assert(/^[a-z0-9-]+$/.test(prefix),'safe evidence prefix');
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
const {inMlkMall,MLK_POSITION}=await import('../lib/campus/mlk-mall.ts');
const plan=JSON.parse(readFileSync('public/data/mlk-mall-plan.json')),ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),checks=[],failures=[];
// Include exactly the same near-LOD wood triangles and placement transform as
// ForegroundTrees. Ground-only checks miss trunks bending into the sidewalk.
const glb=readFileSync('public/assets/foreground-tree/near.glb'),jsonLength=glb.readUInt32LE(12),gltf=JSON.parse(glb.subarray(20,20+jsonLength).toString()),binary=glb.subarray(28+jsonLength);
function accessor(id){const a=gltf.accessors[id],v=gltf.bufferViews[a.bufferView],n=a.type==='VEC3'?3:1,bytes=binary.subarray((v.byteOffset??0)+(a.byteOffset??0),(v.byteOffset??0)+(a.byteOffset??0)+a.count*n*4);assert([5126,5125].includes(a.componentType)&&!v.byteStride);return a.componentType===5126?new Float32Array(Uint8Array.from(bytes).buffer):new Uint32Array(Uint8Array.from(bytes).buffer);}
const wood=gltf.meshes[0].primitives.filter(p=>gltf.materials[p.material].name==='island_tree_02');assert(wood.length);
const floorHandles=new Set(walkway.colliders.map(c=>c.handle));
const treePlacements=walkway.treePlacements.filter(p=>inMlkMall(p.x,p.z));
for(const p of treePlacements)for(const mesh of wood){const vertices=accessor(mesh.attributes.POSITION),m=new T.Matrix4().compose(new T.Vector3(p.x,p.y,p.z),new T.Quaternion().setFromAxisAngle(new T.Vector3(0,1,0),p.rotation),new T.Vector3(3.1*p.scale*(p.width??1),2.5*p.scale*(p.height??1),3.1*p.scale*(p.width??1))),v=new T.Vector3();for(let i=0;i<vertices.length;i+=3){v.fromArray(vertices,i).applyMatrix4(m).toArray(vertices,i);}world.createCollider(RAPIER.ColliderDesc.trimesh(vertices,accessor(mesh.indices),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));}world.step();
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){checks.push({name,passed:false});failures.push({name,error:e.message});}}
function ground(x,z){const origin=new T.Vector3(x,terrain.height(x,z)+6,z);ray.set(origin,down);ray.far=10;const hit=ray.intersectObject(walkway.surfaces,true).find(h=>h.face.normal.y>.6),physical=world.castRay(new RAPIER.Ray(origin,down),10,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,undefined,undefined,undefined,c=>floorHandles.has(c.handle));assert(hit&&physical,`Ground missing at ${x},${z}`);assert(Math.abs(hit.point.y-(origin.y-physical.timeOfImpact))<.004,`Visual/physical disagreement ${x},${z}`);return{y:hit.point.y,name:hit.object.name};}
function pathPoint(side,x){const p=plan.sidePaths[side];for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i];if(x<=b[0])return[x,T.MathUtils.lerp(a[1],b[1],(x-a[0])/(b[0]-a[0]))];}return p.at(-1);}
check('Concrete side walks have matching visible and physical support',()=>{let samples=0;for(const side of ['north','south'])for(let x=2.3;x<160;x+=1.25){const p=pathPoint(side,x),g=ground(...p);assert(g.name==='MLK East Mall concrete',`${side} ${x}: ${g.name}`);samples++;}return{samples};});
check('Lawn and gravel remain walkable',()=>{const samples=[[25,65.23],[25,61.43],[61,68.39],[61,72.39],[136,74.98],[136,79.3]];for(const p of samples)ground(...p);return{samples};});
check('Speedway junction support across both lane ends',()=>{let samples=0;for(const z of [55.6,63.8,70.8])for(let x=-12;x<=10;x+=.31){ground(x,z);samples++;}return{samples};});
function run(points){const p=points[0],startY=ground(...p).y+.905,body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0],startY,p[1])),capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body),controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();let vertical=0,frames=0,unsupported=0;
try{for(const target of points.slice(1)){let reached=false;for(let f=0;f<15000;f++){const from=body.translation(),dx=target[0]-from.x,dz=target[1]-from.z,d=Math.hypot(dx,dz);if(d<.10){reached=true;break;}vertical=Math.max(-35,vertical-24/60);controller.computeColliderMovement(capsule,{x:dx/d*1.65/60,y:vertical/60,z:dz/d*1.65/60});const delta=controller.computedMovement();if(characterSupported(controller,from.y,vertical)&&vertical<0)vertical=0;else unsupported++;body.setNextKinematicTranslation({x:from.x+delta.x,y:from.y+delta.y,z:from.z+delta.z});world.step();frames++;}assert(reached,`Blocked toward ${JSON.stringify(target)} at ${JSON.stringify(body.translation())}`);}assert(unsupported===0,`${unsupported} unsupported frames`);return{frames,unsupported,final:body.translation()};}finally{world.removeCharacterController(controller);world.removeRigidBody(body);}}
check('Normal capsule follows north walk through Speedway and returns on south walk',()=>run([pathPoint('north',114),pathPoint('north',78),pathPoint('north',48),pathPoint('north',10),[-4,63.8],[-14,62.7],[-4,63.8],pathPoint('south',10),pathPoint('south',48),pathPoint('south',78),pathPoint('south',114)]));
check('Normal capsule circles the clear memorial apron',()=>{const[x,z]=MLK_POSITION,p=[];for(let i=0;i<=32;i++)p.push([x+4.6*Math.cos(i/32*Math.PI*2),z+4.6*Math.sin(i/32*Math.PI*2)]);return run(p);});
check('Both sides of each sidewalk remain clear of bent tree trunks',()=>{const runs=[];for(const side of ['north','south'])for(const offset of [-.65,.65]){const points=[158,131,114,78,48,10].map(x=>{const p=pathPoint(side,x);return[p[0],p[1]+offset];});runs.push({side,offset,...run(points)});}return runs;});
check('MLK geometry finite; arrival inside protected repair envelope',()=>{let vertices=0;for(const m of walkway.surfaces.children.filter(m=>m.name.startsWith('MLK'))){for(const v of m.geometry.attributes.position.array)assert(Number.isFinite(v));vertices+=m.geometry.attributes.position.count;}assert(inMlkMall(114,64.4));assert(!inMlkMall(114,50));return{vertices,areaM2:plan.areaM2,buildingProtectionM:plan.buildingProtectionM};});
const result={passed:failures.length===0,checks,failures,stats:walkway.mlk,treeCollidersIncluded:treePlacements.length*wood.length,limits:'Visual/physics agreement and normal capsule route including actual near-LOD tree wood. Grades/paving photo and contour estimates, not surveyed. Streamed-mesh browser playtest separate.'};writeFileSync(`evidence/${prefix}-mlk-mall-check.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));walkway.dispose(world);world.free();if(failures.length)process.exitCode=1;
