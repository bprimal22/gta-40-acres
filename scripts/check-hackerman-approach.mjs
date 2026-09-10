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
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const {characterSupported}=await import('../lib/campus/character-support.ts');
const prefix=process.argv[2]??'iteration-33';assert(/^[a-z0-9-]+$/.test(prefix),'safe evidence prefix');
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
const a=new T.Vector3(12.785,0,-135.382),b=new T.Vector3(-70,0,-142.867);
const along=b.clone().sub(a).normalize(),across=new T.Vector3(-along.z,0,along.x),length=a.distanceTo(b);
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),identity=new T.Matrix4(),checks=[],failures=[];
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){checks.push({name,passed:false});failures.push({name,error:e.message});}}
function ground(x,z){
  const y=terrain.height(x,z)+2,origin=new T.Vector3(x,y,z);ray.set(origin,down);ray.far=6;
  const shown=ray.intersectObject(walkway.surfaces,true)[0];
  const solid=world.castRay(new RAPIER.Ray(origin,down),6,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
  assert(shown&&solid,`missing walking ground at ${x.toFixed(3)},${z.toFixed(3)} (render=${!!shown}, collision=${!!solid})`);
  assert(shown.face.normal.y>.8,`ground does not face upward at ${x},${z}`);
  const disagreement=Math.abs(shown.point.y-(y-solid.timeOfImpact));
  assert(disagreement<.003,`ground/collider disagreement ${disagreement.toFixed(4)}m at ${x.toFixed(3)},${z.toFixed(3)}`);
  return{height:shown.point.y,disagreement,material:shown.object.material,mesh:shown.object.name};
}
function witness(p){
  const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([
    p[0]-.025,p[1]-.025,p[2],p[0]+.025,p[1]-.025,p[2],p[0],p[1]+.025,p[2]+.015],3));
  g.computeVertexNormals();return g;
}
function sourcePatch(name,p,cleared){
  const g=witness(p),trimmed=subtractVolumes(g,identity,walkway.volumes);
  try{
    if(cleared)assert(trimmed&&trimmed.attributes.position.count===0,`${name}: source triangle was not fully removed`);
    else assert(trimmed===null,`${name}: source beyond the repair was changed`);
  }finally{g.dispose();trimmed?.dispose();}
}
check('Westward East 24th paving has continuous upward ground and matching collision',()=>{
  const observations=[];let maxRenderCollisionError=0;
  const n=Math.ceil(length/1.5);
  for(let i=0;i<=n;i++)for(const lateral of [-3.5,0,3.5]){
    const p=a.clone().addScaledVector(along,.5+(length-1)*i/n).addScaledVector(across,lateral),g=ground(p.x,p.z);
    assert(g.material!==walkway.materials[1],'grass covers the approach paving');
    maxRenderCollisionError=Math.max(maxRenderCollisionError,g.disagreement);
    observations.push({x:p.x,z:p.z,lateral,height:g.height,mesh:g.mesh});
  }
  return{length,samples:observations.length,maxRenderCollisionError,observations};
});
check('Approach joins Speedway and both forecourt edges without a ground gap or curb',()=>{
  const southZ=x=>-141.89+(x+73)*6.29/80.85;
  const roadAt55=a.clone().addScaledVector(along,(-55-a.x)/along.x);
  const transects=[{name:'Speedway junction',origin:a,axis:along,span:3},
    {name:'forecourt south edge',origin:new T.Vector3(-34,0,southZ(-34)),axis:new T.Vector3(0,0,1),span:2},
    {name:'western forecourt south edge',origin:new T.Vector3(-60,0,southZ(-60)),axis:new T.Vector3(0,0,1),span:2},
    {name:'western 24th brick edge into forecourt',origin:roadAt55.clone().addScaledVector(across,4.45),axis:across,span:2}];
  const results=[];
  for(const t of transects){
    let previous,maxIncrement=0;const samples=[];
    for(let s=-t.span+.0625;s<t.span;s+=.125){
      const p=t.origin.clone().addScaledVector(t.axis,s),g=ground(p.x,p.z);
      if(previous!==undefined){const increment=Math.abs(g.height-previous);maxIncrement=Math.max(maxIncrement,increment);assert(increment<.12,`${t.name}: abrupt ${increment.toFixed(3)}m height change`);}
      previous=g.height;samples.push({x:p.x,z:p.z,height:g.height});
    }
    results.push({name:t.name,maxIncrement,samples});
  }return results;
});
check('Recorded obstructing canopy fragments are removed within the westward repair',()=>{
  const points=[[-4.535,10.49,-130.364],[-4.451,9.249,-132.716],[-43.723,14.007,-149.55],[-46.875,16.605,-152.095]];
  points.forEach((p,i)=>sourcePatch(`recorded canopy ${i+1}`,p,true));return{points};
});
check('Welch north wing is replaced while its other wings and high NHB context survive',()=>{
  const observations=[[-70,12,-112],[-50,22,-108],[-90,18,-117]];
  observations.forEach((p,i)=>sourcePatch(`Welch replaced north wing ${i}`,p,true));
  sourcePatch('Welch retained southern wing',[-32,22,-45],false);
  // NHB's official building volume is intentionally replaced already. These
  // are retained original apron/upper-source samples outside that old scope,
  // beyond the new approach endpoint, rather than assertions over its interior.
  const nhb=[[-80,44,-165],[-80,4.3,-160]];
  nhb.forEach((p,i)=>sourcePatch(`retained NHB context ${i+1}`,p,false));
  // Iteration 41 intentionally repairs the former scan-only western road.
  for(const p of [[-112,8,-148],[-145,16,-152]])sourcePatch('new west 24th repair',p,true);
  sourcePatch('south of approach half-width',a.clone().addScaledVector(along,66).addScaledVector(across,-12).setY(12).toArray(),false);
  sourcePatch('beyond old approach into new west road',b.clone().addScaledVector(along,5).setY(10).toArray(),true);
  return{welchSamples:observations.length,welch:observations,retainedNhbContext:nhb};
});
function capsuleAt(x,z){
  const y=ground(x,z).height,body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x,y+.905,z));
  const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34).setFriction(0),body);
  const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);
  controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();let vertical=0;
  return{body,step(dx,dz){
    const p=body.translation();vertical=Math.max(-35,vertical-24/60);controller.computeColliderMovement(capsule,{x:dx,y:vertical/60,z:dz});
    const d=controller.computedMovement(),supported=characterSupported(controller,p.y,vertical);if(supported&&vertical<0)vertical=0;
    body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();return supported;
  },dispose(){world.removeCharacterController(controller);world.removeRigidBody(body);world.step();}};
}
const westEnd=b.clone().addScaledVector(along,-.9),junctionStart=a.clone().addScaledVector(along,-2);
const westCourtStart=a.clone().addScaledVector(along,(-55-a.x)/along.x);
const routes=[{name:'Speedway to west endpoint',points:[[junctionStart.x,junctionStart.z],[a.x,a.z],[westEnd.x,westEnd.z]]},
  {name:'approach into Hackerman forecourt',points:[[-43,-140.43],[-36,-139.793],[-36,-149.5]]},
  {name:'western brick edge into forecourt',points:[[westCourtStart.x,westCourtStart.z],[-55,-150.5]]}];
for(const route of routes)check(`Game capsule traverses ${route.name} in both directions`,()=>{
    const actor=capsuleAt(...route.points[0]);let frames=0,unsupportedFrames=0,maxFootError=0;const legs=[];
    try{
      for(const [x,z] of [...route.points.slice(1),...route.points.slice(0,-1).reverse()]){
        let remaining=Infinity;
        for(let i=0;i<2400;i++){
          const p=actor.body.translation(),dx=x-p.x,dz=z-p.z;remaining=Math.hypot(dx,dz);if(remaining<.08)break;
          const movement=Math.min(3/60,remaining);if(!actor.step(dx/remaining*movement,dz/remaining*movement))unsupportedFrames++;frames++;
          const now=actor.body.translation(),floor=ground(now.x,now.z),foot=now.y-.905,error=Math.abs(foot-floor.height);maxFootError=Math.max(maxFootError,error);
          assert(error<.12,`${route.name}: capsule departed visible ground by ${error.toFixed(3)}m (foot=${foot.toFixed(4)}, ground=${floor.height.toFixed(4)}, surface=${floor.mesh}) at ${JSON.stringify(now)}`);
        }
        assert(remaining<.08,`${route.name}: capsule blocked at ${JSON.stringify(actor.body.translation())}`);
        legs.push({target:[x,z],end:{...actor.body.translation()},remaining});
      }
      assert.equal(unsupportedFrames,0,`${route.name}: unsupported frames`);return{name:route.name,frames,unsupportedFrames,maxFootError,legs};
    }finally{actor.dispose();}
});
walkway.dispose(world);world.free();
const report={passed:failures.length===0,approach:{east:a.toArray(),west:b.toArray(),width:8,fullHalfWidth:11},checks,failures,
  limits:['Uses the actual landscape builder and real contour Terrain, with normal Rapier capsule settings.',
    'No streamed tiles, texture requests, live seam stitching or loaded vegetation assets; browser playtesting covers appearance and those interactions.',
    'Source preservation uses small witness triangles at named points and does not prove every triangle or building boundary.']};
writeFileSync(new URL(`../evidence/${prefix}-hackerman-approach-check.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,checks:checks.map(({name,passed})=>({name,passed})),failures},null,2));
if(failures.length)process.exitCode=1;
