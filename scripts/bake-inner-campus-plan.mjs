// Bake fitted road grades and exact old-ground joins into a local mesh plan.
// Survey measurements are retained separately; the fitted surface is an
// intentional reconstruction, not a claim of survey-grade terrain accuracy.
import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import {createHash} from 'node:crypto';
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
const {SpeedwayWalkway}=await import('../lib/campus/walkway.ts');
const {Terrain}=await import('../lib/campus/terrain.ts');
const packet='../research/inner-campus-union-reference-2026-09-06/';
const candidate=JSON.parse(readFileSync(packet+'candidate-ground-plan.json'));
const refs=JSON.parse(readFileSync(packet+'route-reference.json'));
const seams=JSON.parse(readFileSync(packet+'authored-seam-probes.json'));
const data=JSON.parse(readFileSync('public/data/campus.json'));
const terrain=new Terrain(JSON.parse(readFileSync('public/data/terrain.json')));
// Chainage/elevation pairs fitted to the low-origin 19 m rays. At the initial
// join and West Mall endpoint the current authored floor is authoritative.
// Parked-car/canopy spikes and below-road duplicate scan layers are excluded.
const grades={
  15387933:[[0,14.553],[19,14.54],[32.27,15.643],[41.32,16.003],[46.17,16.071],
    [50.78,16.12],[59.99,16.50],[69.21,16.64],[78.42,16.925],[86.63,17.20],[94.8429,17.26]],
  31954662:[[0,16.071],[10,16.019],[24,16.02],[42,16.138],[52,16.176],[65.27,16.304],[73.5985,16.372]],
  126328799:[[0,16.372],[5.58,16.407],[10.39,16.45],[17.3189,16.52]],
  130309571:[[0,17.26],[8.06,17.453],[13.04,17.498],[18.03,17.302],[23.01,17.028],
    [27.99,16.815],[32.98,16.617],[37.96,16.479],[42.95,16.337],[47.93,16.272],[52.91,16.30],[57.8985,16.60]],
};
function lerpKnots(knots,s){for(let i=1;i<knots.length;i++)if(s<=knots[i][0]){
  const a=knots[i-1],b=knots[i];return T.MathUtils.lerp(a[1],b[1],T.MathUtils.clamp((s-a[0])/(b[0]-a[0]),0,1));
}return knots.at(-1)[1];}
function closestOn(a,b,x,z){const dx=b[0]-a[0],dz=b[1]-a[1],l=Math.hypot(dx,dz);
  const t=T.MathUtils.clamp(((x-a[0])*dx+(z-a[1])*dz)/(l*l),0,1);
  const px=a[0]+dx*t,pz=a[1]+dz*t;return{x:px,z:pz,t,length:l,d:Math.hypot(x-px,z-pz),dx,dz};}
function routeAt(x,z){let best={d:Infinity};for(const route of refs.routeSegments){let along=0;
  for(let i=1;i<route.pointsXZ.length;i++){const q=closestOn(route.pointsXZ[i-1],route.pointsXZ[i],x,z);
    if(q.d<best.d)best={...q,way:route.osmWayId,s:along+q.t*q.length};along+=q.length;
  }}return best;}
const boundaryEdges=seams.boundaryLines.flatMap(r=>r.slice(1).map((b,i)=>[r[i],b]));
await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0});
const descriptor=Object.getOwnPropertyDescriptor(T.TextureLoader.prototype,'load');let walkway;
try{T.TextureLoader.prototype.load=()=>new T.Texture();
  walkway=new SpeedwayWalkway(data,terrain,world,{capabilities:{getMaxAnisotropy:()=>8}},true);
}finally{Object.defineProperty(T.TextureLoader.prototype,'load',descriptor);}
walkway.surfaces.updateWorldMatrix(true,true);
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),plane=new T.Plane();
const oldRoots=walkway.surfaces.children.filter(m=>!m.name.startsWith('Inner Campus'));
let joinedVertices=0,unresolvedBoundaryVertices=0;
function oldHeightAt(q,x,z){
  // Search both sides of the finite old boundary. A hit's triangle plane,
  // rather than its offset hit height, provides the exact boundary elevation.
  for(const offset of [0,.015,-.015,.08,-.08]){
    const px=q.x-q.dz/q.length*offset,pz=q.z+q.dx/q.length*offset;
    ray.set(new T.Vector3(px,terrain.height(px,pz)+3,pz),down);ray.far=9;
    const h=ray.intersectObjects(oldRoots,true).find(h=>h.face&&h.face.normal.clone().transformDirection(h.object.matrixWorld).y>.6);
    if(h){const n=h.face.normal.clone().transformDirection(h.object.matrixWorld);
      plane.setFromNormalAndCoplanarPoint(n,h.point);return -(n.x*x+n.z*z+plane.constant)/n.y;}
  }return null;
}
const heightCache=new Map();
function height(x,z,kind){const key=`${x},${z},${kind}`;if(heightCache.has(key))return heightCache.get(key);
  const p=routeAt(x,z),base=lerpKnots(grades[p.way],p.s);
  // Footway and service court stay flush; sidewalks rise gently out of the
  // junction aprons so a curb does not run across a turning route.
  const nearJunction=Math.min(Math.hypot(x+255.063,z+63.95),Math.hypot(x+303.52,z+68.506),Math.hypot(x+262.09,z-9.311));
  const curb=(kind==='sidewalk'?.12:kind==='planting'?.10:0)*T.MathUtils.smoothstep(nearJunction,4,9);
  let y=base+curb,edge={d:Infinity};for(const [a,b] of boundaryEdges){const q=closestOn(a,b,x,z);if(q.d<edge.d)edge=q;}
  if(edge.d<3){const existing=oldHeightAt(edge,x,z);if(existing!==null){
    y=T.MathUtils.lerp(existing,y,T.MathUtils.smoothstep(edge.d,0,3));joinedVertices++;
  }else if(edge.d<.002)unresolvedBoundaryVertices++;}
  assert(Number.isFinite(y));heightCache.set(key,y);return y;
}
const surfaces=candidate.surfaces.map(cell=>{
  const center=cell.ring.reduce((s,p)=>[s[0]+p[0]/cell.ring.length,s[1]+p[1]/cell.ring.length],[0,0]);
  const route=routeAt(...center);
  const material=cell.kind==='planting'?'planting':cell.kind==='road'&&[15387933,31954662].includes(route.way)?'asphalt':'concrete';
  return{kind:cell.kind,material,ring:cell.ring.map(([x,z])=>[x,height(x,z,cell.kind),z])};
});
assert.equal(unresolvedBoundaryVertices,0,`Unresolved old-ground boundary vertices: ${unresolvedBoundaryVertices}`);
function insideRing(x,z,ring){let hit=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if((a[1]>z)!==(b[1]>z)&&x<(b[0]-a[0])*(z-a[1])/(b[1]-a[1])+a[0])hit=!hit;
}return hit;}
const planting=candidate.surfaces.filter(c=>c.kind==='planting');
const inPlanting=(x,z)=>planting.some(c=>insideRing(x,z,c.ring));
const trees=[];
for(const r of refs.routeSegments){let along=0;for(let i=1;i<r.pointsXZ.length;i++){
  const a=r.pointsXZ[i-1],b=r.pointsXZ[i],dx=b[0]-a[0],dz=b[1]-a[1],len=Math.hypot(dx,dz);
  for(let s=Math.ceil((along+4)/18)*18;s<along+len-3;s+=18)for(const side of [-1,1]){
    const t=(s-along)/len,x=a[0]+dx*t-dz/len*8.3*side,z=a[1]+dz*t+dx/len*8.3*side;
    if(!Array.from({length:9},(_,j)=>j?inPlanting(x+Math.cos(j*Math.PI/4)*1.1,z+Math.sin(j*Math.PI/4)*1.1):inPlanting(x,z)).every(Boolean))continue;
    if(trees.some(p=>Math.hypot(p.x-x,p.z-z)<10))continue;
    trees.push({x,z,y:height(x,z,'planting')-.02,rotation:s*.41+side,scale:.88,width:.80,height:.95});
  }along+=len;
}}
const clearance=candidate.outline.flatMap(rings=>{
  const r=rings.map(ring=>ring.map(p=>new T.Vector2(...p))),points=r.flat();
  return T.ShapeUtils.triangulateShape(r[0],r.slice(1)).map(ids=>ids.map(i=>[points[i].x,height(points[i].x,points[i].y,'road'),points[i].y]));
});
const result={source:'Mapped routes and official building exclusions; low-origin live samples from iteration46; current authored triangle planes at old/new joins',
  limits:'Fitted reconstruction. Road widths, curb treatment and vegetation remain approximate; browser replay required.',
  routes:refs.routeSegments.map(r=>({wayId:r.osmWayId,points:r.pointsXZ,grades:grades[r.osmWayId]})),
  routeMeters:refs.totalMappedLengthM,surfaces,clearance,trees,
  stats:{surfaceCells:surfaces.length,clearanceCells:clearance.length,trees:trees.length,joinedVertices,unresolvedBoundaryVertices},
  evidenceSha256:{survey:createHash('sha256').update(readFileSync(packet+'live-survey-iteration-46.json')).digest('hex'),
    candidate:createHash('sha256').update(readFileSync(packet+'candidate-ground-plan.json')).digest('hex')}};
writeFileSync('public/data/inner-campus-plan.json',JSON.stringify(result)+'\n');
writeFileSync(packet+'baked-grade-audit.json',JSON.stringify({...result.stats,evidenceSha256:result.evidenceSha256},null,2)+'\n');
walkway.dispose(world);world.free();console.log(JSON.stringify(result.stats));
