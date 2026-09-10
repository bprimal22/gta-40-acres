import * as T from 'three';

// Fit strap cross-section centers to the jacket, then transfer barycentric
// skeletal weights from that same surface. Strap ends remain attached to the
// rigid bag's spine bone; the chest and shoulders follow the deforming torso.
export function skinBackpackStraps(pack, body) {
  const straps = pack.children.filter((o) => o.userData.strapRings);
  body.updateWorldMatrix(true, false);
  pack.updateWorldMatrix(true, true);
  const source = body.geometry, p = source.attributes.position;
  const triangles = [];
  for (const group of source.groups) {
    if (group.materialIndex !== 0) continue;
    for (let n = group.start; n < group.start + group.count; n += 3) {
      const ids = [0, 1, 2].map((k) => source.index.getX(n + k));
      const points = ids.map((i) => new T.Vector3().fromBufferAttribute(p, i));
      if (points.some((q) => q.z < 106 || q.z > 154 || Math.abs(q.x) > 24)) continue;
      const tri = new T.Triangle(...points);
      if (tri.getArea() > 1e-9) triangles.push({ ids, tri });
    }
  }
  const spine = body.skeleton.bones.findIndex((b) => b.name === 'Bip01_Spine2');
  if (spine < 0 || !triangles.length) throw new Error('Strap fitting requires the torso and spine');
  for (const strap of straps) {
    const g = strap.geometry;
    g.applyMatrix4(body.matrixWorld.clone().invert().multiply(strap.matrixWorld));
    const positions = g.attributes.position;
    const indices = new Uint16Array(positions.count * 4);
    const weights = new Float32Array(positions.count * 4);
    const { strapRings: rings, strapAround: around } = strap.userData;
    for (let row = 0; row < rings; row++) {
      const center = new T.Vector3();
      for (let k = 0; k < around - 1; k++)
        center.add(new T.Vector3().fromBufferAttribute(positions, row * around + k));
      center.divideScalar(around - 1);
      let nearest, nearestPoint, distance = Infinity;
      for (const candidate of triangles) {
        const point = candidate.tri.closestPointToPoint(center, new T.Vector3());
        const d = point.distanceToSquared(center);
        if (d < distance) { distance = d; nearest = candidate; nearestPoint = point; }
      }
      const t = row / (rings - 1);
      const fit = T.MathUtils.smoothstep(t, 0.10, 0.25) *
        (1 - T.MathUtils.smoothstep(t, 0.75, 0.91));
      const normal = nearest.tri.getNormal(new T.Vector3());
      if (normal.dot(new T.Vector3(nearestPoint.x, nearestPoint.y, 0)) < 0) normal.negate();
      const shift = nearestPoint.clone().addScaledVector(normal, 0.78).sub(center).multiplyScalar(fit);
      const bary = nearest.tri.getBarycoord(nearestPoint, new T.Vector3());
      const influence = new Map([[spine, 1 - fit]]);
      for (let j = 0; j < 3; j++)
        for (let k = 0; k < 4; k++) {
          const i = nearest.ids[j], bone = source.attributes.skinIndex.getComponent(i, k);
          const w = source.attributes.skinWeight.getComponent(i, k) * bary.getComponent(j) * fit;
          influence.set(bone, (influence.get(bone) ?? 0) + w);
        }
      const sorted = [...influence].filter(([, w]) => w > 1e-8).sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = sorted.reduce((s, [, w]) => s + w, 0);
      for (let k = 0; k < around; k++) {
        const i = row * around + k;
        positions.setXYZ(i, positions.getX(i) + shift.x, positions.getY(i) + shift.y, positions.getZ(i) + shift.z);
        for (let j = 0; j < sorted.length; j++) {
          indices[i * 4 + j] = sorted[j][0];
          weights[i * 4 + j] = sorted[j][1] / sum;
        }
      }
    }
    g.setAttribute('skinIndex', new T.Uint16BufferAttribute(indices, 4));
    g.setAttribute('skinWeight', new T.Float32BufferAttribute(weights, 4));
    g.computeVertexNormals();
    g.computeBoundingBox();
    g.computeBoundingSphere();
    const skinned = new T.SkinnedMesh(g, strap.material);
    skinned.name = strap.name;
    skinned.userData = { ...strap.userData, fittedTo: 'Jacket surface with blended spine attachment' };
    skinned.position.copy(body.position);
    skinned.quaternion.copy(body.quaternion);
    skinned.scale.copy(body.scale);
    skinned.bind(body.skeleton, body.bindMatrix);
    skinned.castShadow = true;
    skinned.receiveShadow = true;
    body.parent.add(skinned);
    strap.removeFromParent();
  }
}
