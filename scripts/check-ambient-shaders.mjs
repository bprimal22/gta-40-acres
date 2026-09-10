// Regression for a real shader compile failure: delegated asphalt hooks caused
// duplicate tone-mapping declarations. Exercise hooks without a mocked shader.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as THREE from 'three';

registerHooks({ load(url, context, next) {
  if (url.endsWith('.ts')) return { format:'module', shortCircuit:true,
    source:ts.transpileModule(readFileSync(new URL(url),'utf8'), { compilerOptions:{ target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.ESNext } }).outputText };
  return next(url,context);
} });
const { CampusAmbientOcclusion } = await import('../lib/campus/ambient-occlusion.ts');
const scene=new THREE.Scene(), geometry=new THREE.BoxGeometry();
const source=new THREE.MeshStandardMaterial();
source.onBeforeCompile=shader=>{shader.fragmentShader='// Original material detail\n'+shader.fragmentShader;};
const delegated=new THREE.MeshStandardMaterial();
delegated.onBeforeCompile=(shader,renderer)=>source.onBeforeCompile(shader,renderer);
const photographed=new THREE.MeshBasicMaterial({toneMapped:false});
const originalPhotoHook=photographed.onBeforeCompile.bind(photographed);
for(const material of [source,delegated,photographed])scene.add(new THREE.Mesh(geometry,material));
const pipeline=Object.create(CampusAmbientOcclusion.prototype);pipeline.scene=scene;pipeline.pipelineRequested=true;
pipeline.prepareMaterials();
const checks=[];
for(const [name,material]of[['source material',source],['delegated material',delegated]]){
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  material.onBeforeCompile(shader,{toneMappingExposure:.88});
  assert.equal(shader.fragmentShader.split('#define CAMPUS_DISPLAY_LINEAR').length-1,1);
  assert.equal(shader.fragmentShader.split('#include <tonemapping_pars_fragment>').length-1,1);
  assert.equal(shader.fragmentShader.split('ACESFilmicToneMapping(gl_FragColor.rgb)').length-1,1);
  assert.ok(shader.fragmentShader.includes('// Original material detail'));
  checks.push({name,passed:true});
}
const photoShader={uniforms:{},vertexShader:THREE.ShaderLib.basic.vertexShader,fragmentShader:THREE.ShaderLib.basic.fragmentShader};
const photoCopy={...photoShader};originalPhotoHook(photoCopy,{});photographed.onBeforeCompile(photoShader,{});
assert.equal(photoShader.fragmentShader,photoCopy.fragmentShader);
checks.push({name:'unlit photographed material remains unmodified',passed:true});
geometry.dispose();for(const m of[source,delegated,photographed])m.dispose();
const report={passed:true,checks,limits:'Runs actual installed ShaderLib sources through hooks. Browser shader compilation and appearance are verified separately.'};
writeFileSync('evidence/iteration-37-shader-check.json',JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
