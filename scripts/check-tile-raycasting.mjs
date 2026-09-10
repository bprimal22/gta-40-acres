import assert from 'node:assert/strict';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { TilesRenderer } from '3d-tiles-renderer';
import { existsSync, readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';

registerHooks({resolve(s,c,next){
  if(s.endsWith('?worker'))return{url:'data:text/javascript,export default class UnusedWorker { constructor(){throw Error("Worker must not start in ray fixture")} }',shortCircuit:true};
  if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){
    const u=new URL(`${s}.ts`,c.parentURL);if(existsSync(u))return{url:u.href,shortCircuit:true};
  }return next(s,c);
},load(url,c,next){
  if(!url.endsWith('.ts'))return next(url,c);
  return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
}});
const { PhotorealCampus }=await import('../lib/campus/photoreal.ts');

// Real installed Three mesh rays and Rapier; deliberately inaccurate hierarchy
// metadata reproduces the observed bug without provider geometry or network.
await RAPIER.init();
const floor=new THREE.Mesh(new THREE.PlaneGeometry(12,16).rotateX(-Math.PI/2).translate(306,-8.75,280),new THREE.MeshBasicMaterial());
const scene=new THREE.Group();scene.add(floor);scene.updateMatrixWorld(true);
const tile={traversal:{used:true},engineData:{scene,boundingVolume:{intersectsRay:()=>false}},children:[]};
const state={root:tile,accelerateRaycast:true,activeTiles:new Set([tile]),group:{matrixWorldInverse:new THREE.Matrix4()},invokeOnePlugin:()=>false};
const ray=new THREE.Raycaster(new THREE.Vector3(308,-6,280),new THREE.Vector3(0,-1,0),0,6);
const query=()=>{const hits=[];TilesRenderer.prototype.raycast.call(state,ray,hits);return hits.sort((a,b)=>a.distance-b.distance);};
assert.equal(query().length,0,'bad hierarchy metadata reproduces missing ground');
state.accelerateRaycast=false;
assert.equal(query().length,1);assert.ok(Math.abs(query()[0].point.y+8.75)<1e-8);
const world=new RAPIER.World({x:0,y:-9.81,z:0});
const geometry=floor.geometry;
world.createCollider(RAPIER.ColliderDesc.trimesh(new Float32Array(geometry.attributes.position.array),new Uint32Array(geometry.index.array)));
world.step();
let compared=0;
for(const x of [302,304,306,308,310])for(const z of [274,277,280,283,286]){
 ray.ray.origin.set(x,-6,z);
 const mesh=query()[0],physical=world.castRayAndGetNormal(new RAPIER.Ray({x,y:-6,z},{x:0,y:-1,z:0}),6,false);
 assert.ok(mesh&&physical);assert.ok(Math.abs(mesh.point.y-(-6-physical.timeOfImpact))<1e-5);compared++;
}
state.activeTiles.clear();assert.equal(query().length,0,'inactive loaded geometry is excluded');
state.activeTiles.add(tile);ray.ray.origin.set(308,-6,280);ray.far=1;assert.equal(query().length,0,'distance limit is preserved');ray.far=6;
ray.firstHitOnly=true;assert.equal(query().length,1,'first hit mode remains available');

// Protect the actual constructor registration: never update/fetch a tileset.
// This fails if the production option is removed, even if the vendor fixture passes.
const originalFetch=globalThis.fetch;let requests=0;
globalThis.fetch=()=>{requests++;throw Error('Network must not run in ray fixture');};
let campus;
try{
 campus=new PhotorealCampus({token:'fixture-no-credential',assetId:0},[-97.738,30.287],new THREE.PerspectiveCamera(),
   {capabilities:{getMaxAnisotropy:()=>1}},world);
 assert.equal(campus.tiles.accelerateRaycast,false,'production constructor selects accurate mesh raycasts');
 campus.tiles.group.matrix.identity();campus.tiles.group.updateMatrixWorld(true);
 const nearScene=new THREE.Group(),farScene=new THREE.Group();
 const near=floor.clone(),far=floor.clone();near.position.y=1;far.position.y=-1;
 nearScene.add(near);farScene.add(far);
 const makeTile=scene=>({traversal:{used:true},engineData:{scene,boundingVolume:{intersectsRay:()=>false}},geometricError:2,children:[]});
 const nearTile=makeTile(nearScene),farTile=makeTile(farScene);
 near.userData={tile:nearTile};far.userData={tile:farTile};
 Object.defineProperty(campus.tiles,'root',{value:nearTile,writable:true,configurable:true});
 // Insert the farther tile first to catch an insertion-order first-hit bug.
 for(const [tile,scene]of [[farTile,farScene],[nearTile,nearScene]]){
   campus.tiles.setTileActive(tile,true);campus.tiles.setTileVisible(tile,true);
   campus.entries.set(tile,{scene,triangles:2,repaired:true});
 }
 campus.tiles.group.updateMatrixWorld(true);campus.aligned=true;
 campus.ray.firstHitOnly=true;
 assert.equal(campus.surface(308,280,-6,10).object,near,'nearest active tile wins regardless of insertion order');
 campus.ray.firstHitOnly=false;
 campus.entries.get(nearTile).repaired=false;
 assert.equal(campus.surface(308,280,-6,10).object,far,'unprepared gameplay source is excluded');
 assert.equal(campus.surface(308,280,-6,10,true).object,near,'source-only calibration remains independent of preparation');
 campus.entries.get(nearTile).repaired=true;
 campus.tiles.setTileVisible(nearTile,false);
 assert.equal(campus.surface(308,280,-6,10).object,near,'active offscreen source still supports ground');
 campus.tiles.setTileActive(nearTile,false);
 assert.equal(campus.surface(308,280,-6,10).object,far,'inactive cached source does not support ground');
 campus.tiles.setTileActive(farTile,false);campus.tiles.setTileVisible(farTile,false);
 campus.tiles.root=null;campus.entries.clear();
 assert.equal(requests,0);
}finally{campus?.dispose();globalThis.fetch=originalFetch;}
world.free();geometry.dispose();floor.material.dispose();
console.log(JSON.stringify({passed:true,checks:13,renderPhysicsComparisons:compared,networkRequests:requests,
 scope:'Installed vendor and actual PhotorealCampus constructor, preparation/active filtering and first hit; browser validates visual behavior and performance'}));
