import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as T from 'three';
registerHooks({load(url,context,next){
  if(!url.endsWith('/monochrome-sculpture.ts'))return next(url,context);
  return {format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
}});
const {buildMonochromeSculpture}=await import('../lib/campus/monochrome-sculpture.ts');
const model=buildMonochromeSculpture();
assert.equal(model.boats.length,70);assert(model.stats.drawCalls<=6);assert(model.stats.triangles<230000);
for(const g of model.geometries){
 for(const attribute of Object.values(g.attributes))assert([...attribute.array].every(Number.isFinite),'finite geometry');
 const n=g.attributes.normal;for(let i=0;i<n.count;i++){const len=Math.hypot(n.getX(i),n.getY(i),n.getZ(i));assert(len>.97 && len<1.03,'unit normals');}
}
const size=model.bounds.getSize(new T.Vector3());assert(size.y>14 && size.y<16.5);assert(size.x>10 && size.z>8);
assert(Math.abs(model.bounds.min.y)<1e-6,'pedestal begins at ground');
// The model owns only the narrow ground pier, not a building-sized canopy box.
assert(model.pedestalCollision.halfExtents[0]<.6 && model.pedestalCollision.halfExtents[2]<.6);
model.supportCollisionGeometry.computeBoundingBox();
const supportBounds=model.supportCollisionGeometry.boundingBox;
assert(supportBounds.max.y>7 && supportBounds.max.y<8,'support includes the raised truss');
assert(supportBounds.max.x<3 && supportBounds.min.x>-.7,'support excludes boat canopy');
assert(model.referenceEnvelope.containsBox(model.bounds),'removal reference covers authored sculpture');
assert(model.geometries.includes(model.supportCollisionGeometry),'collision geometry belongs to asset disposal');
const disposed=[];for(const g of model.geometries)g.addEventListener('dispose',()=>disposed.push(g.uuid));
for(const m of model.materials)m.addEventListener('dispose',()=>disposed.push(m.uuid));
const report={stats:model.stats,bounds:{min:model.bounds.min.toArray(),max:model.bounds.max.toArray(),size:size.toArray()},pedestalCollision:model.pedestalCollision,supportCollision:{triangles:model.supportCollisionGeometry.attributes.position.count/3,min:supportBounds.min.toArray(),max:supportBounds.max.toArray()},referenceEnvelope:{min:model.referenceEnvelope.min.toArray(),max:model.referenceEnvelope.max.toArray()},limits:'Photo-guided approximate layout; no claim of exact individual canoe placement. Pedestal and raised truss have collision geometry; overhead hulls and cables are visual-only. Reference envelope is an advisory inspection region, not a measured scan-removal volume.'};
model.dispose();model.dispose();assert.equal(disposed.length,model.geometries.length+model.materials.length);
writeFileSync('../research/scenery-reference-2026-09-06/hackerman/sculpture-fixture/geometry-check.json',JSON.stringify(report,null,2));
const js=ts.transpileModule(readFileSync('lib/campus/monochrome-sculpture.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText;
writeFileSync('../research/scenery-reference-2026-09-06/hackerman/sculpture-fixture/monochrome-sculpture.js',js);
console.log(JSON.stringify(report,null,2));
