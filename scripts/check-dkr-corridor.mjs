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
const {buildDkrCorridor,dkrRoute}=await import('../lib/campus/dkr-corridor.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const {characterSupported}=await import('../lib/campus/character-support.ts');
const prefix=process.argv[2]??'iteration-35';assert(/^[a-z0-9-]+$/.test(prefix),'safe evidence prefix');
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
const layout=buildDkrCorridor(sourceMaterial,(x,z)=>terrain.height(x,z)+.04);
const plan=JSON.parse(readFileSync(new URL('../lib/campus/data/dkr-surfaces.json',import.meta.url)));
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0),identity=new T.Matrix4(),checks=[],failures=[],coatingOffsets=new Map();
function check(name,fn){if(process.argv[3]&&!name.includes(process.argv[3]))return;try{checks.push({name,passed:true,details:fn()});}catch(e){checks.push({name,passed:false});failures.push({name,error:e.message});}}
const referenceHeight=(x,z)=>layout.height(x,z);
function groundProbe(x,z,reference=referenceHeight(x,z)){
  const y=reference+.7,origin=new T.Vector3(x,y,z);ray.set(origin,down);ray.far=4;
  const hits=ray.intersectObject(walkway.surfaces,true);
  // Yellow curb paint is a visual coating with deliberately no collider.
  // Keep physical floor checks strict and record its visual offset separately.
  const shown=hits.find(h=>h.object.name!=='DKR yellow curb paint');
  if(hits[0]?.object.name==='DKR yellow curb paint'&&shown)
    coatingOffsets.set(`${x},${z}`,{x,z,visualY:hits[0].point.y,floorY:shown.point.y,offset:hits[0].point.y-shown.point.y});
  const solid=world.castRay(new RAPIER.Ray(origin,down),4,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
  return{y,shown,solid};
}
function ground(x,z,reference=referenceHeight(x,z)){
  const {y,shown,solid}=groundProbe(x,z,reference);
  assert(shown&&solid,`missing ground at ${x.toFixed(3)},${z.toFixed(3)} (render=${!!shown}, collision=${!!solid})`);
  assert(shown.face.normal.y>.7,`walking surface has wrong winding or steep face at ${x},${z}; mesh=${shown.object.name}, normal=${JSON.stringify(shown.face.normal.toArray())}, hit=${JSON.stringify(shown.point.toArray())}`);
  const error=Math.abs(shown.point.y-(y-solid.timeOfImpact));
  assert(error<.003,`ground/collider disagree by ${error.toFixed(4)}m at ${x.toFixed(3)},${z.toFixed(3)}; mesh=${shown.object.name}, shown=${shown.point.y}, solid=${y-solid.timeOfImpact}, normal=${JSON.stringify(shown.face.normal.toArray())}, face=${shown.faceIndex}`);
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
function sourcePatch(name,p,clear=false,size=.025,tangent){
  const d=tangent??[1,0];
  const g=new T.BufferGeometry().setAttribute('position',new T.Float32BufferAttribute([
    p[0]-size*d[0],p[1]-size,p[2]-size*d[1],p[0]+size*d[0],p[1]-size,p[2]+size*d[1],p[0],p[1]+size,p[2]+(tangent?0:size*.6)],3));g.computeVertexNormals();
  const trimmed=subtractVolumes(g,identity,walkway.volumes);
  try{
    if(clear)assert(trimmed&&trimmed.attributes.position.count===0,`${name}: source obstruction remains at ${JSON.stringify(p)}`);
    else assert(trimmed===null,`${name}: protected source fragment was cut at ${JSON.stringify(p)}`);
  }finally{g.dispose();trimmed?.dispose();}
}
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
  const actor=capsuleAt(points[0]);let frames=0,unsupportedFrames=0,maxFlatFootError=0;const legs=[],edgeSupport=[];
  try{
    for(const [x,z] of [...points.slice(1),...points.slice(0,-1).reverse()]){
      let remaining=Infinity;const legStart=frames;
      for(let i=0;i<2400;i++){
        const p=actor.body.translation(),dx=x-p.x,dz=z-p.z;remaining=Math.hypot(dx,dz);if(remaining<.075)break;
        const step=Math.min(3/60,remaining);if(!actor.step(dx/remaining*step,dz/remaining*step))unsupportedFrames++;frames++;
        const now=actor.body.translation();
        if(frames%3===0){
          const floor=ground(now.x,now.z),signedError=now.y-.905-floor.height,error=Math.abs(signedError);
          maxFlatFootError=Math.max(maxFlatFootError,error);
          // A capsule may rest on a curb edge while its centre remains over the
          // lower street. Verify actual contact without changing the controller.
          const tolerance=.12;
          if(error>=tolerance){
            const supportGap=signedError>0?footSupportGap(now):Infinity;
            assert(supportGap<.055,`capsule departed walk surface by ${error.toFixed(3)}m with support gap ${supportGap.toFixed(3)}m at ${JSON.stringify(now)}`);
            edgeSupport.push({frame:frames,point:{...now},centerFootError:error,supportGap});
          }
        }
      }
      assert(remaining<.075,`capsule blocked before ${x},${z} at ${JSON.stringify(actor.body.translation())}`);
      legs.push({target:[x,z],end:{...actor.body.translation()},frames:frames-legStart,remaining});
    }
    assert.equal(unsupportedFrames,0,'walking route has unsupported frames');
    return{frames,unsupportedFrames,maxFlatFootError,edgeSupport,legs};
  }finally{actor.dispose();}
}
function cellInterior(cell,index){
  assert.equal(cell.rings.length,1,`cell ${index} contains a hole ignored by the runtime`);
  const ring=cell.rings[0].slice();if(ring[0][0]===ring.at(-1)[0]&&ring[0][1]===ring.at(-1)[1])ring.pop();
  assert(ring.length>=3,`cell ${index} is degenerate`);let sign=0,area=0;
  for(let i=0;i<ring.length;i++){
    const a=ring[i],b=ring[(i+1)%ring.length],c=ring[(i+2)%ring.length];
    assert(Math.hypot(b[0]-a[0],b[1]-a[1])>1e-7,`cell ${index} has a zero-length edge, which disables its source cut`);
    const cross=(b[0]-a[0])*(c[1]-b[1])-(b[1]-a[1])*(c[0]-b[0]);
    if(Math.abs(cross)>1e-7){assert(sign===0||Math.sign(cross)===sign,`cell ${index} is nonconvex; clipping would miss its interior`);sign=Math.sign(cross);}
    area+=a[0]*b[1]-b[0]*a[1];
  }
  assert(Math.abs(area)>.00001,`cell ${index} has zero area`);
  const p=ring.reduce((s,p)=>[s[0]+p[0]/ring.length,s[1]+p[1]/ring.length],[0,0]);
  const interiorDistance=Math.min(...ring.map((a,i)=>{const b=ring[(i+1)%ring.length];return Math.abs((b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]))/Math.hypot(b[0]-a[0],b[1]-a[1]);}));
  return{p,interiorDistance};
}
check('Physical street cells are convex without holes and have matching render/collision',()=>{
  let samples=0,maxError=0;const cellFailures=[];
  for(const [index,cell] of plan.surfaces.entries())try{
    const {p}=cellInterior(cell,index),g=ground(...p);maxError=Math.max(maxError,g.error);samples++;
  }catch(e){cellFailures.push({index,error:e.message});}
  assert.equal(cellFailures.length,0,`cell failures: ${JSON.stringify(cellFailures)}`);
  return{cells:plan.surfaces.length,samples,maxError};
});
check('Facade-aware clearance cells remove walking obstructions and capsule headroom',()=>{
  assert(Array.isArray(plan.clearanceSurfaces),'separate facade-aware clearance cells are missing');
  let samples=0;const cellFailures=[];
  for(const [index,cell] of plan.clearanceSurfaces.entries())try{
    const {p,interiorDistance}=cellInterior(cell,index),g=ground(...p);
    // Bound witness patches inside small cells. Physical paving intentionally
    // continues into the facade protection zone, where source must remain.
    for(const aboveGround of [.6,2.4]){sourcePatch(`clearance cell ${index} walking/headroom obstruction`,[p[0],g.height+aboveGround,p[1]],true,Math.min(.025,interiorDistance*.2));samples++;}
  }catch(e){cellFailures.push({index,error:e.message});}
  assert.equal(cellFailures.length,0,`clearance failures: ${JSON.stringify(cellFailures)}`);
  return{cells:plan.clearanceSurfaces.length,samples};
});
check('The entire stadium route has center and lateral walking surfaces',()=>{
  let samples=0,maxError=0;const heights=[];
  for(let i=1;i<dkrRoute.length;i++){
    const a=new T.Vector3(dkrRoute[i-1][0],0,dkrRoute[i-1][1]),b=new T.Vector3(dkrRoute[i][0],0,dkrRoute[i][1]);
    const d=b.clone().sub(a),n=new T.Vector3(-d.z,0,d.x).normalize(),cells=Math.ceil(d.length()/1.5);
    for(let j=0;j<=cells;j++)for(const lateral of [-.45,0,.45]){
      const p=a.clone().addScaledVector(d,j/cells).addScaledVector(n,lateral),g=ground(p.x,p.z);
      for(const aboveGround of [.6,2.4])sourcePatch(`route segment ${i}, lateral ${lateral} headroom`,[p.x,g.height+aboveGround,p.z],true);
      samples++;maxError=Math.max(maxError,g.error);if(lateral===0)heights.push({x:p.x,z:p.z,height:g.height});
    }
  }
  return{samples,maxError,heights};
});
check('Facade protection leaves the previously validated physical route unchanged',()=>{
  const baseline=JSON.parse(readFileSync(new URL('../evidence/iteration-35-pre-facade-dkr-corridor-check.json',import.meta.url)));
  const previous=baseline.checks.find(c=>c.name==='The entire stadium route has center and lateral walking surfaces');assert(previous?.passed);
  let maxHeightChange=0;
  for(const p of previous.details.heights){const now=ground(p.x,p.z),change=Math.abs(now.height-p.height);maxHeightChange=Math.max(maxHeightChange,change);assert(change<.000001,`physical route height changed ${change}m at ${p.x},${p.z}`);}
  return{samples:previous.details.heights.length,maxHeightChange,baseline:'iteration-35-pre-facade-dkr-corridor-check.json'};
});
check('Measured narrow classification seams on the bridge have continuous walking geometry',()=>{
  let samples=0,maxError=0;
  for(const [lo,hi] of [[285.1,285.5],[312.25,312.55]])for(let x=lo;x<=hi;x+=.005){
    const index=dkrRoute.findIndex((p,i)=>i>0&&dkrRoute[i-1][0]<=x&&p[0]>=x);assert(index>0,'bridge seam is outside route');
    const a=dkrRoute[index-1],b=dkrRoute[index],z=T.MathUtils.lerp(a[1],b[1],(x-a[0])/(b[0]-a[0]));
    for(const offset of [-.3,0,.3]){const g=ground(x,z+offset);maxError=Math.max(maxError,g.error);samples++;}
  }
  return{samples,maxError,spacingMetres:.005,description:'Five-millimetre transects cover the previously reported 8.4cm and 1cm bridge classification gaps.'};
});
check('The creek crossing is a thin elevated deck and preserves ground below it',()=>{
  const probes=JSON.parse(readFileSync(new URL('../evidence/iteration-35-dkr-ground-probes.json',import.meta.url)));
  const witnesses=probes.rows.filter(r=>r.way===37749592&&r.x>290&&r.x<308);
  assert.equal(witnesses.length,4,'recorded central bridge reference changed');const results=[];
  for(const p of witnesses){
    const top=ground(p.x,p.z),deck=walkway.surfaces.children.find(m=>m.name==='24th and San Jacinto asphalt surfaces');assert(deck);
    assert.equal(top.mesh,deck.name,'bridge must use the authored road deck');
    assert(top.height-p.terrain>1,'bridge fell onto bare-earth terrain');
    assert(Math.abs(top.height-Math.min(...p.hits.map(h=>h.y)))<.25,'bridge is displaced from captured source deck height');
    const origin=new T.Vector3(p.x,p.terrain+.05,p.z),up=new T.Vector3(0,1,0);ray.set(origin,up);ray.far=4;
    const underside=ray.intersectObject(deck)[0],solid=world.castRay(new RAPIER.Ray(origin,up),4,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    assert(underside&&solid,'bridge underside/collider missing');
    assert(Math.abs(underside.point.y-(origin.y+solid.timeOfImpact))<.003,'bridge underside render/collider mismatch');
    const thickness=top.height-underside.point.y;assert(Math.abs(thickness-.48)<.005,`bridge at ${p.x} has ${thickness.toFixed(3)}m solid fill rather than a thin deck`);
    sourcePatch('terrain-level creek witness',[p.x,p.terrain,p.z]);
    sourcePatch('open space below thin bridge deck',[p.x,top.height-.8,p.z]);
    sourcePatch('old road surface must clear above deck',[p.x,top.height+.1,p.z],true);
    sourcePatch('high source context above bounded bridge clearance',[p.x,top.height+4,p.z]);
    results.push({x:p.x,z:p.z,top:top.height,underside:underside.point.y,terrain:p.terrain,thickness});
  }
  return{samples:results,interpretation:'Deck heights are recorded source measurements; preserved below-deck witnesses use real terrain elevations and open space, not a captured creek mesh.'};
});
check('The 24th crossing connects the street to its south sidewalk with a climbable curb',()=>{
  const x=188.5,samples=[],transitions=[];let previous;
  for(let z=-129;z<=-114.25;z+=.125){
    const hit=ground(x,z);samples.push({x,z,...hit});
    if(previous){
      const rise=hit.height-previous.height;
      assert(Math.abs(rise)<.19,`24th crossing has an unexpected ${rise.toFixed(3)}m step at ${x},${z}`);
      const materialTransition=previous.mesh!==hit.mesh&&[previous.mesh,hit.mesh].every(n=>n.startsWith('24th and San Jacinto'));
      if(materialTransition)transitions.push({z,from:previous.mesh,to:hit.mesh,rise});
    }previous=hit;
  }
  assert(samples.some(t=>t.mesh.endsWith('asphalt surfaces')),'crossing never reaches the actual road');
  assert(transitions.some(t=>t.to.includes('concrete')),'crossing does not reach the south sidewalk');
  for(const t of transitions)assert(Math.abs(Math.abs(t.rise)-.15)<.025,`curb is not close to its 15cm road/sidewalk height difference at ${t.z}`);
  return{samples,transitions};
});
check('Named City building facade locations outside original street polygons remain uncut',()=>{
  const source=JSON.parse(readFileSync(new URL('../../research/dkr-route/route-surfaces-local.json',import.meta.url)));
  const polygons=source.features.filter(f=>['Paved Road','Sidewalk','Bridge','Pavement'].includes(f.kind)).flatMap(f=>f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates);
  const insideRing=(p,ring)=>{
    let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
    }return inside;
  };
  const insideSource=p=>polygons.some(r=>insideRing(p,r[0])&&!r.slice(1).some(h=>insideRing(p,h)));
  const distanceToSource=p=>Math.min(...polygons.flatMap(poly=>poly.flatMap(r=>r.slice(1).map((b,i)=>{
    const a=r[i],dx=b[0]-a[0],dz=b[1]-a[1],length=dx*dx+dz*dz;
    const t=length?T.MathUtils.clamp(((p[0]-a[0])*dx+(p[1]-a[1])*dz)/length,0,1):0;
    return Math.hypot(p[0]-a[0]-dx*t,p[1]-a[1]-dz*t);
  }))));
  const results=[];
  for(const abbr of ['ART','TCP','UTX','WIN','NEZ']){
    const building=data.buildings.find(b=>b.abbr===abbr);assert(building,`missing independent ${abbr} building footprint`);let preserved=0,excluded=0;
    for(const ring of building.rings)for(let i=1;i<ring.length;i++)for(const t of [.25,.5,.75]){
      const p=[T.MathUtils.lerp(ring[i-1][0],ring[i][0],t),T.MathUtils.lerp(ring[i-1][1],ring[i][1],t)];
      if(p[0]>380||p[1]<-110||p[1]>280||insideSource(p)||distanceToSource(p)<.15){excluded++;continue;}
      const dx=ring[i][0]-ring[i-1][0],dz=ring[i][1]-ring[i-1][1],len=Math.hypot(dx,dz);if(len<.15){excluded++;continue;}
      const area=ring.slice(1).reduce((s,b,j)=>s+ring[j][0]*b[1]-b[0]*ring[j][1],0),sign=Math.sign(area);
      // Sidewalks may end exactly at the City facade boundary. A vertical
      // wall-aligned patch five centimetres inside the building checks interior
      // preservation without falsely cutting a test triangle across the curb.
      const inside=[p[0]-dz/len*sign*.05,p[1]+dx/len*sign*.05];
      assert(insideRing(inside,ring),`${abbr} wall witness is not inside its source footprint`);
      for(const y of [terrain.height(...p)+1,terrain.height(...p)+3])sourcePatch(`${abbr} exterior facade`,[inside[0],y,inside[1]],false,.025,[dx/len,dz/len]);
      preserved+=2;
    }
    assert(preserved>=6,`not enough independent ${abbr} facade witnesses`);results.push({abbr,cityBuildingId:building.id,preserved,excluded});
  }
  return{buildings:results,interpretation:'XZ facade samples come from the separate City building footprints. Original road/sidewalk polygons, including holes, independently exclude intended street areas; two low facade elevations test that new cuts stay away from buildings.'};
});
check('Recorded stadium source-wall samples remain intact at both low facade elevations',()=>{
  const probes=JSON.parse(readFileSync(new URL('../evidence/iteration-35-dkr-facade-probes.json',import.meta.url)));
  assert.equal(probes.geometryRestored,true,'wall fixture must have captured the restored source');
  const zs=[180,190,220,230,240,250,260,264,268,270];
  const rows=probes.rows.filter(r=>zs.includes(r.z)&&[1.2,2.4].includes(r.heightAboveTerrain));
  assert.equal(rows.length,20,'recorded low stadium facade fixture changed');
  const samples=[],damaged=[];
  for(const row of rows){
    const hit=row.hits[0];assert(hit,'recorded wall ray has no nearest source hit');
    // These normals were transformed by the capturing browser's normalMatrix.
    // Keep a small vertical patch tangent to that observed wall, directly at
    // its measured position: no City-footprint substitution or inward inset.
    const n=new T.Vector3(...hit.normal),length=Math.hypot(n.x,n.z);assert(length>.9,'source witness is not a near-vertical wall');
    const point=[hit.x,row.y,row.z],tangent=[-n.z/length,n.x/length];
    try{sourcePatch(`recorded stadium wall Z${row.z}, height${row.heightAboveTerrain}`,point,false,.025,tangent);}
    catch(e){damaged.push({point,error:e.message});}
    samples.push({point,heightAboveTerrain:row.heightAboveTerrain,worldNormal:hit.normal});
  }
  assert.equal(damaged.length,0,`actual stadium wall damage: ${JSON.stringify(damaged)}`);
  return{samples,interpretation:'Twenty observed source-wall positions at ten Z transects and two low elevations must survive complete clipping. This supplements, rather than substitutes for, the City footprint witnesses.'};
});
check('Bridge railing has matching solid contact and stops a normal capsule',()=>{
  const rails=walkway.surfaces.children.find(m=>m.name==='24th bridge open metal railings');assert(rails);
  const results=[];
  for(const z of [-121.5625,-105.2725]){
    const north=z<-115,inward=north?1:-1,p=[296,z+inward*1.2],base=layout.height(296,z),direction=new T.Vector3(0,0,-inward);
    // The railing is intentionally open between pickets. Find its actual top
    // bar vertically, then compare a side ray through that solid member.
    ray.set(new T.Vector3(296,base+2,z),down);ray.far=3;
    const top=ray.intersectObject(rails)[0];assert(top,'bridge rail top bar is missing');
    const origin=new T.Vector3(p[0],top.point.y-.015,p[1]);
    ray.set(origin,direction);ray.far=3;const shown=ray.intersectObject(rails)[0];
    const solid=world.castRay(new RAPIER.Ray(origin,direction),3,true,RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC);
    assert(shown&&solid,'railing visual or collider has a gap at capsule-body height');
    assert(Math.abs(shown.distance-solid.timeOfImpact)<.003,'railing render/collider contact differs');
    const actor=capsuleAt(p);let unsupported=0;
    try{
      for(let frame=0;frame<90;frame++)if(!actor.step(0,-inward*.05))unsupported++;
      const contact={...actor.body.translation()};assert((contact.z-z)*inward>.30,'capsule passed through bridge rail');
      assert(Math.abs(contact.z-p[1])>.5,'capsule did not reach the rail');assert.equal(unsupported,0,'rail approach lost support');
      for(let frame=0;frame<20;frame++)actor.step(0,inward*.05);
      assert((actor.body.translation().z-contact.z)*inward>.8,'capsule cannot retreat from rail');
      results.push({side:north?'north':'south',contact,unsupportedFrames:unsupported});
    }finally{actor.dispose();}
  }
  return results;
});
check('Normal capsule completes the stadium route down and back, including its curbs',()=>walkRoundTrip(dkrRoute));
walkway.dispose(world);world.free();
for(const g of new Set(layout.meshes.map(m=>m.geometry)))g.dispose();layout.materials.forEach(m=>m.dispose());sourceMaterial.dispose();
const report={passed:failures.length===0,checks,failures,stats:layout.stats,
  selectedCheck:process.argv[3]??null,
  cosmeticCoating:{mesh:'DKR yellow curb paint',sampleCount:coatingOffsets.size,maxOffset:Math.max(0,...[...coatingOffsets.values()].map(p=>p.offset)),samples:[...coatingOffsets.values()]},
  limits:['All render/collision and controller checks use full SpeedwayWalkway with the real Terrain dataset.',
    'No streamed tiles, loaded foliage or live boundary-height stitching are installed in this fixture.',
    'Bridge preservation uses witness triangles at terrain and below-deck elevations; these are not captured creek-bed source triangles.',
    'Normal gravity, .32m autostep and .38m snap are used, without jumping or position correction.']};
writeFileSync(new URL(`../evidence/${prefix}-dkr-corridor-check.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,checks:checks.map(({name,passed})=>({name,passed})),failures},null,2));
if(failures.length)process.exitCode=1;
