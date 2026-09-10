import type {CampusWorld} from './world';

/** Minimal closed local support for the existing authored Tower shaft.
 * Reuses its exact center, 17.98 m footprint and rotation; this is an inferred
 * internal Main Building core, not a reconstruction of the surrounding wings.
 * Geometry, collider, material and disposal ownership all stay with CampusWorld.
 */
export function buildOfflineTowerBase(world:CampusWorld){
  const [x,z]=world.data.landmarks.MAI.position;
  const rotation=.085,width=17.98,datum=world.terrain.height(x,z),top=datum+15;
  const point=(u:number,t:number)=>[x+u*Math.cos(rotation)+t*Math.sin(rotation),z-u*Math.sin(rotation)+t*Math.cos(rotation)] as [number,number];
  const heights:number[]=[];
  // Also sample the interior so a local contour dip cannot leave a corner of
  // the core hanging above the fallback terrain. No external ground changes.
  for(let i=0;i<=8;i++)for(let j=0;j<=8;j++)heights.push(world.terrain.height(...point(width*(i/8-.5),width*(j/8-.5))));
  const minTerrain=Math.min(...heights),maxTerrain=Math.max(...heights),bottom=minTerrain-.30;
  if(![datum,top,bottom,maxTerrain].every(Number.isFinite)||bottom>=top)throw new Error('Invalid offline Tower base terrain');
  world.box(x,(bottom+top)/2,z,width,top-bottom,width,world.mat.stone,true,rotation);
  return{scope:'Closed internal Main Building core beneath existing Tower shaft only',center:[x,z],rotation,width,bottom,top,minTerrain,maxTerrain,terrainSamples:heights.length,triangles:12,colliders:1,materialsOwned:0,geometryInferred:true,footprint:[point(-width/2,-width/2),point(width/2,-width/2),point(width/2,width/2),point(-width/2,width/2)]};
}
