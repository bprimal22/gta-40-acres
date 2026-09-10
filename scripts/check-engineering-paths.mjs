import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
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
const {SpeedwayWalkway}=await import('../lib/campus/walkway.ts');
const {Terrain}=await import('../lib/campus/terrain.ts');
const {buildEngineeringPaths,engineeringStair:stair}=await import('../lib/campus/engineering-paths.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const {characterSupported}=await import('../lib/campus/character-support.ts');
const prefix=process.argv[2]??'iteration-34';assert(/^[a-z0-9-]+$/.test(prefix),'safe evidence prefix');
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
// Use the public route/step layout to choose sampling and movement locations.
// Its duplicate meshes never enter the scene or physics: all actual hits below
// come from the full landscape builder with its real Speedway height sampler.
const sourceMaterial=new T.MeshStandardMaterial();
const layout=buildEngineeringPaths((x,z)=>terrain.height(x,z)+.04,sourceMaterial);
const upper=new T.Vector3(stair.upper[0],0,stair.upper[1]),lower=new T.Vector3(stair.lower[0],0,stair.lower[1]);
const stairLength=upper.distanceTo(lower),stairDirection=lower.clone().sub(upper).normalize();
const stairNormal=new T.Vector3(-stairDirection.z,0,stairDirection.x),riser=(stair.upperY-stair.lowerY)/stair.risers;
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),identity=new T.Matrix4(),checks=[],failures=[];
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){checks.push({name,passed:false});failures.push({name,error:e.message});}}
function stairPosition(x,z){const p=new T.Vector3(x,0,z).sub(upper);return{along:p.dot(stairDirection),across:p.dot(stairNormal)};}
function nearStair(x,z){const p=stairPosition(x,z);return p.along>=-.35&&p.along<=stairLength+.35&&Math.abs(p.across)<stair.width/2;}
function referenceHeight(x,z){
  const s=stairPosition(x,z);
  if(s.along>=0&&s.along<=stairLength&&Math.abs(s.across)<stair.width/2+.1)
    return layout.steps.find(p=>s.along>=p.start&&s.along<=p.end)?.y??stair.lowerY;
  let nearest=Infinity,height=terrain.height(x,z);
  for(const route of layout.routes)for(let i=1;i<route.points.length;i++){
    const [ax,az]=route.points[i-1],[bx,bz]=route.points[i],dx=bx-ax,dz=bz-az;
    const t=T.MathUtils.clamp(((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz),0,1),distance=Math.hypot(x-ax-dx*t,z-az-dz*t);
    if(distance<nearest){nearest=distance;height=route.height(x,z);}
  }return height;
}
function groundProbe(x,z,reference=referenceHeight(x,z)){
  const y=reference+1.25,origin=new T.Vector3(x,y,z);ray.set(origin,down);ray.far=4;
  const shown=ray.intersectObject(walkway.surfaces,true)[0];
  const solid=world.castRay(new RAPIER.Ray(origin,down),4,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
  return{y,shown,solid};
}
function ground(x,z,reference=referenceHeight(x,z)){
  const {y,shown,solid}=groundProbe(x,z,reference);
  assert(shown&&solid,`missing ground at ${x.toFixed(3)},${z.toFixed(3)} (render=${!!shown}, collision=${!!solid})`);
  assert(shown.face.normal.y>.8,`walking surface has wrong winding or steep face at ${x},${z}`);
  const error=Math.abs(shown.point.y-(y-solid.timeOfImpact));
  assert(error<.003,`ground/collider disagree by ${error.toFixed(4)}m at ${x.toFixed(3)},${z.toFixed(3)}`);
  return{height:shown.point.y,error,mesh:shown.object.name};
}
function footSupportGap(position){
  const sphereCenter=new T.Vector3(position.x,position.y-.54,position.z),radiusWithOffset=.34+.025;
  const triangle=new T.Triangle(),contact=new T.Vector3();let nearest=Infinity;
  // A capsule can already rest on a higher terrace while its centre is above
  // the lower approach. Compare actual ground under the lower hemisphere,
  // instead of treating a valid autostep contact as an airborne player.
  for(const r of [.17,.24,.30,.33])for(let i=0;i<16;i++){
    const angle=i*Math.PI/8,{y,shown,solid}=groundProbe(position.x+Math.cos(angle)*r,position.z+Math.sin(angle)*r);
    if(!shown||!solid||shown.face.normal.y<.8||Math.abs(shown.point.y-(y-solid.timeOfImpact))>.003)continue;
    const positions=shown.object.geometry.attributes.position,face=shown.face;
    triangle.a.fromBufferAttribute(positions,face.a).applyMatrix4(shown.object.matrixWorld);
    triangle.b.fromBufferAttribute(positions,face.b).applyMatrix4(shown.object.matrixWorld);
    triangle.c.fromBufferAttribute(positions,face.c).applyMatrix4(shown.object.matrixWorld);
    triangle.closestPointToPoint(sphereCenter,contact);
    // Exact nearest contact on a sampled triangle includes its tread/terrace
    // edge, avoiding the false gap from a coarse radial sampling grid.
    if(contact.y<=sphereCenter.y&&Math.hypot(contact.x-position.x,contact.z-position.z)<=radiusWithOffset+.001)
      nearest=Math.min(nearest,Math.abs(sphereCenter.distanceTo(contact)-radiusWithOffset));
  }return nearest;
}
function sourcePatch(name,p,clear=false){
  const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([
    p[0]-.025,p[1]-.025,p[2],p[0]+.025,p[1]-.025,p[2],p[0],p[1]+.025,p[2]+.015],3));g.computeVertexNormals();
  const trimmed=subtractVolumes(g,identity,walkway.volumes);
  try{
    if(clear)assert(trimmed&&trimmed.attributes.position.count===0,`${name}: source obstruction remains`);
    else assert(trimmed===null,`${name}: protected source fragment was cut`);
  }finally{g.dispose();trimmed?.dispose();}
}
check('The measured falling location is now a solid upward surface',()=>{
  const p=[36,-234.20122489299948],hit=ground(...p);
  assert.equal(hit.mesh,'Engineering connected walks and stair','fall repair must be supplied by the engineering route');
  assert(hit.height>5&&hit.height<5.6,'fall location no longer matches its registered approach grade');
  return{point:p,...hit};
});
check('Every engineering route has matching center and lateral ground/collision',()=>{
  const results=[];
  for(const route of layout.routes){
    let samples=0,maxError=0;const heights=[];
    for(let i=1;i<route.points.length;i++){
      const [ax,az]=route.points[i-1],[bx,bz]=route.points[i],d=new T.Vector3(bx-ax,0,bz-az),len=d.length(),n=new T.Vector3(-d.z,0,d.x).normalize();
      const cells=Math.ceil(len/1.5);
      for(let j=0;j<=cells;j++)for(const offset of [-.5,0,.5]){
        const t=.007+.986*j/cells,p=new T.Vector3(ax,0,az).addScaledVector(d,t).addScaledVector(n,offset),g=ground(p.x,p.z,route.height(p.x,p.z));
        samples++;maxError=Math.max(maxError,g.error);if(offset===0)heights.push({x:p.x,z:p.z,height:g.height});
      }
    }results.push({name:route.name,samples,maxError,heights});
  }return results;
});
check('Speedway gray-edge entry and connected route junctions have no ground gap',()=>{
  const joints=[];
  for(const route of layout.routes)for(const p of route.points)joints.push({name:route.name,p});
  const samples=[];
  for(const joint of joints){const g=ground(...joint.p);samples.push({name:joint.name,point:joint.p,...g});}
  const start=new T.Vector3(21.82212829589844,0,-235.2142333984375),end=new T.Vector3(30.895,0,-234.306);
  let previous,maxIncrement=0;
  for(let i=0;i<=80;i++){
    const p=start.clone().lerp(end,i/80),g=ground(p.x,p.z);
    if(previous!==undefined){const change=Math.abs(g.height-previous);maxIncrement=Math.max(maxIncrement,change);assert(change<.08,`Speedway entry has a ${change.toFixed(3)}m curb/drop`);}
    previous=g.height;samples.push({name:'Speedway gray-edge entry',point:[p.x,p.z],...g});
  }
  return{maxEntryIncrement:maxIncrement,samples};
});
check('Every stair tread and landing has the correct upward surface and collider',()=>{
  const results=[];
  for(const [index,step] of layout.steps.entries())for(const lateral of [-.5,0,.5]){
    const p=upper.clone().addScaledVector(stairDirection,(step.start+step.end)/2).addScaledVector(stairNormal,lateral),g=ground(p.x,p.z,step.y);
    assert(Math.abs(g.height-step.y)<.002,`tread ${index}, lateral ${lateral}: expected height ${step.y}, rendered ${g.height}`);
    results.push({index,lateral,height:g.height,collisionError:g.error});
  }
  assert(layout.steps.some(p=>p.end-p.start>2),'stair landing is missing');
  return{risers:stair.risers,riserHeight:riser,samples:results};
});
check('A 12.5cm grid covers the top landing and full usable stair width without gaps or overwritten treads',()=>{
  let samples=0,rows=0,maxHeightError=0,maxCollisionError=0;
  // Keep the height assertions within the landing/stair itself. Beyond the
  // bottom, the passage grade runs along a different axis; controller tests
  // cross that junction without assuming the staircase's lateral profile.
  for(let t=-1.075;t<=stairLength;t+=.125){
    rows++;
    for(let lateral=-1;lateral<=1;lateral+=.125){
      const p=upper.clone().addScaledVector(stairDirection,t).addScaledVector(stairNormal,lateral);
      const step=layout.steps.find(s=>t>=s.start&&t<=s.end);
      assert(t<0||step,'stair grid lies outside all tread intervals');
      const expected=t<0?stair.upperY:step.y,g=ground(p.x,p.z,expected);
      const error=Math.abs(g.height-expected);maxHeightError=Math.max(maxHeightError,error);maxCollisionError=Math.max(maxCollisionError,g.error);samples++;
      assert(error<.003,`stair grid t=${t.toFixed(4)}, lateral=${lateral}: expected ${expected.toFixed(4)}, rendered ${g.height.toFixed(4)}`);
    }
  }
  return{spacing:.125,lateralLanes:17,rows,samples,maxHeightError,maxCollisionError};
});
check('Measured GLT bridge deck and named Patterson frontage witnesses survive source clipping',()=>{
  const probes=JSON.parse(readFileSync(new URL('../evidence/iteration-34-engineering-ground-probes.json',import.meta.url)));
  const bridge=probes.rows.filter(r=>r.kind==='stairs and bridge'&&r.z>=-200&&r.z<=-180)
    .flatMap(r=>(r.hits['12']??[]).filter(h=>h.y>8&&h.y<9).map(h=>[r.x,h.y,r.z]));
  assert.equal(bridge.length,11,'bridge reference fixture changed');bridge.forEach((p,i)=>sourcePatch(`recorded GLT deck ${i+1}`,p));
  for(const p of bridge)sourcePatch('source above 7.05m passage cut cap',[p[0],7.12,p[2]]);
  const pat=JSON.parse(readFileSync(new URL('../evidence/iteration-34-patterson-wall-probes.json',import.meta.url))).rows
    .filter(r=>[50,80,95].includes(r.x)).flatMap(r=>r.hits.map(h=>h.point));
  assert.equal(pat.length,9,'named Patterson frontage fixture changed');pat.forEach((p,i)=>sourcePatch(`Patterson frontage ${i+1}`,p));
  // Confirm the protected overhead deck does not prevent clearing the walking
  // corridor below it. The witness is above the route but below the deck cap.
  const passage=layout.routes.find(r=>r.underBridge&&r.name.includes('Passage'));assert(passage);
  for(let t=.1;t<1;t+=.2){const [a,b]=passage.points,p=[T.MathUtils.lerp(a[0],b[0],t),0,T.MathUtils.lerp(a[1],b[1],t)];p[1]=passage.height(p[0],p[2])+1;sourcePatch('passage obstruction below bridge',p,true);}
  return{bridge,pat,interpretation:'Named source-location preservation; local mesh normals were not used to classify facade identity.'};
});
check('Recorded low source headroom beside the stair centerline is removed',()=>{
  const probes=JSON.parse(readFileSync(new URL('../evidence/iteration-34-stair-headroom-probes.json',import.meta.url)));
  const rows=probes.rows.filter(r=>Math.abs(r.x-124.1)<.001&&r.z>=-216.5&&r.z<=-215.8);
  const witnesses=rows.flatMap(r=>r.samples.flat().map(h=>h.point));
  assert.equal(witnesses.length,4,'recorded low stair headroom fixture changed');
  const samples=[];
  for(const [i,p] of witnesses.entries()){
    const location=stairPosition(p[0],p[2]);
    assert(Math.abs(location.across)<.34,'headroom witness must overlap a capsule on the stair centerline');
    assert(p[1]>7.05&&p[1]<7.4,'fixture must cover the source left above the old passage-height cap');
    sourcePatch(`recorded stair sweep obstruction ${i+1}`,p,true);
    samples.push({point:p,centerlineDistance:Math.abs(location.across),heightAboveTread:p[1]-ground(p[0],p[2]).height});
  }
  return{samples,interpretation:'These measured fragments intersect the normal capsule/autostep headroom. Removing their witness patches complements the ordinary-controller route tests; bridge preservation remains independently asserted.'};
});
function capsuleAt(p){
  const y=ground(...p).height,body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p[0],y+.905,p[1]));
  const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34).setFriction(0),body),controller=world.createCharacterController(.025);
  controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);
  world.step();let vertical=0;
  return{body,step(dx,dz){const p=body.translation();vertical=Math.max(-35,vertical-24/60);controller.computeColliderMovement(capsule,{x:dx,y:vertical/60,z:dz});
    const d=controller.computedMovement(),supported=characterSupported(controller,p.y,vertical);if(supported&&vertical<0)vertical=0;
    body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();return supported;
  },dispose(){world.removeCharacterController(controller);world.removeRigidBody(body);world.step();}};
}
function walkRoundTrip(points){
  const actor=capsuleAt(points[0]);let frames=0,unsupportedFrames=0,maxFlatFootError=0,maxStairFootError=0;const legs=[],edgeSupport=[];
  try{
    for(const [x,z] of [...points.slice(1),...points.slice(0,-1).reverse()]){
      let remaining=Infinity;const legStart=frames;
      for(let i=0;i<2400;i++){
        const p=actor.body.translation(),dx=x-p.x,dz=z-p.z;remaining=Math.hypot(dx,dz);if(remaining<.075)break;
        const step=Math.min(3/60,remaining);if(!actor.step(dx/remaining*step,dz/remaining*step))unsupportedFrames++;frames++;
        const now=actor.body.translation(),stairs=nearStair(now.x,now.z);
        if(stairs||frames%3===0){
          const floor=ground(now.x,now.z),signedError=now.y-.905-floor.height,error=Math.abs(signedError);
          if(stairs)maxStairFootError=Math.max(maxStairFootError,error);else maxFlatFootError=Math.max(maxFlatFootError,error);
          // A capsule may overhang the next tread by one riser. This checks the
          // visible steps without changing autostep, snap, speed or gravity.
          const tolerance=stairs?riser+.06:.12;
          if(error>=tolerance){
            const supportGap=!stairs&&signedError>0?footSupportGap(now):Infinity;
            assert(supportGap<.055,`capsule departed ${stairs?'stair':'walk'} surface by ${error.toFixed(3)}m with support gap ${supportGap.toFixed(3)}m at ${JSON.stringify(now)}`);
            edgeSupport.push({frame:frames,point:{...now},centerFootError:error,supportGap});
          }
        }
      }
      assert(remaining<.075,`capsule blocked before ${x},${z} at ${JSON.stringify(actor.body.translation())}`);
      legs.push({target:[x,z],end:{...actor.body.translation()},frames:frames-legStart,remaining});
    }
    assert.equal(unsupportedFrames,0,'walking route has unsupported frames');
    return{frames,unsupportedFrames,maxFlatFootError,maxStairFootError,edgeSupport,legs};
  }finally{actor.dispose();}
}
for(const lateral of [-.5,0,.5])check(`Normal capsule ascends and descends both stair flights at lateral ${lateral}m`,()=>{
  const bottom=lower.clone().addScaledVector(stairDirection,.8).addScaledVector(stairNormal,lateral);
  const top=upper.clone().addScaledVector(stairDirection,-.8).addScaledVector(stairNormal,lateral);
  return walkRoundTrip([[bottom.x,bottom.z],[top.x,top.z]]);
});
check('Normal capsule completes Speedway, upper terrace, bridge passage and east sidewalk round trip',()=>{
  const [west,terrace,passage,south,east]=layout.routes;
  const points=[[21.82212829589844,-235.2142333984375],...west.points,
    ...terrace.points.slice(2),...terrace.points.slice(1,-1).reverse(),terrace.points[0],
    ...passage.points,...south.points.slice(1),...east.points.slice(1)];
  return walkRoundTrip(points);
});
walkway.dispose(world);world.free();
for(const g of new Set(layout.meshes.map(m=>m.geometry)))g.dispose();layout.materials.forEach(m=>m.dispose());sourceMaterial.dispose();
const report={passed:failures.length===0,checks,failures,stats:layout.stats,
  limits:['All render/collision and movement checks use the full landscape builder with real contour Terrain.',
    'No streamed tiles, loaded foliage or live boundary-height stitching; preserved bridge samples do not replace browser verification of the entire bridge.',
    'Patterson checks preserve nine named frontage samples; they do not classify mesh-local normals or prove every facade point.',
    'Normal gravity, .32m autostep and .38m snap are used; no jump or position correction is applied during a route.']};
writeFileSync(new URL(`../evidence/${prefix}-engineering-paths-check.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,checks:checks.map(({name,passed})=>({name,passed})),failures},null,2));
if(failures.length)process.exitCode=1;
