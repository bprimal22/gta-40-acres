import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire, registerHooks } from 'node:module';
import { createHash } from 'node:crypto';

// Run from the existing game directory. The same validator can load either the
// staged package or the owner's installed module, without editing the game.
const require = createRequire(resolve('package.json'));
const ts = require('typescript');
const threeUrl = pathToFileURL(resolve('node_modules/three/build/three.module.js')).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === 'three') return { url: threeUrl, shortCircuit: true };
    if (specifier.startsWith('three/addons/')) return { url: pathToFileURL(resolve('node_modules/three/examples/jsm', specifier.slice('three/addons/'.length))).href, shortCircuit: true };
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText };
  },
});
const T = await import(threeUrl);
const RAPIER = await import(pathToFileURL(require.resolve('@dimforge/rapier3d-compat')).href);
const modulePath = process.env.UNION_MODULE ?? '../research/union-visual-package/lib/campus/union-building.ts';
const {buildUnionBuilding}=await import(pathToFileURL(resolve(modulePath)).href);
const {subtractVolumes}=await import(pathToFileURL(resolve('lib/campus/clip-volume.ts')).href);
const built=buildUnionBuilding();await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0}),scene=new T.Group(),ray=new T.Raycaster(),checks=[],rays=[];
try{
 assert.equal(built.meshes.length,built.colliderGeometries.length);assert(built.stats.triangles<180000);
 for(let i=0;i<built.meshes.length;i++){const m=built.meshes[i],g=m.geometry;assert.equal(g,built.colliderGeometries[i]);for(const [name,a]of Object.entries(g.attributes))assert(Array.from(a.array).every(Number.isFinite),`Nonfinite ${name}`);const p=g.attributes.position.array;world.createCollider(RAPIER.ColliderDesc.trimesh(p,Uint32Array.from({length:p.length/3},(_,i)=>i),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));scene.add(m);}
 scene.updateWorldMatrix(true,true);world.step();let maxDifference=0,deepRecesses=0;
 for(const w of [...built.wallSamples,...built.openingSamples]){const o=new T.Vector3(...w.origin),d=new T.Vector3(...w.direction);ray.set(o,d);ray.far=5;const visual=ray.intersectObject(scene,true)[0],physical=world.castRay(new RAPIER.Ray(o,d),5,true);assert(visual&&physical,`Missing ${w.kind} at ${w.origin}`);const diff=Math.abs(visual.distance-physical.timeOfImpact);assert(diff<.003,`Surface mismatch ${diff} at ${w.origin}`);maxDifference=Math.max(diff,maxDifference);if(w.kind.includes('glazing')&&visual.distance>2.5)deepRecesses++;rays.push({...w,visibleDistance:visual.distance,physicalDistance:physical.timeOfImpact});}
 checks.push({name:'Authored masonry, arch openings and glazing agree with physical surfaces',rays:rays.length,maxDifference,deepRecesses});assert(deepRecesses>50,'Recessed windows must not be covered by the inner core');
 // The central arch has a real curved aperture: below the spring it is open
 // toward the deep door; at the upper corner a ray must strike stone instead.
 const ep=built.entrancePoints.south,east=new T.Vector3(.9961778104,0,.08734902015),normal=new T.Vector3(-.08734902015,0,.9961778104),inward=normal.clone().negate();
 const probe=(dx,dy)=>{const o=new T.Vector3(...ep).addScaledVector(normal,2).addScaledVector(east,dx);o.y+=dy;ray.set(o,inward);ray.far=5;return ray.intersectObject(scene,true)[0]?.distance;};
 const archCenter=probe(.35,3.2),archCorner=probe(1.95,7.25);assert(archCenter>2.6,`Entry recess obstructed ${archCenter}`);assert(archCorner<2.35,`Arch corner missing ${archCorner}`);checks.push({name:'South entry is a curved opening with a deep door',archCenterDistance:archCenter,archUpperCornerDistance:archCorner});
 const roofChecks=[];for(const [name,x,z]of [['south tower',-393,4],['south wing',-370,0],['main hall',-385,-40],['west annexe',-407,-64],['north wing',-379,-122]]){const o=new T.Vector3(x,48,z),d=new T.Vector3(0,-1,0);ray.set(o,d);ray.far=40;const v=ray.intersectObject(scene,true)[0],p=world.castRay(new RAPIER.Ray(o,d),40,true);assert(v&&p&&Math.abs(v.distance-p.timeOfImpact)<.003,`Roof collision mismatch ${name}`);assert(v.face.normal.y>.3,`Roof faces downward ${name}`);roofChecks.push({name,x,z,height:48-v.distance});}assert(roofChecks[0].height>roofChecks[1].height+8,'Entry tower silhouette must rise above south wing');assert(roofChecks[2].height>roofChecks[3].height+4,'Low west annexe silhouette must remain distinct');checks.push({name:'Roof masses retain separate slopes and matching visible/physical surfaces',roofs:roofChecks});

 const witness=(x,y,z,volumes=built.volumes)=>{const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([x,y,z,x+.01,y,z,x,y+.01,z+.01],3));g.computeVertexNormals();const out=subtractVolumes(g,new T.Matrix4(),volumes);const gone=Boolean(out&&out.attributes.position.count===0);out?.dispose();g.dispose();return gone;};
 assert(witness(-385,25,-40));assert(!witness(-348,25,-80),'Hogg must be preserved');assert(!witness(-354,25,-48),'FAC must be preserved');assert(!witness(-360.5,16.7,-70.3),'Service road must be preserved');assert(!witness(-393,12,18),'South West Mall must be preserved');checks.push({name:'Cuts replace Union while preserving Hogg, FAC and surrounding routes'});

 // These four scan fragments were measured by the root's live ray survey.
 // A sloping ground fixture anchors the south at 14.18 m and service at 16.7 m;
 // the second pass must remove low wall material without cutting that ground.
 const measuredFragments=[[-390.8688567292661,18.167270068124623,9.729514007145983],[-398.580129277043,19.05128355861295,9.044066426100816],[-395.3559409431688,18.61707725635044,-104.59029007489042],[-405.0986054614142,26.211005892744367,-12.941359280669744]];
 const sampleGrade=(x,z)=>Math.max(13.46,Math.min(16.7,14.18+(9-z)*.032+(x+393.2)*.0166));
 const terrainBuilt=buildUnionBuilding({southBaseElevation:14.25,serviceBaseElevation:16.9,groundHeight:sampleGrade});
 try {
  const coverage=measuredFragments.map(([x,y,z])=>({position:[x,y,z],removed:witness(x,y,z,terrainBuilt.volumes),groundRetained:!witness(x,sampleGrade(x,z),z,terrainBuilt.volumes)}));
  assert(coverage.every(p=>p.removed&&p.groundRetained),'Measured high fragments must be cut while retaining locally sampled ground');
  const lowSouthWall=measuredFragments.slice(0,2).map(([x,,z])=>({position:[x,14.75,z],removed:witness(x,14.75,z,terrainBuilt.volumes)}));
  assert(lowSouthWall.every(p=>p.removed),'South fringe must not inherit the distant 16.9 m doorway floor');
  assert(!witness(-394.1367976152152,14.450295612185297,12.832441472505176,terrainBuilt.volumes),'The separate 4.09 m apron fragment is outside this asset');
  const keptRoutes=[[-348,25,-80],[-354,25,-48],[-360.5,16.7,-70.3],[-393,12,18]];
  assert(keptRoutes.every(p=>!witness(...p,terrainBuilt.volumes)),'Expanded cuts must preserve neighboring buildings and routes');
  checks.push({name:'Revision 2 local fringe removes all four measured high fragments and preserves their ground',cutVolumes:terrainBuilt.volumes.length,measuredFragments:coverage,lowSouthWall,apronFragment:'Intentionally outside 1.6 m building fringe; root owns its ground replacement',gradeFixture:'Affine south slope clamped to 13.46 m and 16.7 m, based on low-origin south survey and known service grade; not a replacement for integrated terrain sampling'});
 } finally {for(const m of terrainBuilt.meshes)m.geometry.dispose();for(const m of terrainBuilt.materials)m.dispose();}
 for(const m of built.materials.filter(m=>m.name.includes('coursed')||m.name.includes('barrel'))){const s={vertexShader:'#include <uv_vertex>',fragmentShader:'#include <color_fragment>\n#include <normal_fragment_maps>'};m.onBeforeCompile(s,{});const a=JSON.stringify(s);m.onBeforeCompile(s,{});assert.equal(a,JSON.stringify(s));}checks.push({name:'Masonry/tile PBR hooks are repeat-safe'});
 const meshHash=createHash('sha256');for(const mesh of built.meshes){meshHash.update(mesh.name);for(const [name,attribute]of Object.entries(mesh.geometry.attributes)){meshHash.update(name);meshHash.update(Buffer.from(attribute.array.buffer,attribute.array.byteOffset,attribute.array.byteLength));}}
 const geometrySha256=meshHash.digest('hex');assert.equal(geometrySha256,'bfddc28eaa794ae004327a470a6f3c81f1f43c69bda3625a7664c1861f9260b8','Revision 2 must preserve every authored geometry buffer');
 const result={passed:true,geometrySha256,cutVolumes:built.volumes.length,sourceSha256:createHash('sha256').update(readFileSync(resolve(modulePath))).digest('hex'),stats:built.stats,entrancePoints:built.entrancePoints,checks,rays,limits:'Standalone authored meshes and Rapier only; no live source tiles, exterior ground integration, rendered shader, browser playtest or performance acceptance.'};const out=process.env.UNION_EVIDENCE??'../research/union-visual-package/offline-check.json';mkdirSync(resolve(out,'..'),{recursive:true});writeFileSync(resolve(out),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({...result,rays:`${rays.length} rays in evidence JSON`},null,2));
}finally{world.free();for(const m of built.meshes)m.geometry.dispose();for(const m of built.materials)m.dispose();}
