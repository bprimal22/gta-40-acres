import assert from 'node:assert/strict';
import {Session} from 'node:inspector/promises';
import {createHash} from 'node:crypto';
const label=process.argv[2]??'before';
assert(/^[a-z0-9-]+$/.test(label));
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
const profile=new Session();profile.connect();await profile.post('Profiler.enable');await profile.post('Profiler.start');
const started=performance.now();
let walkway;
try{
  T.TextureLoader.prototype.load=()=>new T.Texture();
  walkway=new SpeedwayWalkway(data,terrain,world,{capabilities:{getMaxAnisotropy:()=>8}},true);
}finally{Object.defineProperty(T.TextureLoader.prototype,'load',textureLoad);}
const elapsedMs=performance.now()-started;
const result=await profile.post('Profiler.stop');profile.disconnect();
writeFileSync(`/tmp/ut-iteration-49/startup-${label}.cpuprofile`,JSON.stringify(result.profile));
const hash=createHash('sha256');let meshes=0,triangles=0;
walkway.group.updateWorldMatrix(true,true);
walkway.group.traverse(o=>{
 if(!(o instanceof T.Mesh))return;meshes++;
 hash.update(JSON.stringify({name:o.name,matrix:o.matrixWorld.elements,materials:(Array.isArray(o.material)?o.material:[o.material]).map(m=>m.name)}));
 for(const [key,attr] of Object.entries(o.geometry.attributes)){hash.update(key);hash.update(Buffer.from(attr.array.buffer,attr.array.byteOffset,attr.array.byteLength));}
 if(o.geometry.index){const a=o.geometry.index.array;hash.update(Buffer.from(a.buffer,a.byteOffset,a.byteLength));}
 triangles+=(o.geometry.index?.count??o.geometry.attributes.position.count)/3;
});
hash.update(JSON.stringify(walkway.volumes.map(v=>({planes:v.planes.map(p=>[...p.normal.toArray(),p.constant]),min:v.bounds.min.toArray(),max:v.bounds.max.toArray()}))));
hash.update(JSON.stringify(walkway.facadeSamples));
writeFileSync(`/tmp/ut-iteration-49/startup-${label}.json`,JSON.stringify({elapsedMs,geometryAndCutsSha256:hash.digest('hex'),meshes,triangles,landscape:walkway.snapshot()},null,2)+'\n');
console.log(JSON.stringify({elapsedMs}));
walkway.dispose(world);world.free();
