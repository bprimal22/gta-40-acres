import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import { buildPclFacades, pclFaces } from '../lib/campus/pcl-facade.ts';
import { pclMaterials } from '../lib/campus/pcl-materials.ts';
import { subtractVolumes } from '../lib/campus/clip-volume.ts';

await RAPIER.init();
const materials=pclMaterials(), ground=new THREE.MeshStandardMaterial();
const asset=buildPclFacades(materials,ground);
const group=new THREE.Group();
const physics=new RAPIER.World({x:0,y:-24,z:0});
group.add(...asset.meshes); group.updateWorldMatrix(true,true);
for(const mesh of asset.meshes) {
  const g=mesh.geometry;
  assert(Array.from(g.attributes.position.array).every(Number.isFinite));
  physics.createCollider(RAPIER.ColliderDesc.trimesh(g.attributes.position.array,
    Uint32Array.from({length:g.attributes.position.count},(_,i)=>i),RAPIER.TriMeshFlags.FIX_INTERNAL_EDGES));
}
physics.step();
const ray=new THREE.Raycaster();
let renderCollisionChecks=0;
for(const face of pclFaces) {
  const a=new THREE.Vector3(face.a[0],0,face.a[1]);
  const b=new THREE.Vector3(face.b[0],0,face.b[1]);
  const length=a.distanceTo(b),u=b.clone().sub(a).normalize(),out=new THREE.Vector3(u.z,0,-u.x);
  const at=(x,y,n)=>a.clone().addScaledVector(u,x).addScaledVector(out,n).setY(y);
  const hit=(x,y)=> {
    const origin=at(x,y,6),direction=out.clone().negate();
    ray.set(origin,direction);
    const visual=ray.intersectObject(group,true)[0];
    const physical=physics.castRay(new RAPIER.Ray(origin,direction),12,true);
    assert(visual&&physical,'façade must face the exterior and collide');
    assert(Math.abs(visual.distance-physical.timeOfImpact)<.002,'render/collision depth must match');
    renderCollisionChecks++;
    return {visual,depth:6-visual.distance};
  };
  if(face.bays) {
    const pitch=(length-2*face.margin)/face.bays;
    const center=face.margin+pitch/2,width=pitch-.42;
    const glazing=hit(center-width/2+.22,2.4);
    assert.equal(glazing.visual.object.material,materials.glass);
    assert(glazing.depth<-.20,'angled glazing recedes into the bay');
    const infill=hit(center+.35,2.4);
    assert.equal(infill.visual.object.material,materials.fluted);
    assert(infill.depth<-.35,'angled infill has real depth');
    assert(hit(face.margin,2.4).depth>.15,'concrete pier projects beyond the infill');
    const head=hit(center,4.45);
    assert(head.depth>-.3,'sloped concrete head projects above each opening');
  } else {
    assert(hit(length/2,10).depth>.15,'blank wall is a solid exterior surface');
    for(const f of [.1,.3,.55,.8,.95]) {
      const origin=at(length*f,4,1.3);
      ray.set(origin,new THREE.Vector3(0,-1,0));
      const visual=ray.intersectObject(group,true)[0];
      const physical=physics.castRay(new RAPIER.Ray(origin,{x:0,y:-1,z:0}),12,true);
      assert(visual&&physical&&visual.face.normal.y>.95,'blank-wall ground apron faces upward');
      assert(Math.abs(visual.point.y-(4-physical.timeOfImpact))<.002,'apron collision matches');
      if(face.name==='east blank wall')assert(visual.point.y>-3.4&&visual.point.y<-1.5,'east apron follows measured ground range');
      else assert(visual.point.y>-.02&&visual.point.y<.4,'north apron follows the raised terrace');
      renderCollisionChecks++;
    }
  }
  const fragment=new THREE.PlaneGeometry(1,1);
  fragment.applyMatrix4(new THREE.Matrix4().makeBasis(u,new THREE.Vector3(0,1,0),out));
  fragment.translate(...at(length/2,8,4).toArray());
  const cleared=subtractVolumes(fragment,new THREE.Matrix4(),asset.volumes);
  assert(cleared&&cleared.attributes.position.count===0,'floating source fragment is removed');
  const lowGround=new THREE.PlaneGeometry(.5,.5).rotateX(-Math.PI/2);
  lowGround.translate(...at(length/2,face.name==='southeast'?-3.3:-.5,4).toArray());
  const retained=subtractVolumes(lowGround,new THREE.Matrix4(),asset.volumes);
  assert.equal(retained,null,'wider upper clearance preserves low outer ground');
  fragment.dispose(); cleared.dispose(); lowGround.dispose();
}
// A roof sample well inside the building must remain outside the skin repair.
const roof=new THREE.PlaneGeometry(3,3).rotateX(-Math.PI/2).translate(-110,23.06,350);
assert.equal(subtractVolumes(roof,new THREE.Matrix4(),asset.volumes),null);
const report={faces:asset.faces,windowBays:asset.bayCount,drawBatches:asset.meshes.length,
  triangles:asset.meshes.reduce((n,m)=>n+m.geometry.attributes.position.count/3,0),
  renderCollisionChecks,interiorRoofPreserved:true,syntheticUpperFixtureCleared:true,outerGroundPreserved:true,
  limits:'Synthetic geometry checks only. Dimensions and bay counts are approximate. The browser still shows residual source fragments; this report is not visual acceptance.'};
const prefix=process.argv[2]??'current';
assert(/^[a-z0-9-]+$/.test(prefix),'safe evidence prefix');
writeFileSync(new URL(`../evidence/${prefix}-pcl-facade-check.json`,import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log('PASS:',report);
physics.free(); roof.dispose();
for(const mesh of asset.meshes) mesh.geometry.dispose();
for(const m of [...Object.values(materials),ground])m.dispose();
