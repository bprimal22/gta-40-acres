import assert from 'node:assert/strict';
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import {registerHooks} from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

// Exercise the real builders without a browser, GPU, textures or tile requests.
registerHooks({resolve(s,c,next){
  if(s.startsWith('.')&&c.parentURL&&!/\.[a-z]+$/i.test(s)){
    const u=new URL(`${s}.ts`,c.parentURL);if(existsSync(u))return{url:u.href,shortCircuit:true};
  }return next(s,c);
},load(url,c,next){
  if(!url.endsWith('.ts'))return next(url,c);
  return{format:'module',shortCircuit:true,source:ts.transpileModule(readFileSync(new URL(url),'utf8'),
    {compilerOptions:{target:ts.ScriptTarget.ES2023,module:ts.ModuleKind.ESNext}}).outputText};
}});
const {buildGdcFacades,gdcRoofEnds}=await import('../lib/campus/gdc-facade.ts');
const {buildGdcFrontage,inGdcFrontage}=await import('../lib/campus/gdc-frontage.ts');
const {subtractVolumes}=await import('../lib/campus/clip-volume.ts');
const {characterSupported}=await import('../lib/campus/character-support.ts');
const prefix=process.argv[2]??'gdc-current';assert(/^[a-z0-9-]+$/.test(prefix),'safe evidence prefix');
const data=JSON.parse(readFileSync(new URL('../public/data/campus.json',import.meta.url)));
const configuration={baseElevation:2.45,floors:6,floorHeight:4.45,returnDepth:12};
const facade=buildGdcFacades(configuration);
// A longitudinal grade variation exercises mesh interpolation. The full
// Speedway mesh and actual streamed thresholds remain integration checks.
const corridorHeight=(_x,z)=>3.4+(z+58.5)*.2/78.9;
const grass=new T.MeshStandardMaterial(),concrete=new T.MeshStandardMaterial();
const frontage=buildGdcFrontage(data,corridorHeight,grass,concrete);
await RAPIER.init();const world=new RAPIER.World({x:0,y:-24,z:0});
const visual=new T.Group();visual.add(...facade.meshes,frontage.mesh);visual.updateWorldMatrix(true,true);
for(const g of [...facade.colliderGeometries,frontage.mesh.geometry]){
  const p=g.attributes.position,indices=g.index?.array??Uint32Array.from({length:p.count},(_,i)=>i);
  world.createCollider(RAPIER.ColliderDesc.trimesh(p.array,indices,RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
}world.step();
const checks=[],failures=[];
function check(name,fn){try{checks.push({name,passed:true,details:fn()});}catch(e){failures.push({name,error:e.message});checks.push({name,passed:false});}}
const ray=new T.Raycaster(),down=new T.Vector3(0,-1,0);
function surface(x,z){
  const origin=new T.Vector3(x,12,z);ray.set(origin,down);
  const shown=ray.intersectObject(frontage.mesh)[0],solid=world.castRay(new RAPIER.Ray(origin,down),15,true);
  assert(shown&&solid,`ground missing at ${x.toFixed(3)},${z.toFixed(3)}`);
  assert(shown.face.normal.y>.9,'frontage must face upward and remain walkable');
  assert(Math.abs(shown.point.y-(12-solid.timeOfImpact))<.002,`frontage render/collision height mismatch at${x.toFixed(3)},${z.toFixed(3)}: visualY=${shown.point.y.toFixed(5)} physicsY=${(12-solid.timeOfImpact).toFixed(5)}`);
  assert(Math.abs(shown.point.y-frontage.height(x,z))<.035,'triangulated grade deviates from intended smooth transition');
  return shown.point.y;
}
// Records describe the geometry actually built. Reconstructing these endpoints
// from the former City roof envelope hid registration errors in stepped walls.
const endpoint=p=>{
  assert(Array.isArray(p)&&[2,3].includes(p.length)&&p.every(Number.isFinite),'finite facade endpoint required');
  return p.length===2?new T.Vector3(p[0],0,p[1]):new T.Vector3(...p);
};
const faces=facade.records.map(r=>({name:r.name,a:endpoint(r.a),b:endpoint(r.b),
  out:new T.Vector3(...r.outward),west:r.west}));
check('Finite geometry and fourteen reconstructed stepped faces',()=>{
  for(const m of facade.meshes)for(const a of Object.values(m.geometry.attributes))assert([...a.array].every(Number.isFinite),`${m.name}: invalid vertices`);
  assert([...frontage.mesh.geometry.attributes.position.array].every(Number.isFinite));
  assert.equal(facade.records.length,14);assert.equal(facade.stats.floors,6);assert.equal(facade.volumes.length,2);
  assert.equal(faces.filter(f=>f.west).length,10,'five stepped facets on each west wing end');
  for(const f of faces){
    const record=facade.records.find(r=>r.name===f.name),along=f.b.clone().sub(f.a).normalize();
    assert(Math.abs(f.a.distanceTo(f.b)-record.length)<1e-6,`${f.name}: record endpoints disagree with wall length`);
    assert(Math.abs(f.out.length()-1)<1e-6&&Math.abs(f.out.dot(along))<1e-6,`${f.name}: invalid outward frame`);
  }
  return{faces:facade.records.map(r=>r.name),triangles:facade.stats.triangles,frontageTriangles:frontage.mesh.geometry.attributes.position.count/3};
});
check('Stepped west-wall endpoints register to independent official UT footprint 402',()=>{
  const source=JSON.parse(readFileSync(new URL('../../research/raw/ut-official-buildings.geojson',import.meta.url)));
  const feature=source.features.find(f=>f.properties.OBJECTID===402);assert(feature,'official GDC footprint missing');
  assert.equal(feature.properties.Building_Abbr,'GDC');
  const scaleX=111320*Math.cos(data.origin[1]*Math.PI/180),scaleZ=110851;
  const points=feature.geometry.coordinates[0].map(([lon,lat])=>new T.Vector3((lon-data.origin[0])*scaleX,0,-(lat-data.origin[1])*scaleZ));
  let maximumEndpointError=0;
  for(const face of faces.filter(f=>f.west))for(const p of [face.a,face.b]){
    const error=Math.min(...points.map(q=>p.distanceTo(q)));maximumEndpointError=Math.max(maximumEndpointError,error);
    assert(error<.002,`${face.name}: west endpoint misses official ground corner by ${error.toFixed(3)}m`);
  }
  return{source:'research/raw/ut-official-buildings.geojson',objectId:402,wallFacets:10,maximumEndpointError};
});
check('Rendered/collision agreement on all ten stepped west facets and four returns',()=>{
  const results=[];let samples=0;
  for(const face of faces){
    const u=face.b.clone().sub(face.a).normalize(),length=face.a.distanceTo(face.b);
    let glazing=0,masonry=0,minDepth=Infinity,maxDepth=-Infinity;
    for(const floor of [0,2,5])for(let s=.45;s<length-.45;s+=Math.min(.23,length/30)){
      const origin=face.a.clone().addScaledVector(u,s).addScaledVector(face.out,3).setY(2.45+floor*4.45+1.78);
      const direction=face.out.clone().negate();ray.set(origin,direction);
      const shown=ray.intersectObject(visual,true)[0],solid=world.castRay(new RAPIER.Ray(origin,direction),5,true);
      assert(shown&&solid,`${face.name}: hole at${s.toFixed(2)}m/floor${floor+1}`);
      assert(shown.distance>2.4&&shown.distance<3.6,`${face.name}: reversed wall or deep gap`);
      assert(Math.abs(shown.distance-solid.timeOfImpact)<.002,`${face.name}: render/collision mismatch`);
      assert(shown.face.normal.dot(face.out)>.5,`${face.name}: visible exterior winding faces away from courtyard/corridor`);
      assert(shown.object.material!==facade.materials.louver,'low wall rays must not rely on noncolliding louvers');
      if(shown.object.material===facade.materials.glass)glazing++;
      if(shown.object.material===facade.materials.stone||shown.object.material===facade.materials.brick)masonry++;
      minDepth=Math.min(minDepth,3-shown.distance);maxDepth=Math.max(maxDepth,3-shown.distance);samples++;
    }
    assert(glazing>2&&masonry>2,`${face.name}: missing glazing/masonry articulation`);
    assert(maxDepth-minDepth>.4,`${face.name}: facade relief lost`);
    results.push({face:face.name,glazing,masonry,minDepth,maxDepth});
  }return{samples,faces:results};
});
check('Authored west-wing roofs close the bounded replacement with upward surfaces',()=>{
  const results=[];
  for(const source of gdcRoofEnds){
    const a=endpoint(source.a),b=endpoint(source.b),u=b.clone().sub(a).normalize();
    const face={name:source.name,a,b,out:new T.Vector3(-u.z,0,u.x)};
    const point=face.a.clone().lerp(face.b,.5).addScaledVector(face.out,-configuration.returnDepth*.5).setY(40);
    ray.set(point,down);
    const shown=ray.intersectObject(visual,true)[0],solid=world.castRay(new RAPIER.Ray(point,down),20,true);
    assert(shown&&solid,`${face.name}: missing replacement roof`);
    assert(shown.face.normal.y>.95,`${face.name}: roof must face upward`);
    assert(Math.abs(shown.distance-solid.timeOfImpact)<.002,`${face.name}: roof render/collision mismatch`);
    const roofY=shown.point.y,expected=configuration.baseElevation+configuration.floors*configuration.floorHeight;
    assert(roofY>expected&&roofY<expected+.5,`${face.name}: replacement roof outside authored roof band`);
    results.push({face:face.name,point:shown.point.toArray(),normal:shown.face.normal.toArray()});
  }return results;
});
check('Unscreened top floor and noncolliding decorative grids',()=>{
  const screen=facade.meshes.find(m=>m.material===facade.materials.louver);assert(screen);
  assert(!facade.colliderGeometries.includes(screen.geometry),'louvers must not become player snag colliders');
  screen.geometry.computeBoundingBox();const topLow=2.45+5*4.45;
  assert(screen.geometry.boundingBox.max.y<topLow+.1,'screens must stop below top floor');
  return{screenTopY:screen.geometry.boundingBox.max.y,topStoreyLowY:topLow};
});
// The builder retains source path IDs but may correct a route whose mapped
// centerline crosses a registered facade. Verify its actual shader segments.
function authoredPaths(){
  assert(Array.isArray(frontage.pathSegments),'builder must expose authored paving segments');
  assert(Array.isArray(frontage.pathRoutes),'builder must expose adapted route topology');
  const expectedIds=[...data.paths.filter(p=>frontage.pathIds.includes(p.id)).map(p=>p.id),'southern connector'];
  assert.deepEqual(frontage.pathRoutes.map(p=>p.id),expectedIds,'authored routes retain source identities');
  const flattened=[];
  for(const route of frontage.pathRoutes){
    assert(route.points.length>=2,`route ${route.id} needs endpoints`);
    for(const point of route.points)assert(point.length===2&&point.every(Number.isFinite),'finite route X/Z points');
    for(let i=1;i<route.points.length;i++)flattened.push([...route.points[i-1],...route.points[i]]);
  }
  assert.deepEqual(frontage.pathSegments,flattened,'paving shader segments must match tested routes');
  return frontage.pathRoutes;
}
check('Authored paved paths have continuous upward render/collision surfaces',()=>{
  const coverage=[];let samples=0,maxInterpolationError=0;
  const paths=authoredPaths();
  for(const path of paths){let inside=0,outside=0;
    for(let j=1;j<path.points.length;j++){
      const a=path.points[j-1],b=path.points[j],count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/.4);
      for(let i=0;i<=count;i++){
        const t=(i+.001)/(count+.002),x=T.MathUtils.lerp(a[0],b[0],t),z=T.MathUtils.lerp(a[1],b[1],t);
        if(!inGdcFrontage(x,z)){outside++;continue;}
        assert(frontage.paved(x,z),`authored path${path.id} classified as groundcover`);
        const y=surface(x,z);maxInterpolationError=Math.max(maxInterpolationError,Math.abs(y-frontage.height(x,z)));samples++;inside++;
      }
    }coverage.push({id:path.id,samplesInsideRepair:inside,samplesOutsideRepair:outside});
  }assert(samples>150,'insufficient path coverage');
  return{samples,maxInterpolationError,coverage,outsideRepair:'These clipped route portions need the full walkway or retained source.'};
});
check('Frontage descends smoothly from Speedway to both wing bases',()=>{
  const result=[];
  // Avoid z≈4, where the official ground outline has a short projecting jog;
  // a cross-grade there intentionally encounters the jog's solid masonry.
  for(const z of [-45,-35,-7,6]){
    const face=faces.find(f=>f.west&&Math.min(f.a.z,f.b.z)<=z&&Math.max(f.a.z,f.b.z)>=z);assert(face,'facade crossing needed');
    const t=(z-face.a.z)/(face.b.z-face.a.z),wallX=T.MathUtils.lerp(face.a.x,face.b.x,t);
    const edgeX=7.07-.09*(z+17.625),firstX=edgeX+.22;let previous=null,maxSlope=0,firstY=0,lastY=0;
    for(let x=firstX;x<wallX-.45;x+=.2){
      assert(inGdcFrontage(x,z),`frontage ends before ${face.name} at ${x.toFixed(3)},${z.toFixed(3)}`);const y=surface(x,z);
      if(!previous)firstY=y;else{assert(y<=previous.y+.005,'grade must descend toward building');maxSlope=Math.max(maxSlope,Math.abs(y-previous.y)/(x-previous.x));}
      previous={x,y};lastY=y;
    }
    assert(Math.abs(firstY-corridorHeight(firstX,z))<.035,'excessive Speedway edge height step');
    assert(Math.abs(lastY-2.45)<.04,'frontage must meet facade threshold');assert(maxSlope<.25,'frontage slope too steep');
    result.push({z,firstY,lastY,maxSlope});
  }return result;
});
const allCuts=[...facade.volumes,...frontage.volumes],identity=new T.Matrix4();
// Clearance/roof depth is bounded against the source roof envelope, while wall
// probes above use the official ground-level stepped wall records.
const roofEnds=gdcRoofEnds.map(f=>{const a=endpoint(f.a),b=endpoint(f.b),u=b.clone().sub(a).normalize();
  return{name:f.name,a,b,out:new T.Vector3(-u.z,0,u.x)};});
function clearedPatch(point,size=.08,volumes=allCuts){
  const g=new T.BoxGeometry(size,size,size).translate(...point),cut=subtractVolumes(g,identity,volumes);
  try{assert(cut&&cut.attributes.position.count===0,`scan fragment not cleared at ${point.join(',')}`);}finally{g.dispose();cut?.dispose();}
}
function retainedPatch(name,point,size=.3,volumes=allCuts){
  const g=new T.BoxGeometry(size,size,size).translate(...point),cut=subtractVolumes(g,identity,volumes);
  try{assert(cut===null,`${name} should survive bounded repair: ${point.join(',')}`);}finally{g.dispose();cut?.dispose();}
}
check('Recorded west scan walls are removed within the 12m replacement',()=>{
  const path=new URL('../evidence/iteration-31-gdc-wall-probes.json',import.meta.url);assert(existsSync(path),'recorded source probes required');
  const probes=JSON.parse(readFileSync(path));let hits=0,missed=0;const outsideReplacement=[];
  for(const p of probes){
    if(!p.hit){missed++;continue;}
    const point=new T.Vector3(...p.hit.point);
    const inReplacement=roofEnds.some(f=>{
      const d=point.clone().sub(f.a),u=f.b.clone().sub(f.a).normalize();
      const along=d.dot(u),out=d.dot(f.out);
      return along>-.65&&along<f.a.distanceTo(f.b)+.65&&out>=-12&&out<=.65&&point.y>2.1&&point.y<30.35;
    });
    if(inReplacement){clearedPatch(p.hit.point,.08,facade.volumes);hits++;}
    else{retainedPatch('recorded source beyond facade replacement',p.hit.point,.08,facade.volumes);outsideReplacement.push(p.hit.point);}
  }
  assert(hits>40,'insufficient in-scope source hits');
  return{probeFile:'iteration-31-gdc-wall-probes.json',fragmentsCleared:hits,missedSourceRays:missed,outsideReplacement,
    outsideNote:'Facade-only cuts preserve these fragments. The independent integrated courtyard test covers the additional frontage/atrium replacement rather than treating this standalone 12m facade as the whole scene.'};
});
check('Recessed courtyard, remote roofs and outside ground survive clearance',()=>{
  const kept=[['recessed courtyard floor',[39,2.36,-18]],['recessed atrium',[52,12,-18]],
    ['north remote roof',[60,29.3,-40]],['south remote roof',[60,29.3,1]],['outer Speedway ground',[1,3.5,-40]],
    ['ground below wall repair',[35,1.5,-40]],['space above roof repair',[28,33,-40]]];
  for(const [name,p]of kept)retainedPatch(name,p);
  // The old x=27 preservation sample is now outside the official ground wall,
  // beneath the correctly extended frontage. That ground is explicitly replaced.
  clearedPatch([27,1.5,-40]);
  for(const face of roofEnds){
    const center=face.a.clone().lerp(face.b,.5);
    clearedPatch(center.clone().addScaledVector(face.out,-10.6).setY(10).toArray());
    retainedPatch(`${face.name} beyond12m`,center.clone().addScaledVector(face.out,-13).setY(10).toArray());
    // Exercise triangle splitting at the12m limit, not just point containment.
    const patch=new T.BoxGeometry(2.4,.3,1.2),u=face.b.clone().sub(face.a).normalize();
    patch.applyMatrix4(new T.Matrix4().makeBasis(face.out,new T.Vector3(0,1,0),u));
    patch.translate(...center.clone().addScaledVector(face.out,-12).setY(10).toArray());
    const cut=subtractVolumes(patch,identity,allCuts);assert(cut&&cut.attributes.position.count>0,'crossing geometry must survive partially');
    for(let i=0;i<cut.attributes.position.count;i++){
      const p=new T.Vector3().fromBufferAttribute(cut.attributes.position,i);
      assert(p.sub(center).dot(face.out)<=-12+.002,'retained fragment intrudes into replaced depth');
    }patch.dispose();cut.dispose();
  }return{preserved:kept.map(([name])=>name),depthBoundarySplit:true};
});
check('Game capsule traverses courtyard approach loop and southern connector',()=>{
  const paths=authoredPaths(),court=paths.find(p=>p.id===459840282).points,connector=paths.find(p=>p.id==='southern connector').points;
  const atX=(a,b,x)=>[x,T.MathUtils.lerp(a[1],b[1],(x-a[0])/(b[0]-a[0]))];
  // Endpoints extend onto the retained full Speedway. Trim only the ends to
  // positions inside this isolated frontage, preserving every authored bend.
  const routes=[{name:'courtyard approach loop',points:[atX(court[0],court[1],9),...court.slice(1,-1),atX(court.at(-2),court.at(-1),10)]},
    {name:'southern connector',points:[atX(...connector,5.2),atX(...connector,15),atX(...connector,29.5)]}],results=[];
  for(const route of routes){
    const [x,z]=route.points[0],body=world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x,surface(x,z)+.905,z));
    const capsule=world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34).setFriction(0),body);
    const controller=world.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);
    controller.setMaxSlopeClimbAngle(Math.PI*.25);controller.setMinSlopeSlideAngle(Math.PI*.28);world.step();
    let vertical=0,unsupportedFrames=0,frames=0,maxFootError=0;const legs=[];
    try{
      for(const target of [...route.points.slice(1),...route.points.slice(0,-1).reverse()]){
        let remaining=Infinity;
        for(let f=0;f<1500;f++){
          const p=body.translation(),dx=target[0]-p.x,dz=target[1]-p.z;remaining=Math.hypot(dx,dz);if(remaining<.1)break;
          vertical=Math.max(-35,vertical-24/60);const step=Math.min(3/60,remaining);
          controller.computeColliderMovement(capsule,{x:dx/remaining*step,y:vertical/60,z:dz/remaining*step});
          const d=controller.computedMovement(),supported=characterSupported(controller,p.y,vertical);
          if(!supported)unsupportedFrames++;if(supported&&vertical<0)vertical=0;
          body.setNextKinematicTranslation({x:p.x+d.x,y:p.y+d.y,z:p.z+d.z});world.step();frames++;
          const actual=body.translation();assert(inGdcFrontage(actual.x,actual.z),'capsule left authored frontage');
          const footError=Math.abs(actual.y-.905-frontage.height(actual.x,actual.z));maxFootError=Math.max(maxFootError,footError);
          assert(footError<.12,`capsule lost surface support: ${footError.toFixed(3)}m`);
        }
        const end={...body.translation()};legs.push({target,end,remaining});
        assert(remaining<.1,`${route.name} blocked approaching ${target.join(",")}: ${JSON.stringify(end)}`);
      }assert.equal(unsupportedFrames,0,`${route.name}: capsule must remain supported throughout the walk`);
      results.push({name:route.name,frames,unsupportedFrames,maxFootError,legs});
    }finally{world.removeCharacterController(controller);world.removeRigidBody(body);world.step();}
  }return results;
});
const report={passed:failures.length===0,configuration,checks,failures,stats:facade.stats,warnings:[
  'Node does not render shader paving or reflections. paved() is a logical classifier with a wider vegetation-exclusion margin.',
  'Frontage uses an explicit 3.4–3.6m corridor fixture. Full Speedway seams and retained streamed thresholds still need integration inspection.',
  'Louvers deliberately have no collision. Wall ray comparisons sample below them and across the unscreened upper row.'
],limits:'Real builders and Rapier game-capsule settings; no live browser, provider download, GPU visual acceptance or exact survey.'};
writeFileSync(new URL(`../evidence/${prefix}-gdc-landmark-check.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({passed:report.passed,checks:checks.map(({name,passed})=>({name,passed})),failures,stats:facade.stats},null,2));
world.free();facade.dispose();frontage.mesh.geometry.dispose();frontage.material.dispose();grass.dispose();concrete.dispose();
if(failures.length)process.exitCode=1;
