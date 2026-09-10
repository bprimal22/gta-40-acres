import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
registerHooks({load(url,c,next){if(!url.endsWith('.ts'))return next(url,c);return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};}});
const {buildWest24Buildings}=await import('../lib/campus/west24-buildings.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const plan=JSON.parse(readFileSync('public/data/west24-buildings-plan.json'));
const b=buildWest24Buildings(()=>9),scene=new T.Group();await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0});
let rays=0,maxDifference=0;const checks=[];
try{
 for(const mesh of b.meshes){const p=mesh.geometry.attributes.position.array;assert(Array.from(p).every(Number.isFinite));scene.add(mesh);world.createCollider(RAPIER.ColliderDesc.trimesh(p,Uint32Array.from({length:p.length/3},(_,i)=>i),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));}
 scene.updateWorldMatrix(true,true);world.step();const ray=new T.Raycaster();
 for(const building of plan.buildings){
  const r=building.rings[0],area=r.reduce((s,p,i)=>s+p[0]*r[(i+1)%r.length][1]-r[(i+1)%r.length][0]*p[1],0);
  const edges=r.map((a,i)=>({a,c:r[(i+1)%r.length]})).sort((a,b)=>Math.hypot(b.c[0]-b.a[0],b.c[1]-b.a[1])-Math.hypot(a.c[0]-a.a[0],a.c[1]-a.a[1])).slice(0,4);
  for(const {a,c} of edges){const normal=new T.Vector3(c[1]-a[1],0,a[0]-c[0]).normalize().multiplyScalar(Math.sign(area));
   for(let floor=0;floor<building.floors;floor++)for(const t of [.27,.5,.73]){
    const origin=new T.Vector3(T.MathUtils.lerp(a[0],c[0],t),building.base+(floor+.52)*building.floorHeight,T.MathUtils.lerp(a[1],c[1],t)).addScaledVector(normal,2),direction=normal.clone().negate();
    ray.set(origin,direction);ray.far=3;const visible=ray.intersectObject(scene,true)[0],physical=world.castRay(new RAPIER.Ray(origin,direction),3,true);
    assert(visible&&physical,`${building.abbr}: missing wall`);const difference=Math.abs(visible.distance-physical.timeOfImpact);assert(difference<.002,`${building.abbr}: physical wall differs ${difference}`);maxDifference=Math.max(maxDifference,difference);rays++;
   }
  }
 }
 checks.push({name:'Exterior walls and recessed glass agree with physical geometry',rays,maxDifference});
 for(const m of b.materials){if(!m.name.match(/buff brick|limestone$|roof tile/))continue;const s={vertexShader:'#include <uv_vertex>',fragmentShader:'#include <color_fragment>'};m.onBeforeCompile(s,{});const first=JSON.stringify(s);m.onBeforeCompile(s,{});assert.equal(JSON.stringify(s),first,'Shader hook must be idempotent');}
 checks.push({name:'Masonry shader hooks tolerate repeated compilation'});
 for(const p of [[-70,17,-112],[-140,20,-120],[-180,21,-183],[-230,20,-124]]){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([p[0]-.01,p[1],p[2],p[0]+.01,p[1],p[2],p[0],p[1]+.01,p[2]+.01],3));g.computeVertexNormals();const cut=subtractVolumes(g,new T.Matrix4(),b.volumes);assert(cut&&cut.attributes.position.count===0,`Old shell witness survives: ${p.join(",")}`);cut.dispose();g.dispose();}
 checks.push({name:'Old scanned building witnesses removed in all four replacements'});
 const witness=(x,y,z,cuts=b.volumes)=>{const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([x-.01,y,z,x+.01,y,z,x,y+.01,z+.01],3));g.computeVertexNormals();const clipped=subtractVolumes(g,new T.Matrix4(),cuts);const survives=!clipped||clipped.attributes.position.count>0;clipped?.dispose();g.dispose();return survives;};
 const courtCuts=b.volumes.filter(v=>Math.abs(v.bounds.min.y-14.9)<.001);assert(courtCuts.length>0);
 assert(!witness(-199,33,-173),'Gearing floating roof fragment must be cleared');
 assert(witness(-199,12,-173,courtCuts),'Gearing court ground must remain');
 assert(witness(-245,33,-173,courtCuts),'Unrelated building outside courtyard must remain');
 checks.push({name:'Gearing upper courtyard cut clears scan beam without extending into lower ground or outside buildings'});

 const result={passed:true,stats:b.stats,materialBatches:b.meshes.length,checks,limits:'Authored geometry with flat ground fixture; actual road, source tiles, shader rendering and controls are checked separately.'};writeFileSync('/tmp/ut-iteration-46/west24-buildings-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{world.free();for(const mesh of b.meshes)mesh.geometry.dispose();for(const material of b.materials)material.dispose();}
