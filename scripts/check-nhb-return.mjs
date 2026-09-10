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


const rays=[],ray=new T.Raycaster();
for(const [x,z,dx,dz] of [[-165.17,-180.31,1,0],[-160,-188,1,0],[-100,-192,0,1]])for(const y of [10.9,13,22]){
 const origin=new T.Vector3(x,y,z),direction=new T.Vector3(dx,0,dz);ray.set(origin,direction);ray.far=15;
 const visible=ray.intersectObject(walkway.surfaces,true).find(h=>h.object.name.startsWith('NHB'));
 const physical=world.castRay(new RAPIER.Ray(origin,direction),15,true);
 assert(visible&&physical,`Missing NHB return wall at ${x},${y},${z}`);
 const difference=Math.abs(visible.distance-physical.timeOfImpact);assert(difference<.002,`NHB wall mismatch: ${difference}`);
 rays.push({origin:origin.toArray(),visible:visible.distance,physical:physical.timeOfImpact,difference});
}
const result={passed:true,rays,limits:'Exact authored extension mesh and collider comparison. Streamed geometry and actual controls are checked separately.'};
writeFileSync('/tmp/ut-iteration-46/nhb-return-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));world.free();
