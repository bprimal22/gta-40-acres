import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const handlers={}, cache=new Map(), base='https://demo.pages.dev'; let fetchCount=0;
const key=r=>typeof r==='string'?new URL(r,base).href:r.url;
const context={URL,Response,Promise,fetch:async()=>{fetchCount++;const r=new Response('fresh asset');Object.defineProperty(r,'type',{value:'basic'});return r;},self:{location:{origin:base},addEventListener:(n,f)=>handlers[n]=f},caches:{open:async()=>({match:async r=>cache.get(key(r))?.clone(),put:async(r,v)=>cache.set(key(r),v),addAll:async()=>{}})}};
vm.runInNewContext(await readFile(new URL('../public/sw.js',import.meta.url),'utf8'),context);
async function request(path){let result;handlers.fetch({request:{url:new URL(path,base).href,method:'GET',mode:'cors'},respondWith:p=>result=p});return result?await result:undefined;}
assert.equal(await request('https://api.cesium.com/v1/assets/2275207/endpoint'),undefined);
assert.equal(await request('https://tile.googleapis.com/v1/3dtiles/root.json'),undefined);
assert.equal(await request('/api/tiles-config'),undefined);
assert.equal(fetchCount,0);
for(const path of ['/characters/player.glb','/textures/brick.jpg','/data/campus.json']){
 cache.set(base+path,new Response('stale asset'));const r=await request(path);assert.equal(await r.text(),'fresh asset');assert.equal(await cache.get(base+path).clone().text(),'fresh asset');
}
const before=fetchCount,path='/assets/game-AbCd1234.js';cache.set(base+path,new Response('immutable asset'));assert.equal(await (await request(path)).text(),'immutable asset');assert.equal(fetchCount,before);
console.log(JSON.stringify({passed:true,externalTilesCached:false,apiCached:false,unversionedAssetsRevalidated:3,hashedAssetsCacheFirst:true}));
