import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){
    const u=new URL(`${s}.ts`,c.parentURL);if(existsSync(u))return{url:u.href,shortCircuit:true};
  }return next(s,c);
},load(url,c,next){
  if(!url.endsWith('.ts'))return next(url,c);
  return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
}});
const {buildGdcAtrium}=await import('../lib/campus/gdc-atrium.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const prefix=process.argv[2]??'iteration-32';assert(/^[a-z0-9-]+$/.test(prefix));
const asset=buildGdcAtrium(),frame=asset.frame;
const origin=new T.Vector3(...frame.origin),east=new T.Vector3(...frame.east).normalize(),south=new T.Vector3(...frame.south).normalize();
const at=(u,y,v)=>origin.clone().addScaledVector(east,u).addScaledVector(south,v).setY(y);
const local=p=>{const d=p.clone().sub(origin);return[d.dot(east),p.y,d.dot(south)];};
const group=new T.Group();group.add(...asset.meshes);group.updateWorldMatrix(true,true);
await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0});
for(const g of asset.colliderGeometries)
  world.createCollider(RAPIER.ColliderDesc.trimesh(g.attributes.position.array,
    Uint32Array.from({length:g.attributes.position.count},(_,i)=>i),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
world.step();
const checks=[],failures=[];
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){checks.push({name,passed:false});failures.push({name,error:e.message});}}
const ray=new T.Raycaster();
check('Finite, nondegenerate geometry stays within the central envelope',()=>{
  let triangles=0;const extents=new T.Box3();
  for(const g of asset.geometries){
    for(const a of Object.values(g.attributes))assert([...a.array].every(Number.isFinite));
    for(let i=0;i<g.attributes.position.count;i+=3){
      const ps=[0,1,2].map(j=>new T.Vector3().fromBufferAttribute(g.attributes.position,i+j));
      assert(ps[1].clone().sub(ps[0]).cross(ps[2].clone().sub(ps[0])).lengthSq()>1e-15);
      for(const p of ps){const q=local(p);extents.expandByPoint(new T.Vector3(...q));
        assert(Math.abs(q[2])<=7.80001,'side geometry exceeds wing boundary');assert(q[0]<=34.50001,'back exceeds authored cutoff');}
      triangles++;
    }
  }
  assert.equal(asset.meshes.length,5);assert.equal(asset.bands.length,5);assert.equal(asset.volumes.length,5);
  assert(Math.abs(extents.max.y-25.08)<.001);assert(asset.stats.triangles<18000);
  return{triangles,localMin:extents.min.toArray(),localMax:extents.max.toArray()};
});
check('Rendered glass and physics agree at all five levels',()=>{
  let samples=0,maxError=0;const rows=[];
  for(let i=0;i<asset.bands.length;i++){
    const b=asset.bands[i],y=b.low+(i?3.82:1.7);let glass=0;
    for(let v=-7.1;v<7.2;v+=.31){
      const p=at(b.front-3,y,v);ray.set(p,east);
      const shown=ray.intersectObject(group,true)[0],solid=world.castRay(new RAPIER.Ray(p,east),8,true);
      assert(shown&&solid,'glazing row has a hole');const error=Math.abs(shown.distance-solid.timeOfImpact);
      assert(error<.002,'visible/collision depth diverged');maxError=Math.max(error,maxError);samples++;
      if(shown.object.material===asset.materials.glass)glass++;
    }
    assert(glass>20,'glazing articulation lost');rows.push({band:i,glassSamples:glass});
  }
  // Door is set behind the fixed side glass, so the entrance has real depth.
  const depth=v=>{ray.set(at(13,4.1,v),east);return ray.intersectObject(group,true)[0].distance;};
  const entranceRecess=depth(.7)-depth(3.1);assert(entranceRecess>.65&&entranceRecess<.95);
  return{samples,maxError,entranceRecess,rows};
});
check('Open trellis cells reveal glass and decorative grids do not collide',()=>{
  const mesh=asset.meshes.find(m=>m.material===asset.materials.trellis);
  assert(!asset.colliderGeometries.includes(mesh.geometry));let cells=0,bars=0;
  for(const b of asset.bands.slice(1)){
    for(let j=0;j<32;j++){
      const v=-7.63+(j+.5)*15.26/76,y=b.low+.12+.5*2.44/14;
      ray.set(at(b.front-1,y,v),east);const hit=ray.intersectObject(group,true)[0];assert(hit);
      if(hit.object.material!==asset.materials.trellis)cells++;
      ray.set(at(b.front-1,y,-7.63+j*15.26/76),east);
      if(ray.intersectObject(group,true)[0]?.object.material===asset.materials.trellis)bars++;
    }
  }
  assert(cells>100&&bars>100,'trellis must have real openings and bars');return{openCellSamples:cells,barSamples:bars};
});
check('Horizontal terraces close each retreat with upward collision surfaces',()=>{
  const terraces=[];
  for(let i=1;i<asset.bands.length;i++){
    const b=asset.bands[i],next=asset.bands[i+1],u=next?(b.front+next.front)/2:(b.front+34.5)/2;
    const p=at(u,b.high+.4,2.31),down=new T.Vector3(0,-1,0);ray.set(p,down);
    const shown=ray.intersectObject(group,true)[0],solid=world.castRay(new RAPIER.Ray(p,down),1,true);
    assert(shown&&solid&&shown.face.normal.y>.99);assert(Math.abs(shown.point.y-b.high)<.002);
    assert(Math.abs(shown.distance-solid.timeOfImpact)<.002);terraces.push({u,y:shown.point.y});
  }return terraces;
});
function fragment(u,y,v,clear,volumes=asset.volumes){
  const g=new T.BoxGeometry(.04,.04,.04).translate(...at(u,y,v).toArray());
  const cut=subtractVolumes(g,new T.Matrix4(),volumes);
  try{if(clear)assert(cut&&cut.attributes.position.count===0,'in-profile source remains');else assert.equal(cut,null,'outside-profile source was cut');}
  finally{g.dispose();cut?.dispose();}
}
check('Stepped source cuts preserve courtyard, side wings and remote roof',()=>{
  for(const b of asset.bands)fragment(b.front+2,(b.low+b.high)/2,0,true);
  for(const p of [[0,4,0],[12,12,0],[18,17,0],[25,22,0],[25,12,8.1],[35,12,0],[32,26,0],[20,1.9,0]])fragment(...p,false);
  const source=JSON.parse(readFileSync(new URL('../evidence/iteration-32-courtyard-source-probes.json',import.meta.url)));
  const tested=[];
  for(const y of [3,8,12,17,22]){
    const row=source.horizontal.find(p=>p.v===0&&Math.abs(p.y-y)<.01);
    const hits=row.hits.filter(h=>h.point[0]>35);assert(hits.length);
    for(const hit of hits){const q=local(new T.Vector3(...hit.point));fragment(...q,true);tested.push(q);}
  }
  const lower=source.horizontal.find(p=>p.v===0&&p.y===5).hits.at(-1);
  const lowerLocal=local(new T.Vector3(...lower.point));fragment(...lowerLocal,false);
  return{sourceCenterlineCleared:tested,outsideCentralProfile:lowerLocal,
    outsideNote:'Lower warped source face is deliberately outside this central cut; main courtyard clearance covers this location.',preserved:['sculpture','open courtyard','upper stepped recess','side wing','back continuation','higher roof','ground beneath repair']};
});
check('Measured 1.05m front cleanup removes visible wedges without moving the model',()=>{
  const cleanup=buildGdcAtrium({clearancePadding:1.05});
  try{
    assert.deepEqual(cleanup.bands,asset.bands);assert.deepEqual(cleanup.bounds,asset.bounds);
    assert.deepEqual(cleanup.stats,asset.stats);
    for(let i=0;i<asset.geometries.length;i++)
      assert.deepEqual(cleanup.geometries[i].attributes.position.array,asset.geometries[i].attributes.position.array);
    for(let i=0;i<cleanup.volumeRecords.length;i++){
      const before=asset.volumeRecords[i],after=cleanup.volumeRecords[i];
      assert(Math.abs(before.minU-after.minU-.93)<1e-8);
      for(const key of ['maxU','minV','maxV','minY','maxY'])assert.equal(after[key],before[key],`${key} must not widen`);
    }
    const source=JSON.parse(readFileSync(new URL('../evidence/iteration-32-remaining-scan-fragments.json',import.meta.url)));
    const removed=[],preserved=[];
    for(const sample of source.samples)for(const hit of sample.hits){
      const q=local(new T.Vector3(...hit.point));
      const targeted=q[1]<25.08&&Math.abs(q[2])<7.8&&q[0]<34.5;
      // The captured visible fragments survived the original clipping. The
      // enlarged front allowance must remove those exact recorded locations.
      fragment(...q,false);
      fragment(...q,targeted,cleanup.volumes);
      (targeted?removed:preserved).push({pixel:sample.pixel,local:q});
    }
    assert.equal(removed.length,5,'expected three top-bar and two lower-wedge points');
    assert.equal(preserved.length,7,'neighboring/back/high source hits must survive');
    const guards=[{name:'north wing',point:[30,24,-8.0]},{name:'south wing',point:[30,24,8.0]},
      {name:'back continuation',point:[34.8,24,0]},{name:'ground beneath repair',point:[29,2.0,0]},
      {name:'roof above fixed25.20m ceiling',point:[32,25.4,0]},{name:'just ahead of cleanup',point:[28.6,24,0]},
      {name:'open courtyard',point:[13,4,0]},{name:'sculpture',point:[0,4,0]}];
    for(const {point}of guards)fragment(...point,false,cleanup.volumes);
    return{clearancePadding:1.05,geometryUnchanged:true,frontExpansionMetres:.93,
      clearance:cleanup.volumeRecords,recordedFragmentsRemoved:removed,
      recordedNeighborsPreserved:preserved,syntheticGuards:guards.map(({name})=>name)};
  }finally{cleanup.dispose();}
});
check('Datum shift moves geometry and cuts together; disposal is idempotent',()=>{
  const other=buildGdcAtrium({baseElevation:3.45});
  try{assert(Math.abs(other.bounds.min.y-asset.bounds.min.y-1)<.001);assert(Math.abs(other.bounds.max.y-asset.bounds.max.y-1)<.001);
    assert.equal(other.volumeRecords[0].minY,asset.volumeRecords[0].minY+1);}
  finally{other.dispose();other.dispose();}return{shiftMetres:1};
});
const report={passed:failures.length===0,checks,failures,stats:asset.stats,profile:asset.bands,clearance:asset.volumeRecords,
  limits:'Real geometry, renderer rays and Rapier trimeshes; synthetic patch clipping and saved source/visible-fragment probes. No live tile requests or game-browser actions. Screens/handles are decorative and entrance is closed. Integrated screenshots revealed the tested leftovers; post-cleanup appearance still requires main-scene inspection.'};
writeFileSync(new URL(`../evidence/${prefix}-gdc-atrium-check.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));world.free();asset.dispose();
// Export an isolated module snapshot for the optional local visual fixture.
const dir='/tmp/ut-gdc-atrium-fixture';mkdirSync(dir,{recursive:true});
for(const [name,source] of [['gdc-atrium','../lib/campus/gdc-atrium.ts'],['sky-environment','../lib/campus/sky-environment.ts']]){
  const text=readFileSync(new URL(source,import.meta.url),'utf8');writeFileSync(`${dir}/${name}.js`,ts.transpileModule(text,
    {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText);
}
if(failures.length)process.exitCode=1;
