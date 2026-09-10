import assert from 'node:assert/strict';
import * as T from 'three';

// Replace the overlapping shorts/calf surfaces with continuous trouser legs.
// Cut through the original thighs, then extend those exact boundary edges to
// the ankles. Keeping the cut vertices joins the garment without a knee seam.
export function tailorTrousers(g, skeleton) {
  const cut = 70;
  const source = g.attributes;
  const values = Object.fromEntries(
    Object.entries(source).map(([name, a]) => [name, Array.from(a.array)]),
  );
  const intersections = new Map(),
    boundary = [],
    indices = [],
    groups = [];
  const position = (i) => new T.Vector3().fromArray(values.position, i * 3);
  function skin(weights) {
    const influences = [...weights]
      .filter(([, w]) => w > 1e-8)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4);
    const sum = influences.reduce((v, [, w]) => v + w, 0);
    while (influences.length < 4) influences.push([0, 0]);
    return [influences.map(([b]) => b), influences.map(([, w]) => w / sum)];
  }
  function intersection(a, b) {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (intersections.has(key)) return intersections.get(key);
    const t = (cut - position(a).z) / (position(b).z - position(a).z);
    const i = values.position.length / 3;
    for (const [name, attribute] of Object.entries(source))
      for (let k = 0; k < attribute.itemSize; k++)
        values[name].push(
          T.MathUtils.lerp(
            attribute.getComponent(a, k),
            attribute.getComponent(b, k),
            t,
          ),
        );
    const weights = new Map();
    for (const [v, blend] of [
      [a, 1 - t],
      [b, t],
    ])
      for (let k = 0; k < 4; k++) {
        const bone = source.skinIndex.getComponent(v, k);
        weights.set(
          bone,
          (weights.get(bone) ?? 0) +
            source.skinWeight.getComponent(v, k) * blend,
        );
      }
    const [bones, influences] = skin(weights);
    values.skinIndex.splice(i * 4, 4, ...bones);
    values.skinWeight.splice(i * 4, 4, ...influences);
    values.position[i * 3 + 2] = cut;
    intersections.set(key, i);
    return i;
  }
  const isTrouser = (i) => {
    const u = source.uv.getX(i),
      v = source.uv.getY(i);
    return (u < 0.31 || u > 0.7) && v > 0.55;
  };
  for (const group of g.groups) {
    const start = indices.length;
    for (let n = group.start; n < group.start + group.count; n += 3) {
      const tri = [0, 1, 2].map((k) => g.index.getX(n + k));
      if (group.materialIndex !== 0 || !tri.every(isTrouser)) {
        indices.push(...tri);
        continue;
      }
      const clipped = [];
      for (let k = 0; k < 3; k++) {
        const a = tri[k],
          b = tri[(k + 1) % 3];
        const insideA = position(a).z >= cut,
          insideB = position(b).z >= cut;
        if (insideA) clipped.push(a);
        if (insideA !== insideB) clipped.push(intersection(a, b));
      }
      for (let k = 1; k < clipped.length - 1; k++)
        indices.push(clipped[0], clipped[k], clipped[k + 1]);
      for (let k = 0; k < clipped.length; k++) {
        const a = clipped[k],
          b = clipped[(k + 1) % clipped.length];
        if (position(a).z === cut && position(b).z === cut)
          boundary.push([a, b]);
      }
    }
    groups.push({
      start,
      count: indices.length - start,
      materialIndex: group.materialIndex,
    });
  }
  // Validate the actual cut instead of silently generating a leg from a broken
  // or ambiguous contour when the source model changes.
  const keyFor = (i) =>
    position(i)
      .toArray()
      .map((v) => Math.round(v * 1e3))
      .join(',');
  const adjacency = new Map();
  for (const [a, b] of boundary) {
    const ka = keyFor(a),
      kb = keyFor(b);
    for (const [v, other] of [
      [ka, kb],
      [kb, ka],
    ]) {
      if (!adjacency.has(v)) adjacency.set(v, new Set());
      adjacency.get(v).add(other);
    }
  }
  for (const neighbors of adjacency.values())
    assert.equal(
      neighbors.size,
      2,
      'Each trouser cut must be a closed contour',
    );
  const visited = new Set();
  let loops = 0;
  for (const first of adjacency.keys()) {
    if (visited.has(first)) continue;
    loops++;
    const queue = [first];
    while (queue.length) {
      const v = queue.pop();
      if (visited.has(v)) continue;
      visited.add(v);
      queue.push(...adjacency.get(v));
    }
  }
  assert.equal(loops, 2, 'Expected one continuous cut around each thigh');
  const topVertices = [...new Set(boundary.flat())];
  const centers = new Map();
  for (const sign of [-1, 1]) {
    const box = new T.Box3();
    for (const i of topVertices)
      if (Math.sign(position(i).x) === sign) box.expandByPoint(position(i));
    centers.set(sign, box.getCenter(new T.Vector3()));
  }
  // Height, horizontal radius, depth radius in bind-pose centimeters.
  const rings = [
    [64, 8.9, 10.1],
    [57, 8.7, 9.4],
    [50, 8.5, 8.9],
    [44, 8.25, 8.5],
    [37, 8.05, 8.3],
    [29, 7.85, 8.1],
    [21, 7.6, 7.9],
    [14, 7.35, 7.7],
    [10, 7.25, 7.6],
    [9.4, 7.25, 7.6],
  ];
  const extended = new Map();
  for (const top of topVertices) {
    const p = position(top),
      sign = Math.sign(p.x),
      center = centers.get(sign);
    const delta = p.clone().sub(center),
      theta = Math.atan2(delta.y, delta.x);
    const side = sign < 0 ? 'R' : 'L';
    const bones = ['Thigh', 'Calf', 'Foot'].map((part) =>
      skeleton.bones.findIndex((b) => b.name === `Bip01_${side}_${part}`),
    );
    assert.ok(
      bones.every((i) => i >= 0),
      'The original leg rig is required',
    );
    const column = [top];
    for (const [height, rx, ry] of rings) {
      const blend = 1 - T.MathUtils.smoothstep(height, 50, cut);
      const centerX = T.MathUtils.lerp(
        center.x,
        sign * (10.9 + 1.2 * (1 - T.MathUtils.smoothstep(height, 10, 45))),
        blend,
      );
      const centerY = T.MathUtils.lerp(center.y, 1, blend);
      const x =
        centerX + T.MathUtils.lerp(delta.x, Math.cos(theta) * rx, blend);
      const y =
        centerY + T.MathUtils.lerp(delta.y, Math.sin(theta) * ry, blend);
      const i = values.position.length / 3;
      for (const [name, attribute] of Object.entries(source))
        for (let k = 0; k < attribute.itemSize; k++)
          values[name].push(values[name][top * attribute.itemSize + k]);
      values.position.splice(i * 3, 3, x, y, height);
      values.uv[i * 2 + 1] = T.MathUtils.lerp(
        values.uv[top * 2 + 1],
        0.995,
        (cut - height) / (cut - 9.4),
      );
      const thigh = T.MathUtils.smoothstep(height, 40, 63);
      const foot = 0.3 * (1 - T.MathUtils.smoothstep(height, 9, 18));
      values.skinIndex.splice(i * 4, 4, ...bones, 0);
      values.skinWeight.splice(i * 4, 4, thigh, 1 - thigh - foot, foot, 0);
      column.push(i);
    }
    extended.set(top, column);
  }
  const start = indices.length;
  for (const [a, b] of boundary) {
    const ac = extended.get(a),
      bc = extended.get(b);
    for (let k = 0; k < rings.length; k++)
      indices.push(bc[k], ac[k], ac[k + 1], bc[k], ac[k + 1], bc[k + 1]);
  }
  groups.push({ start, count: indices.length - start, materialIndex: 0 });
  for (const [name, attribute] of Object.entries(source)) {
    const ArrayType = attribute.array.constructor;
    g.setAttribute(
      name,
      new T.BufferAttribute(
        new ArrayType(values[name]),
        attribute.itemSize,
        attribute.normalized,
      ),
    );
  }
  g.setIndex(indices);
  g.clearGroups();
  for (const group of groups)
    if (group.count) g.addGroup(group.start, group.count, group.materialIndex);
  g.userData.trousers = {
    cutLoops: loops,
    boundaryEdges: boundary.length,
    rings: rings.length,
  };
}
