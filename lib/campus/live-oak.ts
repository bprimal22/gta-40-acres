import * as T from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type OakDimensions = { seed: number; height: number; diameter: number; crownRadius: number };
type Limb = { curve: T.CatmullRomCurve3; radius: number; tip: number };
export type OakCollisionSegment = { a: T.Vector3; b: T.Vector3; radius: number };

// An authored Southern live-oak form. Inventory height and DBH constrain scale;
// crown spread and the low, spreading scaffold are reference-informed estimates.
// Shared leaf geometry is instanced, so each LOD needs only two draw calls.
export function buildLiveOak(spec: OakDimensions, bark: T.Material, foliage: T.Material) {
  let state = spec.seed >>> 0;
  const random = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
  const jitter = (scale: number) => (random() - .5) * scale;
  const { height: h, crownRadius: spread, diameter } = spec;
  const limbs: Limb[] = [], clusters: { center: T.Vector3; size: T.Vector3 }[] = [];
  const curve = (points: T.Vector3[], radius: number, tip: number) => {
    const limb = { curve: new T.CatmullRomCurve3(points, false, 'centripetal'), radius, tip };
    limbs.push(limb); return limb;
  };
  const trunkTop = new T.Vector3(jitter(.45), h * .25, jitter(.45));
  curve([new T.Vector3(0, -.06, 0), new T.Vector3(.04, 1.37, -.03), trunkTop], diameter * .69, diameter * .35);
  for (let i = 0; i < 4; i++) {
    const angle = i * Math.PI / 2 + jitter(.8), reach = spread * (.66 + random() * .25);
    const direction = new T.Vector3(Math.cos(angle), 0, Math.sin(angle));
    const start = trunkTop.clone().add(new T.Vector3(jitter(.18), jitter(h * .09), jitter(.18)));
    const end = direction.clone().multiplyScalar(reach).setY(h * (.45 + random() * .22));
    const arm = curve([start, direction.clone().multiplyScalar(reach * .28).setY(start.y + h * .015),
      direction.clone().multiplyScalar(reach * .67).setY(h * (.29 + random() * .1)), end], diameter * (.30 + random() * .10), diameter * .06);
    clusters.push({center: arm.curve.getPoint(.80).add(new T.Vector3(0, h * .10, 0)),
      size: new T.Vector3(spread * .24, h * .12, spread * .24)});
    for (let j = 0; j < 3; j++) {
      const t = .45 + j * .22, joint = arm.curve.getPoint(t);
      const sideAngle = angle + (j % 2 ? -.6 : .6) + jitter(.55);
      const radius = spread * (.60 + random() * .36);
      const tip = new T.Vector3(Math.cos(sideAngle) * radius,
        h * (.89 - .34 * (radius / spread) ** 2 + jitter(.12)), Math.sin(sideAngle) * radius);
      const bend = joint.clone().lerp(tip, .53).add(new T.Vector3(jitter(.3), -.20, jitter(.3)));
      curve([joint, bend, tip], diameter * (.07 + random() * .025), diameter * .012);
      for (let k = 0; k < 2; k++) {
        const terminal = tip.clone().add(new T.Vector3(jitter(spread * .30), jitter(h * .10), jitter(spread * .30)));
        curve([bend.clone().lerp(tip, .65), tip, terminal], diameter * .016, .004);
        clusters.push({ center: terminal, size: new T.Vector3(spread * (.16 + random() * .08), h * (.095 + random() * .035), spread * (.16 + random() * .08)) });
      }
    }
  }
  // Interior upper shoots keep the crown from becoming a hollow ring.
  for (let i = 0; i < 5; i++) {
    const angle = random() * Math.PI * 2, end = new T.Vector3(Math.cos(angle) * spread * .32, h * (.84 + random() * .075), Math.sin(angle) * spread * .32);
    curve([trunkTop, trunkTop.clone().lerp(end, .6).add(new T.Vector3(jitter(.5), 0, jitter(.5))), end], diameter * .13, diameter * .016);
    clusters.push({ center: end, size: new T.Vector3(spread * .25, h * .12, spread * .25) });
  }

  function limbGeometry(limb: Limb, steps: number, sides: number, trunk: boolean) {
    const positions: number[] = [], uv: number[] = [], indices: number[] = [];
    const frames = limb.curve.computeFrenetFrames(steps, false), length = limb.curve.getLength();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps, center = limb.curve.getPointAt(t);
      // Anchor the main trunk near inventory DBH height, with a wider root flare.
      const radius = trunk && center.y <= 1.37
        ? T.MathUtils.lerp(diameter * .69, diameter / 2, T.MathUtils.clamp(center.y / 1.37, 0, 1))
        : trunk ? T.MathUtils.lerp(diameter / 2, limb.tip, T.MathUtils.clamp((center.y - 1.37) / (trunkTop.y - 1.37), 0, 1))
          : T.MathUtils.lerp(limb.radius, limb.tip, Math.pow(t, .8));
      for (let j = 0; j <= sides; j++) {
        const a = j / sides * Math.PI * 2, ripple = 1 + .025 * Math.sin(a * 5 + t * 13);
        const point = center.clone().addScaledVector(frames.normals[i], Math.cos(a) * radius * ripple)
          .addScaledVector(frames.binormals[i], Math.sin(a) * radius * ripple);
        positions.push(...point.toArray()); uv.push(j / sides * Math.PI * 2 * limb.radius, t * length);
        if (i < steps && j < sides) { const v = i * (sides + 1) + j; indices.push(v, v + 1, v + sides + 1, v + 1, v + sides + 2, v + sides + 1); }
      }
    }
    const g = new T.BufferGeometry();g.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));g.setIndex(indices);g.computeVertexNormals();return g;
  }
  const leaf = new T.BufferGeometry();
  // Folded, tapered leaf with a raised midrib. Its silhouette is geometry, so
  // depth and shadow passes don't render rectangular alpha-card outlines.
  leaf.setAttribute('position', new T.Float32BufferAttribute([0, 0, -.5, -.31, 0, -.13, 0, .055, -.13, .31, 0, -.13,
    -.25, 0, .25, 0, .04, .25, .25, 0, .25, 0, 0, .5], 3));
  leaf.setAttribute('uv', new T.Float32BufferAttribute([.5, 0, 0, .35, .5, .35, 1, .35, .1, .75, .5, .75, .9, .75, .5, 1], 2));
  leaf.setIndex([0, 1, 2, 0, 2, 3, 1, 4, 5, 1, 5, 2, 2, 5, 6, 2, 6, 3, 4, 7, 5, 5, 7, 6]);leaf.computeVertexNormals();
  const geometries: T.BufferGeometry[] = [leaf], instances: T.InstancedMesh[] = [];
  const lod = new T.LOD();lod.name = `Inventory live oak ${spec.seed}`;
  const collision: OakCollisionSegment[] = [];
  for (const [index, limb] of limbs.entries()) if (index === 0 || limb.radius > diameter * .15) {
    for (let i = 0; i < 12; i++) {
      const a = limb.curve.getPointAt(i / 12), b = limb.curve.getPointAt((i + 1) / 12);
      if (Math.min(a.y, b.y) > 3.0) continue;
      collision.push({ a, b, radius: index === 0 ? diameter * .52 : T.MathUtils.lerp(limb.radius, limb.tip, i / 12) });
    }
  }
  for (const [level, count, leafScale, steps, sides] of [[0, 48000, 1, 18, 10], [1, 12000, 1.75, 12, 7], [2, 3000, 3, 7, 5]]) {
    const group = new T.Group(), parts = limbs.map((limb, i) => limbGeometry(limb, steps, sides, i === 0));
    const woodGeometry = mergeGeometries(parts)!;parts.forEach(g => g.dispose());geometries.push(woodGeometry);
    const wood = new T.Mesh(woodGeometry, bark);wood.castShadow = wood.receiveShadow = true;wood.name = 'Live-oak wood';group.add(wood);
    const leaves = new T.InstancedMesh(leaf, foliage, count);leaves.name = 'Live-oak leaves';leaves.castShadow = leaves.receiveShadow = true;
    const matrix = new T.Matrix4(), quaternion = new T.Quaternion(), color = new T.Color();
    state = spec.seed >>> 0;
    for (let i = 0; i < count; i++) {
      const cluster = clusters[i % clusters.length], direction = new T.Vector3(jitter(2), jitter(2), jitter(2)).normalize();
      const position = direction.multiplyScalar(Math.cbrt(random())).multiply(cluster.size).add(cluster.center);
      quaternion.setFromEuler(new T.Euler(jitter(1.4), random() * Math.PI * 2, jitter(1.4)));
      const length = (.078 + random() * .045) * leafScale;
      matrix.compose(position, quaternion, new T.Vector3(length * (.72 + random() * .2), length, length));leaves.setMatrixAt(i, matrix);
      color.setRGB(.64 + random() * .25, .72 + random() * .24, .58 + random() * .22);leaves.setColorAt(i, color);
    }
    leaves.computeBoundingSphere();group.add(leaves);instances.push(leaves);lod.addLevel(group, [0, 28, 75][level], .15);
  }
  return { lod, geometries, instances, collision, limbs: limbs.length, clusters: clusters.length };
}
