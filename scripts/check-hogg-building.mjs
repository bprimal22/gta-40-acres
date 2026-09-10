import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
registerHooks({load(url,c,next){if(!url.endsWith('.ts'))return next(url,c);return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};}});
const {buildHoggBuilding}=await import('../lib/campus/hogg-building.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const plan=JSON.parse(readFileSync(new URL('../public/data/hogg-plan.json',import.meta.url)));
const build=buildHoggBuilding({baseHeight:17.67,groundHeight:()=>16.7}),scene=new T.Group();
await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0}),checks=[];
try{
 let triangles=0,degenerate=0;
 for(const mesh of build.meshes){const a=mesh.geometry.attributes.position.array;assert(Array.from(a).every(Number.isFinite));for(let i=0;i<a.length;i+=9){const v=[0,3,6].map(j=>new T.Vector3(a[i+j],a[i+j+1],a[i+j+2]));if(new T.Vector3().crossVectors(v[1].sub(v[0]),v[2].sub(v[0])).lengthSq()<1e-14)degenerate++;triangles++;}scene.add(mesh);world.createCollider(RAPIER.ColliderDesc.trimesh(a,Uint32Array.from({length:a.length/3},(_,i)=>i),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));}
 assert(degenerate<10,`Unexpected degenerate triangle count ${degenerate}`);scene.updateWorldMatrix(true,true);world.step();
 const ray=new T.Raycaster();let compared=0,maxDifference=0;
 for(const w of build.witnesses){const origin=new T.Vector3(...w.origin),direction=new T.Vector3(...w.direction);ray.set(origin,direction);ray.far=4;const visible=ray.intersectObject(scene,true)[0],physical=world.castRay(new RAPIER.Ray(origin,direction),4,true);assert(visible&&physical,`Missing wall ${w.label}`);const difference=Math.abs(visible.distance-physical.timeOfImpact);assert(difference<.002,`${w.label}: physical disagreement ${difference}`);maxDifference=Math.max(maxDifference,difference);compared++;}
 checks.push({name:'Same final exterior buffers in Three and Rapier',compared,maxDifference,triangles,degenerate});
 const co=Math.cos(plan.rotationRadians),si=Math.sin(plan.rotationRadians);
 const worldVector=(x,y,z)=>new T.Vector3(plan.originXZ[0]+co*x-si*z,17.67+y,plan.originXZ[1]+si*x+co*z);
 const west=new T.Vector3(-co,0,-si),feature=[];
 for(const [label,z,expected] of [['recessed peach bay',-.098,'peach'],['projecting square pier',1.952,'limestone']]){const origin=worldVector(24.64,9,z);ray.set(origin,west);ray.far=4;const hit=ray.intersectObject(scene,true)[0];assert(hit,`${label} absent`);assert(hit.object.material.name.includes(expected),`${label}: ${hit.object.material.name}`);feature.push({label,material:hit.object.material.name,distance:hit.distance});}
 assert(feature[0].distance-feature[1].distance>.9,'Front porch must have real depth');checks.push({name:'Portico has peach back wall behind real square piers',feature});
 for(const m of build.materials){const s={vertexShader:'#include <uv_vertex>',fragmentShader:'#include <color_fragment>\n#include <normal_fragment_maps>'};m.onBeforeCompile(s,{});const first=JSON.stringify(s);m.onBeforeCompile(s,{});assert.equal(JSON.stringify(s),first);}
 checks.push({name:'Repeated shader preparation does not duplicate declarations'});
 const roofWitnesses=[];
 for(const [label,x,z,expected] of [['western pitched roof',-21,0,'Spanish clay'],['main central roof',0,0,'flat roof'],['front flat parapet roof',18,0,'flat roof']]){ray.set(worldVector(x,24,z),new T.Vector3(0,-1,0));ray.far=12;const hit=ray.intersectObject(scene,true)[0];assert(hit&&hit.object.material.name.includes(expected),`${label} wrong first surface: ${hit?.object.material.name}`);roofWitnesses.push({label,material:hit.object.material.name});}
 ray.set(worldVector(21.7,14,11.5),new T.Vector3(si,0,-co));ray.far=4;assert(ray.intersectObject(scene,true)[0],'Tall front parapet has an open side return');
 checks.push({name:'Roof surfaces cover inner masses and tall front side returns remain closed',roofWitnesses});

 for(const [label,x,y,z,removed] of [['Hogg central scan',-333,26,-87,true],['Flawn north wall',-329,26,-50,false],['Union service facade',-366,26,-77,false],['Existing road',-331,17,-68,false]]){const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([x-.01,y,z,x+.01,y,z,x,y+.01,z+.01],3));g.computeVertexNormals();const cut=subtractVolumes(g,new T.Matrix4(),build.volumes);assert(removed?cut&&cut.attributes.position.count===0:!cut||cut.attributes.position.count===3,`Cut scope incorrect at ${label}`);cut?.dispose();g.dispose();}
 checks.push({name:'Strict Hogg cuts remove its source mass and preserve road, FAC, Union witnesses'});
 const alt=buildHoggBuilding({baseHeight:20.67,groundHeight:()=>19.7});assert.equal(alt.meshes.length,build.meshes.length);let shiftMaxError=0;for(let m=0;m<build.meshes.length;m++){const a=build.meshes[m].geometry.attributes.position,b=alt.meshes[m].geometry.attributes.position;assert.equal(a.count,b.count);for(let i=0;i<a.count;i++)shiftMaxError=Math.max(shiftMaxError,Math.abs(b.getY(i)-a.getY(i)-3));}assert(shiftMaxError<.00002);for(const m of alt.meshes)m.geometry.dispose();for(const m of alt.materials)m.dispose();checks.push({name:'Changing measured base preserves registration and lifts all facade geometry together',shiftMaxError});
 const result={passed:true,stats:build.stats,strictCutVolumes:build.volumes.length,optionalFringeVolumes:build.registrationFringeVolumes.length,planAudit:plan.candidateCutAudit,checks,limits:'Isolated mesh/physics check with flat ground fixture. GLSL GPU compilation, terrain/entry joins and real controls await root browser verification.'};mkdirSync('/tmp/ut-iteration-47',{recursive:true});writeFileSync('/tmp/ut-iteration-47/hogg-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{world.free();for(const m of build.meshes)m.geometry.dispose();for(const m of build.materials)m.dispose();}
