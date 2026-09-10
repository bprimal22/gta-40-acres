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
const scene=walkway.surfaces;
const {buildWest24Buildings}=await import('../lib/campus/west24-buildings.ts');
const science=buildWest24Buildings(()=>9);
const {buildMainBuildingBase}=await import('../lib/campus/main-building-base.ts');
const {buildGdcFacades}=await import('../lib/campus/gdc-facade.ts');
const gdcCutFixture=buildGdcFacades({baseElevation:2.45,floors:6,floorHeight:4.45,returnDepth:12,courtyardDepth:34,screenReturns:true,southExteriorDepth:59.6033935149,southExteriorCutMinY:2.60,southExteriorCutEndY:2.02});
const inGdcCut=p=>gdcCutFixture.volumes.at(-1).bounds.containsPoint(new T.Vector3(...p))&&gdcCutFixture.volumes.at(-1).planes.every(q=>q.distanceToPoint(new T.Vector3(...p))<=1e-5);
const gdcCutWitnesses=[[42.3282325,22.6104102,11.2360581],[72.0321780,3.0032024,13.7820993],[69.7514976,2.5327613,13.5528207],
 [71.5677949,2.8558826,13.8305251],[72.7021504,3.1500004,13.7469747],[70.6714389,3.1499997,13.6183155],
 [69.7515055,3.1499998,13.4582131],[69.7514926,2.2362195,13.4582114],[69.7514965,2.3794597,13.6717115]];
for(const p of gdcCutWitnesses)assert(inGdcCut(p),'Measured GDC south scan fragment must be removed');
const gdcGroundWitnesses=[[32.9606232,2.2969797,10.5082128],[32.912496,2.2950478,11.0561030],[41.9606232,2.1374286,11.2987908],
 [41.912496,2.1363119,11.8466810],[53.9606232,2.0175805,12.3528948],[53.912496,2.0163834,12.9007850],
 [65.9606232,1.9010238,13.4069988],[65.912496,1.8952490,13.9548890],[76.9606232,1.8508360,14.3732608],[76.912496,1.8466709,14.9211510]];
for(const p of gdcGroundWitnesses)assert(!inGdcCut(p),'GDC sloping clearance must retain recorded ground');
const {buildMainEastEntry}=await import('../lib/campus/main-east-entry.ts');
const eastCutFixture=buildMainEastEntry({groundHeight:()=>18.52});
const eastCutWitnesses=[[-183.713198,26.368999,51.706699],[-183.661271,23.520854,51.456638],[-183.621429,20.746779,51.220915],[-182.894561,24.414470,42.204067],[-182.906032,22.343705,42.330110],[-182.905888,20.270631,42.455295],[-183.671946,24.203567,38.864805],[-182.608929,21.937383,39.277186],[-182.609563,20.102622,39.479542]];
const inEast=(p)=>eastCutFixture.volumes.some(v=>v.planes.every(q=>q.distanceToPoint(new T.Vector3(...p))<=1e-6));
for(const p of eastCutWitnesses){
 assert(inEast(p),'Measured east scan wall must be removed');
 assert(!inEast([p[0],18.52,p[2]]),'East doorway ground must remain');
 assert(!inEast([p[0],32,p[2]]),'Upper roof/Tower must remain');
}
const mainCutFixture=buildMainBuildingBase({groundHeight:()=>18.52});
const {buildWelchSouth}=await import('../lib/campus/welch-south.ts');
const welchCutFixture=buildWelchSouth({groundHeight:()=>5.8,baseElevation:5.8,eaveElevation:25.5,eastCutFringe:1.15,thresholdElevations:{east:5.8,south:6.2,west:6}});
const welchCutWitnesses=[[-24.563493,24.067433,3.054059],[-24.219949,24.445999,-2.468718]];
const inWelch=p=>welchCutFixture.volumes.some(v=>v.bounds.containsPoint(new T.Vector3(...p))&&v.planes.every(q=>q.distanceToPoint(new T.Vector3(...p))<=1e-6));
for(const p of welchCutWitnesses){
 assert(inWelch(p),'Measured Welch east scan lip must be removed');
 assert(!inWelch([p[0],5.8,p[2]]),'Welch facade clearance must preserve ground');
 assert(!inWelch([p[0],26,p[2]]),'Welch facade clearance must preserve upper roof');
}
const insideMainCut=(point)=>mainCutFixture.volumes.some(v=>v.planes.every(p=>p.distanceToPoint(new T.Vector3(...point))<=1e-6));
// Actual streamed wall hits recorded in the failed south-arcade view. The old
// 0.65 m outward fringe missed both; ground and the upper facade must survive.
const mainCutWitnesses=[[-223.1880255,25.633854,37.3875663],[-215.5446161,27.0965725,37.4574206]];
for(const p of mainCutWitnesses){
 assert(insideMainCut(p),'Main Building duplicate scan wall remains outside its bounded cut');
 assert(!insideMainCut([p[0],18.52,p[2]]),'Main Building cut removes pedestrian ground');
 assert(!insideMainCut([p[0],29.43,p[2]]),'Main Building cut reaches above the authored facade');
}
const ray=new T.Raycaster(),samples=[],occludedByGround=[];
function compare(origin,direction,name,min=0){
 const o=new T.Vector3(...origin),d=new T.Vector3(...direction);
 // A horizontal ray starting underneath retained soil is not a visible facade
 // probe: Rapier correctly hits the back of that ground while Three culls it.
 const groundRay=new T.Raycaster(new T.Vector3(o.x,24,o.z),new T.Vector3(0,-1,0),0,30);
 const soil=groundRay.intersectObject(scene,true).find(h=>h.face.normal.y>.6&&['Mall planting soil','Mall edge paving'].includes(h.object.material.name));
 if(soil&&soil.point.y>o.y-.02){
  const above={x:o.x,y:soil.point.y+.2,z:o.z};
  const p=world.castRay(new RAPIER.Ray(above,{x:0,y:-1,z:0}),.4,true);
  assert(p&&Math.abs(p.timeOfImpact-.2)<.004,`${name}: retained-yard surface mismatch`);
  occludedByGround.push({name,origin,groundY:soil.point.y,reason:'Facade sample is below retained sloping yard; it is not a passed opening check'});return;
 }
 ray.set(o,d);ray.far=5;
 const visual=ray.intersectObject(scene,true)[0],physical=world.castRay(new RAPIER.Ray(o,d),5,true);
 assert(visual&&physical,`${name}: missing surface`);
 const error=Math.abs(visual.distance-physical.timeOfImpact);assert(error<.004,`${name}: physics mismatch ${error}`);
 assert(visual.distance>=min,`${name}: an old shell covers the recessed opening`);
 samples.push({name,origin,direction,distance:visual.distance,error,material:visual.object.material.name});
}
try{
 for(const w of walkway.facadeSamples)compare(w.origin,w.direction,w.name,w.minimum);
 for(const w of science.witnesses)compare(w.origin,w.direction,`${w.abbr} entrance`,2.1);
 const modern=JSON.parse(readFileSync('public/data/east-south-modern-plan.json'));
 for(const b of modern.buildings)for(const ring of b.rings){
  const area=ring.reduce((s,p,i)=>s+p[0]*ring[(i+1)%ring.length][1]-ring[(i+1)%ring.length][0]*p[1],0);
  for(let i=0;i<ring.length;i++){
   const a=ring[i],c=ring[(i+1)%ring.length],dx=c[0]-a[0],dz=c[1]-a[1],len=Math.hypot(dx,dz);if(len<2)continue;
   const n=new T.Vector3(dz/len*Math.sign(area),0,-dx/len*Math.sign(area));
   for(const t of [.15,.35,.55,.75])for(const y of [b.base+1.713,b.base+6.117,b.base+7.943]){
    const p=new T.Vector3(a[0]+dx*t,y,a[1]+dz*t).addScaledVector(n,2.5);compare(p.toArray(),n.clone().negate().toArray(),`${b.abbr} facade`);
   }
  }
 }
 assert.equal(walkway.mallBuildings.buildings,0);
 assert.equal(walkway.historicCentral.buildings,5);assert.equal(walkway.eastSouthModern.buildings,2);
 const result={passed:true,samples:samples.length,occludedByGround,mainCutWitnesses,eastCutWitnesses,gdcCutWitnesses,gdcGroundWitnesses,maxError:Math.max(...samples.map(s=>s.error)),landscape:walkway.snapshot(),rays:samples,limits:'Full authored scene checks old-shell removal and visible/physical walls. Streamed meshes and visual acceptance require browser inspection.'};
 writeFileSync(process.env.UT_CHECK_OUTPUT??'/tmp/ut-iteration-48/integration-check.json',JSON.stringify(result,null,2)+'\n');
 console.log(JSON.stringify({...result,rays:undefined,landscape:{legacy:walkway.mallBuildings,historic:walkway.historicCentral,modern:walkway.eastSouthModern,science:walkway.west24Buildings}},null,2));
}finally{
 gdcCutFixture.dispose();
 for(const asset of [science,mainCutFixture,eastCutFixture,welchCutFixture]){for(const m of asset.meshes)m.geometry.dispose();for(const m of asset.materials)m.dispose();}
 walkway.dispose(world);world.free();
}
