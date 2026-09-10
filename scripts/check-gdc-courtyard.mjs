import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Exercise the integrated public builders and actual game capsule settings.
// No browser, shader rendering, provider traffic, teleport API or runtime edits.
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){
    const u=new URL(`${s}.ts`,c.parentURL);if(existsSync(u))return{url:u.href,shortCircuit:true};
  }return next(s,c);
},load(url,c,next){
  if(!url.endsWith('.ts'))return next(url,c);
  return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
}});
const {buildGdcFacades}=await import('../lib/campus/gdc-facade.ts');
const {buildGdcFrontage,inGdcFrontage}=await import('../lib/campus/gdc-frontage.ts');
const {buildGdcCourtyard,gdcCourtPoint:point,gdcCourtUV:uv,gdcCourtEast:east,gdcBed}=await import('../lib/campus/gdc-courtyard.ts');
const {buildGdcAtrium}=await import('../lib/campus/gdc-atrium.ts');
const {characterSupported}=await import('../lib/campus/character-support.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const prefix=process.argv[2]??'gdc-current';assert(/^[a-z0-9-]+$/.test(prefix),'safe evidence prefix');
const data=JSON.parse(readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const config={baseElevation:2.45,floors:6,floorHeight:4.45,returnDepth:12,courtyardDepth:34};
const atriumClearancePadding=1.05;
const facade=buildGdcFacades(config),atrium=buildGdcAtrium({clearancePadding:atriumClearancePadding});
const grass=new T.MeshStandardMaterial(),concrete=new T.MeshStandardMaterial();
const frontage=buildGdcFrontage(data,(_x,z)=>3.4+(z+58.5)*.2/78.9,grass,concrete);
const court=buildGdcCourtyard(frontage.height);
const meshes=[...facade.meshes,...atrium.meshes,...court.meshes,frontage.mesh];
const visual=new T.Group();visual.add(...meshes);visual.updateWorldMatrix(true,true);
const colliderGeometries=[...facade.colliderGeometries,...atrium.colliderGeometries,...court.colliderGeometries,frontage.mesh.geometry];
const cuts=[...facade.volumes,...atrium.volumes,...court.volumes,...frontage.volumes];
await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0});
for(const g of colliderGeometries){
  const p=g.attributes.position,index=g.index?.array??Uint32Array.from({length:p.count},(_,i)=>i);
  world.createCollider(RAPIER.ColliderDesc.trimesh(p.array,index,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
}world.step();
const checks=[],failures=[],ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),identity=new T.Matrix4();
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){checks.push({name,passed:false});failures.push({name,error:e.message});}}
function ground(x,z,from=5.5){
  const origin=new T.Vector3(x,from,z);ray.set(origin,down);ray.far=10;
  const shown=ray.intersectObject(visual,true)[0],solid=world.castRay(new RAPIER.Ray(origin,down),10,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
  assert(shown&&solid,`ground missing at ${x.toFixed(3)},${z.toFixed(3)}`);
  assert(shown.face.normal.y>.8,'walking ground must have upward winding');
  assert(Math.abs(shown.point.y-(from-solid.timeOfImpact))<.003,`walking render/collision heights differ at ${x.toFixed(3)},${z.toFixed(3)}: visual=${shown.point.y.toFixed(4)}, physics=${(from-solid.timeOfImpact).toFixed(4)}`);
  return shown.point.y;
}
function atGround(u,v){const p=point(u,v);p.y=ground(p.x,p.z);return p;}
function patch(name,p,expected,size=.08,volumes=cuts){
  const g=new T.BoxGeometry(size,size,size).translate(...p.toArray()),cut=subtractVolumes(g,identity,volumes);
  try{
    if(expected==='cleared')assert(cut&&cut.attributes.position.count===0,`${name}: source fragment remains`);
    else assert(cut===null,`${name}: source outside replacement was deleted`);
  }finally{g.dispose();cut?.dispose();}
}
check('Finite integrated geometry and separate decorative collision policy',()=>{
  for(const m of meshes)for(const a of Object.values(m.geometry.attributes))assert([...a.array].every(Number.isFinite),`${m.name}: invalid vertex attribute`);
  assert.equal(atrium.bands.length,5);assert.equal(court.stats.towers,8);assert.equal(facade.records.length,14);
  const trellis=atrium.meshes.find(m=>m.material===atrium.materials.trellis);assert(trellis);
  assert(!colliderGeometries.includes(trellis.geometry),'decorative atrium grilles cannot snag capsules');
  assert.equal(new Set(court.geometries).size,court.geometries.length,'courtyard ownership contains duplicate buffers');
  return{meshes:meshes.length,colliderGeometries:colliderGeometries.length,cutVolumes:cuts.length,stats:{facade:facade.stats,atrium:atrium.stats,courtyard:court.stats}};
});
check('Only inward-facing wing returns extend behind the sculpture',()=>{
  const short=buildGdcFacades({...config,courtyardDepth:0});
  try{
    const extended=[];
    for(const r of facade.records){
      const before=short.records.find(p=>p.name===r.name);assert(before,`unmatched facade ${r.name}`);
      const inner=r.name==='north wing south return'||r.name==='south wing north return';
      if(inner){assert(r.length>before.length+20,'courtyard-facing wall did not extend');extended.push(r.name);}
      else{assert.deepEqual(r.a,before.a,`${r.name}: unrelated wall start changed`);assert.deepEqual(r.b,before.b,`${r.name}: unrelated wall end changed`);}
    }
    assert.equal(extended.length,2);assert.equal(facade.volumes.length,short.volumes.length+2,'two bounded inner-wall clearance strips');
    return{extended};
  }finally{short.dispose();}
});
check('Stepped atrium glass and roof render exactly where their colliders are',()=>{
  const observations=[];
  // The first upper level projects west of the ground floor. The next three
  // retreat east; a monotonic assertion over all five would reject the reference.
  assert(atrium.bands[1].front<atrium.bands[0].front,'low projecting terrace lost');
  for(let i=2;i<5;i++)assert(atrium.bands[i].front>atrium.bands[i-1].front+3,'upper terrace retreat lost');
  for(const [i,band] of atrium.bands.entries()){
    const y=band.high-.6,origin=point(-10,.43,y);ray.set(origin,east);ray.far=60;
    const shown=ray.intersectObjects(atrium.meshes,true)[0],solid=world.castRay(new RAPIER.Ray(origin,east),60,true);
    assert(shown&&solid,`atrium band ${i+1}: gap`);
    assert(Math.abs(shown.distance-solid.timeOfImpact)<.003,`atrium band ${i+1}: visual/collision mismatch`);
    assert(shown.face.normal.dot(east)<-.8,`atrium band ${i+1}: reversed exterior face`);
    const [u]=uv(shown.point.x,shown.point.z);assert(u>=band.front-.2&&u<=band.front+1.2,'atrium glass outside its stepped band');
    observations.push({band:i+1,y,front:u,hit:shown.point.toArray()});
  }
  const origin=point(32,0,35);ray.set(origin,down);ray.far=15;
  const roof=ray.intersectObjects(atrium.meshes,true)[0],solid=world.castRay(new RAPIER.Ray(origin,down),15,true);
  assert(roof&&solid&&roof.face.normal.y>.9,'atrium roof missing or reversed');
  assert(Math.abs(roof.distance-solid.timeOfImpact)<.003,'atrium roof/collision mismatch');
  assert(Math.abs(roof.point.y-25.08)<.02,'atrium roof must retain its lower measured plateau');
  assert(roof.point.y<config.baseElevation+config.floors*config.floorHeight-3,'atrium must sit below wing roofs');
  return{observations,roof:roof.point.toArray()};
});
check('Inner-wall replacement closes its eastern clearance seam above the atrium',()=>{
  const results=[];
  for(const record of facade.records.filter(r=>r.name==='north wing south return'||r.name==='south wing north return')){
    const out=new T.Vector3(...record.outward),a=new T.Vector3(record.a[0],0,record.a[1]);
    const b=new T.Vector3(record.b[0],0,record.b[1]),along=b.clone().sub(a).normalize();
    const [startU]=uv(a.x,a.z),du=along.dot(east);assert(Math.abs(du)>.99,'inner wall must follow courtyard axis');
    for(const u of [33.7,33.82,33.88,33.94,34.1,34.35,34.55]){
      const wall=a.clone().addScaledVector(along,(u-startU)/du).setY(27);
      // Closing the join can either extend authored geometry or stop removing
      // the scan before that geometry ends. Any removed source at the join
      // must still have a rendered and collidable replacement.
      const source=new T.BoxGeometry(.008,.008,.008).translate(...wall.toArray());
      const remaining=subtractVolumes(source,identity,cuts),sourceRetained=remaining===null;
      source.dispose();remaining?.dispose();
      const origin=wall.clone().addScaledVector(out,3),direction=out.clone().negate();ray.set(origin,direction);ray.far=4;
      const shown=ray.intersectObject(visual,true)[0],solid=world.castRay(new RAPIER.Ray(origin,direction),4,true);
      if(sourceRetained){results.push({face:record.name,u,sourceRetained});continue;}
      assert(shown&&solid,`${record.name}: clearance removes source but no replacement wall at court u=${u}, y=27`);
      assert(Math.abs(shown.distance-solid.timeOfImpact)<.003,'inner-wall seam visual/collision disagreement');
      assert(shown.distance>2.4&&shown.distance<3.6,'seam ray found a different wall instead of closing the cut');
      results.push({face:record.name,u,sourceRetained,hit:shown.point.toArray()});
    }
  }return results;
});
check('Measured central scan wedges clear without expanding atrium sides, back or roof allowance',()=>{
  const source=JSON.parse(readFileSync(new URL('../evidence/iteration-32-remaining-scan-fragments.json',import.meta.url)));
  const fragments=source.samples.flatMap(s=>s.hits.map(h=>({...h,pixel:s.pixel})))
    .filter(h=>h.point[1]>=13&&h.point[1]<=25&&Math.abs(h.v)<7.8);
  assert.equal(fragments.length,5,'recorded central-fragment fixture changed');
  for(const hit of fragments){
    const p=new T.Vector3(...hit.point),[u,v]=uv(p.x,p.z);
    assert(Math.abs(u-hit.u)<.00001&&Math.abs(v-hit.v)<.00001,'recorded fragment frame no longer matches campus registration');
    patch(`recorded central wedge from pixel ${hit.pixel}`,p,'cleared');
  }
  // The registration allowance acts at each front, not at unrelated sides,
  // the back, or a metre above the unchanged authored roof.
  for(const volume of atrium.volumeRecords){
    assert.equal(volume.minV,-7.8);assert.equal(volume.maxV,7.8);assert.equal(volume.maxU,34.5);
    assert(volume.maxY<=25.20+.00001,'front allowance expanded source removal above the roof');
  }
  patch('atrium-specific source allowance above unchanged roof',point(32,0,25.45),'retained',.08,atrium.volumes);
  return{clearancePadding:atriumClearancePadding,fragments:fragments.map(({point,u,v,pixel})=>({point,u,v,pixel}))};
});
check('Courtyard air clearance removes the visible floating fragment and stays within its boundaries',()=>{
  assert.equal(court.volumes.length,2,'courtyard needs separate foreground and upper-air cuts');
  const air=court.volumes[1],existingCuts=cuts.filter(v=>v!==air);
  const source=JSON.parse(readFileSync(new URL('../evidence/iteration-32-cleanup-visible-probes.json',import.meta.url)));
  const sample=source.samples.find(s=>s.pixel[0]===730&&s.pixel[1]===40);
  const visible=sample?.visible.find(h=>!h.authored);assert(visible,'recorded visible air fragment is missing');
  const p=new T.Vector3(...visible.point),[u,v]=uv(p.x,p.z);
  assert(u>22&&u<24&&v>6&&v<7&&p.y>26&&p.y<27,'recorded floating-fragment fixture changed');
  patch('recorded visible air fragment',p,'cleared');
  patch('upper-air volume removes the recorded fragment',p,'cleared',.08,[air]);
  for(const [name,p] of [['inside upper back edge',point(34.4,0,26.2)],['inside upper height',point(20,0,29.3)],
    ['inside north side',point(20,-7.35,26.2)],['inside south side',point(20,7.35,26.2)]])patch(name,p,'cleared',.08,[air]);
  /** @type {[string,T.Vector3][]} */
  const outside=[['beyond back',point(34.6,0,26.2)],['above wing-roof datum',point(20,0,29.55)],
    ['beyond north side',point(20,-7.55,26.2)],['beyond south side',point(20,7.55,26.2)],
    ['before west edge',point(-6.1,0,12)],['below upper-air floor',point(0,0,8.9)]];
  const observations=[];
  for(const [name,p] of outside){
    patch(`${name} outside air volume`,p,'retained',.08,[air]);
    // Existing inner-wall or foreground cuts may already remove some of these
    // points. Verify the new air volume makes no additional change there.
    const g=new T.BoxGeometry(.08,.08,.08).translate(...p.toArray());
    const before=subtractVolumes(g,identity,existingCuts),after=subtractVolumes(g,identity,cuts);
    try{
      assert.equal(after===null,before===null,`${name}: air cut changes source outside its boundary`);
      if(before&&after)assert.deepEqual(after.attributes.position.array,before.attributes.position.array,`${name}: air cut expands an existing cut`);
      if(name==='beyond back'||name==='above wing-roof datum')assert(after===null,`${name}: protected source was removed`);
      observations.push({name,point:p.toArray(),preservedByAllCuts:after===null});
    }finally{g.dispose();before?.dispose();after?.dispose();}
  }
  return{recordedFragment:{point:p.toArray(),u,v,pixel:sample.pixel},outside:observations};
});
check('Inner roof strips remove measured overlap and preserve source beyond their outer edges',()=>{
  const source=JSON.parse(readFileSync(new URL('../evidence/iteration-32-remaining-scan-fragments.json',import.meta.url)));
  const recorded=source.samples.flatMap(s=>s.hits.map(h=>({...h,pixel:s.pixel})))
    .filter(h=>h.point[1]>29&&h.point[1]<30.35&&h.u>20&&h.u<33.8&&h.v< -8);
  assert.equal(recorded.length,2,'recorded north-roof overlap fixture changed');
  for(const hit of recorded)patch(`recorded north roof from pixel ${hit.pixel}`,new T.Vector3(...hit.point),'cleared');
  const observations=[];
  for(const record of facade.records.filter(r=>r.name==='north wing south return'||r.name==='south wing north return')){
    const north=record.name.startsWith('north'),[,wallV]=uv(...record.a),sign=north?-1:1;
    for(const u of [22,28,33]){
      const p=point(u,wallV+sign*2.2,29.43);
      patch(`${record.name} restored roof source at u${u}`,p,'cleared');
      const origin=p.clone().setY(35);ray.set(origin,down);ray.far=8;
      const shown=ray.intersectObjects(facade.meshes,true)[0],solid=world.castRay(new RAPIER.Ray(origin,down),8,true);
      assert(shown&&solid&&shown.face.normal.y>.99,'cleared inner roof strip has no upward replacement');
      assert(Math.abs(shown.point.y-29.43)<.002,'replacement roof datum changed');
      assert(Math.abs(shown.distance-solid.timeOfImpact)<.003,'replacement roof render/collision mismatch');
      patch(`${record.name} roof beyond outer edge at u${u}`,point(u,wallV+sign*2.55,29.43),'retained');
      observations.push({face:record.name,u,hit:shown.point.toArray()});
    }
    const afterEnd=point(34.05,wallV+sign*2.2,29.43);
    patch(`${record.name} roof beyond eastern end`,afterEnd,'retained');
    ray.set(afterEnd.clone().setY(35),down);ray.far=6;
    assert.equal(ray.intersectObjects(facade.meshes,true).length,0,'authored roof overlaps retained source beyond its cut endpoint');
  }
  return{recorded:recorded.map(({point,u,v,pixel})=>({point,u,v,pixel})),observations};
});
check('Scenery clearance removes the replaced courtyard and preserves remote campus geometry',()=>{
  const cleared=[['old artwork fragments',point(0,0,5)],['old lower atrium',point(20,0,4)],['old upper atrium',point(32,0,23)]];
  for(const [name,p] of cleared)patch(name,p,'cleared');
  const retained=[['deep east ground',point(40,0,1)],['beyond atrium back',point(36,0,14)],
    ['above atrium and wing roofs',point(20,0,33)],['north remote wing roof',new T.Vector3(75,29.3,-40)],
    ['south remote wing roof',new T.Vector3(65,29.3,1)],['west Speedway outside frontage',new T.Vector3(1,3.5,-40)]];
  for(const [name,p] of retained)patch(name,p,'retained');
  return{cleared:cleared.map(([name,p])=>({name,point:p.toArray()})),retained:retained.map(([name,p])=>({name,point:p.toArray()}))};
});
check('Gravel bed keeps a flat sculpture base and meets surrounding ground without a plinth edge',()=>{
  const bed=court.meshes.find(m=>m.material.name==='GDC sculpture bed fine aggregate');assert(bed,'gravel bed mesh missing');
  assert.equal(gdcBed.height,2.65,'bed must use the lowered artwork support elevation');
  const core=[];
  for(const [u,v] of [[0,0],[-3.95,0],[3.95,0],[0,-3.95],[0,3.95]]){
    const origin=point(u,v,5.5);ray.set(origin,down);ray.far=5;
    const hit=ray.intersectObject(bed,true)[0];assert(hit&&hit.face.normal.y>.99,'sculpture support must be flat and face upward');
    assert(Math.abs(hit.point.y-gdcBed.height)<.002,'gravel intersects or floats below the sculpture base');
    core.push({u,v,height:hit.point.y});
  }
  let maxJoinDifference=0,maxBorderHeightError=0,maxRampSlope=0;const borders=[];
  for(const [name,ou,ov] of [['west',-1,0],['east',1,0],['north',0,-1],['south',0,1]]){
    const half=ou?gdcBed.halfU:gdcBed.halfV,across=ou?gdcBed.halfV:gdcBed.halfU;
    for(let i=0;i<=16;i++){
      const lateral=(-1+2*i/16)*(across-.035),u=ou*half+(ou?0:lateral),v=ov*half+(ov?0:lateral);
      const edge=point(u,v),inside=point(u-ou*.01,v-ov*.01),outside=point(u+ou*.01,v+ov*.01);
      const innerY=ground(inside.x,inside.z),outerY=ground(outside.x,outside.z),expected=frontage.height(edge.x,edge.z);
      const joinDifference=Math.abs(innerY-outerY),heightError=Math.max(Math.abs(innerY-expected),Math.abs(outerY-expected));
      maxJoinDifference=Math.max(maxJoinDifference,joinDifference);maxBorderHeightError=Math.max(maxBorderHeightError,heightError);
      assert(joinDifference<.025,`${name} gravel border has a vertical step: ${joinDifference.toFixed(4)}m`);
      assert(heightError<.025,`${name} gravel edge does not meet actual frontage grade`);
      borders.push({side:name,lateral,innerY,outerY,expected});
    }
    let previous;
    // Transects cross each seam and the full outer blend band. Their small
    // elevation increments catch a hidden curb or a steep replacement ramp.
    for(let i=0;i<=30;i++){
      const offset=.325-i*.05,p=point(ou*(half+offset),ov*(half+offset)),y=ground(p.x,p.z);
      if(previous!==undefined){const slope=Math.abs(y-previous)/.05;maxRampSlope=Math.max(maxRampSlope,slope);assert(slope<.6,`${name} gravel ramp has a curb or excessive slope`);}
      previous=y;
    }
  }
  return{core,borderSamples:borders.length,maxJoinDifference,maxBorderHeightError,maxRampSlope,borders};
});
function capsuleAt(p){
  const body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(p.x,p.y+.905,p.z));
  const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34).setFriction(0),body);
  const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);
  controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();
  let vertical=0;
  return{body,step(dx,dz){
    const p=body.translation();vertical=Math.max(-35,vertical-24/60);
    controller.computeColliderMovement(capsule,{x:dx,y:vertical/60,z:dz});
    const d=controller.computedMovement(),supported=characterSupported(controller,p.y,vertical);
    if(supported&&vertical<0)vertical=0;
    body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();return supported;
  },dispose(){world.removeCharacterController(controller);world.removeRigidBody(body);world.step();}};
}
check('Capsules walk both artwork flanks, rear cross-route and recessed-door approach',()=>{
  const routes=[{name:'north flank and entrance',uv:[[-8,-6.4],[6.5,-6.4],[8,0],[15.4,0]]},
    {name:'south flank and entrance',uv:[[-8,6.4],[6.5,6.4],[8,0],[15.4,0]]},
    {name:'behind sculpture cross-route',uv:[[6.5,-6.4],[8,0],[6.5,6.4]]}];
  const results=[];
  for(const route of routes){
    const points=route.uv.map(([u,v])=>atGround(u,v)),actor=capsuleAt(points[0]);
    let frames=0,unsupportedFrames=0,maxFootError=0;const legs=[];
    try{
      for(const target of [...points.slice(1),...points.slice(0,-1).reverse()]){
        let remaining=Infinity;
        for(let f=0;f<1600;f++){
          const p=actor.body.translation(),dx=target.x-p.x,dz=target.z-p.z;remaining=Math.hypot(dx,dz);if(remaining<.08)break;
          const step=Math.min(3/60,remaining);if(!actor.step(dx/remaining*step,dz/remaining*step))unsupportedFrames++;frames++;
          const now=actor.body.translation();assert(inGdcFrontage(now.x,now.z),'route left the reconstructed ground');
          assert(frontage.paved(now.x,now.z),'route capsule left authored paving');
          const footError=Math.abs(now.y-.905-ground(now.x,now.z));maxFootError=Math.max(maxFootError,footError);
          assert(footError<.12,`${route.name}: capsule left visible ground`);
        }
        assert(remaining<.08,`${route.name}: blocked at ${JSON.stringify(actor.body.translation())}`);
        legs.push({target:target.toArray(),end:{...actor.body.translation()},remaining});
      }
      assert.equal(unsupportedFrames,0,`${route.name}: unsupported frames`);
      results.push({name:route.name,frames,unsupportedFrames,maxFootError,legs});
    }finally{actor.dispose();}
  }return results;
});
check('Capsules cross all four gravel ramps, stop against artwork and retreat across the border',()=>{
  const results=[];
  for(const [name,ou,ov] of [['west',-1,0],['east',1,0],['north',0,-1],['south',0,1]]){
    const half=ou?gdcBed.halfU:gdcBed.halfV,start=half+1,actor=capsuleAt(atGround(ou*start,ov*start));
    const outward=point(ou,ov).sub(point(0,0));let frames=0,unsupportedFrames=0,maxFootError=0;
    function step(sign){
      const before=actor.body.translation();
      // Keep approaching the artwork centre; tiny contacts on the curved ring
      // may slide sideways and should not turn this into a path around it.
      const direction=sign<0?point(0,0).sub(new T.Vector3(before.x,0,before.z)).normalize():outward;
      if(!actor.step(direction.x*3/60,direction.z*3/60))unsupportedFrames++;frames++;
      const p=actor.body.translation(),error=Math.abs(p.y-.905-ground(p.x,p.z));maxFootError=Math.max(maxFootError,error);
      assert(error<.12,`${name}: capsule left the visible gravel ramp`);
      const [u,v]=uv(p.x,p.z);return{u,v,radius:u*ou+v*ov,position:{...p}};
    }
    try{
      let contact;for(let i=0;i<240;i++)contact=step(-1);
      assert(contact.radius<half-.4,'capsule stopped at the bed edge before entering the ramp');
      const contactDistance=Math.hypot(contact.u,contact.v);
      assert(contactDistance>4.2&&contactDistance<4.5,'capsule failed to stop outside the sculpture');
      let pushed;for(let i=0;i<120;i++)pushed=step(-1);
      const pushedDistance=Math.hypot(pushed.u,pushed.v);
      assert(pushedDistance>=contactDistance-.03,'sustained ramp approach penetrates sculpture');
      let released=pushed;for(let i=0;i<160&&released.radius<start-.08;i++)released=step(1);
      assert(released.radius>=start-.08,'capsule cannot return across the gravel edge');
      assert.equal(unsupportedFrames,0,`${name}: unsupported frames during gravel entry or retreat`);
      results.push({side:name,frames,unsupportedFrames,maxFootError,contact:contact.position,afterPush:pushed.position,released:released.position});
    }finally{actor.dispose();}
  }return results;
});
check('West-to-east rays pass between the towers above the low wall and hit the ring below it',()=>{
  const sculpture=court.meshes.filter(m=>m.material.name==='Pale grey concrete blocks'||m.material.name==='Recessed concrete joints');
  assert.equal(sculpture.length,2,'sculpture render batches missing');
  const observations=[];
  for(const v of [-.25,0,.25]){
    for(const height of [1.6,2.8]){
      const origin=point(-6,v,gdcBed.height+height);ray.set(origin,east);ray.far=12;
      const shown=ray.intersectObjects(sculpture,true),solid=world.castRay(new RAPIER.Ray(origin,east),12,true);
      assert.equal(shown.length,0,`v=${v}, height=${height}: a tower closes the west/east central opening`);
      assert(solid===null,`v=${v}, height=${height}: an artwork collider closes the central opening`);
      observations.push({v,height,clearDistance:12});
    }
    const origin=point(-6,v,gdcBed.height+.4);ray.set(origin,east);ray.far=12;
    const shown=ray.intersectObjects(sculpture,true)[0],solid=world.castRay(new RAPIER.Ray(origin,east),12,true);
    assert(shown&&solid,'opening orientation must preserve the low front wall');
    assert(shown.distance>2&&shown.distance<2.3,'low ray skipped the west ring and hit something behind it');
    // Mortar sits behind the full-size collision ring by about 12mm; that
    // intentional joint relief should remain while both surfaces stop the ray.
    assert(Math.abs(shown.distance-solid.timeOfImpact)<.04,'low ring render and collision placement differ');
    assert(shown.face.normal.dot(east)<-.9,'west low-wall surface has reversed winding');
    observations.push({v,height:.4,renderDistance:shown.distance,collisionDistance:solid.timeOfImpact});
  }
  return observations;
});
check('Circle remains hollow but blocks walking through its low solid wall',()=>{
  const sculpture=court.meshes.filter(m=>m.material.name==='Pale grey concrete blocks'||m.material.name==='Recessed concrete joints');
  assert.equal(sculpture.length,2,'sculpture render batches missing');
  const bounds=new T.Box3();for(const m of sculpture){m.geometry.computeBoundingBox();bounds.union(m.geometry.boundingBox);}
  assert(Math.abs(bounds.min.y-gdcBed.height)<.002,'artwork must meet the gravel bed');
  assert(Math.abs(bounds.max.y-bounds.min.y-4.2672)<.002,'published artwork height changed during placement');
  // An interior downward ray must meet gravel, not an invented solid disc.
  const center=point(0,0,gdcBed.height+1.5);ray.set(center,down);ray.far=3;
  assert.equal(ray.intersectObjects(sculpture,true).length,0,'Circle center must remain open');
  const insideY=ground(center.x,center.z);assert(Math.abs(insideY-gdcBed.height)<.002,'bed must close the open center below the sculpture');
  // Start on the bed inside the hollow centre and push west into the low wall.
  const actor=capsuleAt(point(0,0,gdcBed.height));let unsupportedFrames=0;
  try{
    for(let i=0;i<240;i++)if(!actor.step(-east.x*3/60,-east.z*3/60))unsupportedFrames++;
    const stopped={...actor.body.translation()},[u,v]=uv(stopped.x,stopped.z);
    assert(u<-.5&&u>-3.7&&Math.abs(v)<.15,'capsule must stop at the interior low wall');
    assert(Math.abs(stopped.y-.905-gdcBed.height)<.07,'collision may not lift capsule over the sculpture wall');
    for(let i=0;i<120;i++)actor.step(-east.x*3/60,-east.z*3/60);
    const final={...actor.body.translation()};assert(Math.hypot(final.x-stopped.x,final.z-stopped.z)<.03,'sustained push penetrated artwork');
    for(let i=0;i<25;i++)actor.step(east.x*3/60,east.z*3/60);
    const released={...actor.body.translation()};assert(Math.hypot(released.x-final.x,released.z-final.z)>.8,'capsule cannot retreat from artwork');
    return{artworkBounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},stopped,final,released,unsupportedFrames};
  }finally{actor.dispose();}
});
world.free();
check('Owned resources dispose exactly once and caller materials remain owned by caller',()=>{
  const expectedGeometries=new Set([...facade.meshes.map(m=>m.geometry),...atrium.geometries,...court.geometries]);
  const expectedMaterials=new Set([...Object.values(facade.materials),...Object.values(atrium.materials),...court.materials]);
  const counts=new Map();for(const r of [...expectedGeometries,...expectedMaterials]){counts.set(r,0);r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));}
  let callerDisposals=0;for(const m of [grass,concrete])m.addEventListener('dispose',()=>callerDisposals++);
  facade.dispose();facade.dispose();atrium.dispose();atrium.dispose();court.dispose();court.dispose();
  for(const count of counts.values())assert.equal(count,1,'owned resource leaked or disposed repeatedly');
  assert.equal(callerDisposals,0,'external frontage material ownership changed');
  return{geometryCount:expectedGeometries.size,materialCount:expectedMaterials.size};
});
frontage.mesh.geometry.dispose();frontage.material.dispose();grass.dispose();concrete.dispose();
const report={passed:failures.length===0,configuration:config,atriumClearancePadding,checks,failures,
  limits:['Uses real builders, Rapier capsule dimensions and movement settings with an explicit corridor grade fixture.',
    'Node checks do not validate shader appearance, source tile alignment during streaming, lighting or browser frame time.',
    'Source preservation is sampled at named protected locations; it is not a proof for every campus triangle.']};
writeFileSync(new URL(`../evidence/${prefix}-gdc-courtyard-check.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,checks:checks.map(({name,passed})=>({name,passed})),failures},null,2));
if(failures.length)process.exitCode=1;
