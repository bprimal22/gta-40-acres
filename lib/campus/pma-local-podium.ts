import * as T from 'three';

type Emit = (geometry: T.BufferGeometry, material: T.Material, solid?: boolean) => void;
type Opening = { left: number; right: number; low: number; high: number; kind: 'window' | 'door' };
type Point = readonly [number, number];
export const pmaPodiumPlan = {
  foundation: -1,
  formerFoundation: 3,
  top: 10.5,
  thickness: .76,
  glazingRecess: .52,
  parapetRise: .42,
  // Directly visible low clerestory/frontage evidence: L051-h180. The west
  // base and its tall entrance piers are corroborated by L047-h180/Gilpin.
  references: ['L051-h180', 'L047-h180', 'L046-h000', 'pma-gilpinlab-speedway', 'pma-2025-utnews'],
  exactSurvey: false,
} as const;

/** Replace only the former blank podium extrusion. This remains a closed
 * exterior building: shallow recessed glazing does not promise an interior.
 * Foundation extends inside the existing mapped ring to meet the local terrain,
 * whose north/east perimeter falls below the former Y3 underside.
 * All geometries/materials are handed to the caller's established batch owner.
 */
export function buildPmaLocalPodium(
  add: Emit,
  footprint: readonly Point[],
  materials: { stone: T.MeshStandardMaterial; glass: T.MeshStandardMaterial; metal: T.MeshStandardMaterial },
) {
  const p = pmaPodiumPlan;
  if (footprint.length !== 26) throw new Error('PMA podium expects the recorded 26-point engineering footprint');
  const signedArea = footprint.reduce((sum, a, i) => {
    const b = footprint[(i + 1) % footprint.length]; return sum + a[0] * b[1] - b[0] * a[1];
  }, 0) / 2;
  if (signedArea >= 0) throw new Error('PMA footprint winding changed');
  const stats = { triangles: 0, colliderTriangles: 0, windows: 0, doors: 0, parapets: 0,
    foundation: p.foundation, formerFoundation: p.formerFoundation, top: p.top,
    footprintAreaM2: -signedArea, foundationExtensionMeters: p.formerFoundation - p.foundation,
    southSupportAreaM2: 0, newMaterials: 0, materialBatches: 3, exactSurvey: false };
  const witnesses: { label: string; point: number[]; out: number[]; expectedDepth: number }[] = [];
  const emit = (g: T.BufferGeometry, m: T.Material) => {
    const n = (g.index?.count ?? g.attributes.position.count) / 3;
    stats.triangles += n; stats.colliderTriangles += n; add(g, m, true);
  };
  const slab = (ring: readonly Point[], low: number, high: number, m: T.Material) => {
    const shape = new T.Shape(ring.map(([s, t]) => new T.Vector2(s, -t)));
    emit(new T.ExtrudeGeometry(shape, { depth: high - low, bevelEnabled: false, steps: 1 })
      .rotateX(-Math.PI / 2).translate(0, low, 0), m);
  };
  // Exact mapped bottom and roof caps. The body is hollow but enclosed by
  // physical walls/glazing; no invisible filled box erases the new recesses.
  slab(footprint, p.foundation, p.foundation + .28, materials.stone);
  slab(footprint, p.top - .25, p.top, materials.metal);

  function facade(a: Point, b: Point, openings: Opening[], label: string, parapet: boolean) {
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const along = new T.Vector3((b[0] - a[0]) / length, 0, (b[1] - a[1]) / length);
    // The recorded ring is clockwise in XZ. Along/up/out therefore has positive
    // determinant and ordinary BoxGeometry triangle winding stays correct.
    const out = new T.Vector3(-along.z, 0, along.x);
    const matrix = new T.Matrix4().makeBasis(along, new T.Vector3(0, 1, 0), out).setPosition(a[0], 0, a[1]);
    const box = (u: number, y: number, depth: number, width: number, height: number, thick: number, m: T.Material) =>
      emit(new T.BoxGeometry(width, height, thick).translate(u, y, depth).applyMatrix4(matrix), m);
    const bands = [...new Set([p.foundation, p.top, ...openings.flatMap(o => [o.low, o.high])])].sort((x, y) => x - y);
    for (let j = 0; j < bands.length - 1; j++) {
      const low = bands[j], high = bands[j + 1], mid = (low + high) / 2;
      let left = 0;
      for (const o of openings.filter(o => mid > o.low && mid < o.high).sort((x, y) => x.left - y.left)) {
        if (o.left > left) box((left + o.left) / 2, mid, -p.thickness / 2, o.left - left, high - low, p.thickness, materials.stone);
        left = o.right;
      }
      if (left < length) box((left + length) / 2, mid, -p.thickness / 2, length - left, high - low, p.thickness, materials.stone);
    }
    for (const o of openings) {
      const width = o.right - o.left, height = o.high - o.low, center = (o.left + o.right) / 2, y = (o.low + o.high) / 2;
      // Full-depth masonry returns create genuine shadowed openings. The glass
      // closes their rear surface, so a map click cannot enter a phantom room.
      for (const u of [o.left + .055, o.right - .055]) box(u, y, -p.glazingRecess / 2, .11, height, p.glazingRecess, materials.stone);
      for (const yy of [o.low + .055, o.high - .055]) box(center, yy, -p.glazingRecess / 2, width, .11, p.glazingRecess, materials.stone);
      box(center, y, -p.glazingRecess - .025, width - .16, height - .16, .05, materials.glass);
      for (const u of [o.left + .1, o.right - .1]) box(u, y, -p.glazingRecess + .035, .055, height - .1, .07, materials.metal);
      for (const yy of [o.low + .1, o.high - .1]) box(center, yy, -p.glazingRecess + .035, width - .1, .055, .07, materials.metal);
      const panes = o.kind === 'door' ? 2 : width > 2.4 ? 3 : 2;
      for (let k = 1; k < panes; k++) box(o.left + width * k / panes, y, -p.glazingRecess + .04, .055, height - .1, .08, materials.metal);
      if (o.kind === 'door') {
        stats.doors++;
        box(center, o.high - .58, -p.glazingRecess + .04, width - .1, .06, .08, materials.metal);
        for (const u of [center - .14, center + .14]) box(u, o.low + 1.08, -p.glazingRecess + .12, .035, .38, .07, materials.metal);
      } else stats.windows++;
      const point = new T.Vector3(center + width * .13, y + .12, 0).applyMatrix4(matrix);
      witnesses.push({ label: label + '/' + o.kind, point: point.toArray(), out: out.toArray(), expectedDepth: p.glazingRecess });
    }
    // Continuous small roof datum; parapets rise only along exposed low wings,
    // never through the already accepted tall-tower glazing or lower haunches.
    if (parapet) {
      box(length / 2, p.top + p.parapetRise / 2, -.15, length, p.parapetRise, .30, materials.stone);
      box(length / 2, p.top + p.parapetRise + .035, -.15, length, .07, .36, materials.metal);
      stats.parapets++;
    }
    const point = new T.Vector3(Math.min(.32, length / 3), (p.foundation + 3) / 2, 0).applyMatrix4(matrix);
    witnesses.push({ label: label + '/foundation', point: point.toArray(), out: out.toArray(), expectedDepth: 0 });
  }
  const row = (length: number, count: number, width: number, low = 7.35, high = 9.62): Opening[] => {
    const margin = Math.max(.7, (length - count * width) / (count + 1));
    const pitch = (length - 2 * margin) / count;
    return Array.from({ length: count }, (_, i) => ({ left: margin + pitch * (i + .5) - width / 2,
      right: margin + pitch * (i + .5) + width / 2, low, high, kind: 'window' }));
  };
  const exposed = new Set([2, 3, 4, 5, 6, 7, 8, 16, 17, 18, 19, 20, 21, 22]);
  for (let i = 0; i < footprint.length; i++) {
    const a = footprint[i], b = footprint[(i + 1) % footprint.length], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let openings: Opening[] = [];
    // The low inset north connector's tall, closely spaced clerestories are
    // directly seen in L051-h180. Counts/depth are proportional estimates.
    if (i === 3) openings = row(length, 8, 1.45, 7.0, 9.62);
    else if (i === 2 || i === 4 || i === 5) openings = row(length, i === 2 ? 2 : 1, 1.5);
    // Dean-facing eastern body: a restrained, grouped clerestory datum. These
    // bays are inferred from the visible low connector, not copied floor grids.
    else if (i === 25) openings = row(length, 12, 2.45, 7.35, 9.62);
    else if (i === 0) openings = row(length, 5, 2.1, 7.35, 9.62);
    // Western entry/base under the photographed tall piers. Closed door fields
    // are shallow exterior detail and keep the original closed building limit.
    else if (i === 9) openings = row(length, 4, 3.6, 6.38, 9.92).map(o => ({ ...o, kind: 'door' }));
    else if (i === 10 || i === 14) openings = row(length, 2, 2.0, 7.05, 9.45);
    // The mapped low southern finger is largely hidden by trees in L046-h000;
    // a few recessed clerestories and one entrance are explicit simplifications.
    else if (i === 16) openings = row(length, 5, 2.1, 7.45, 9.5);
    else if (i === 17) openings = [{ left: length / 2 - 1.4, right: length / 2 + 1.4, low: 6.38, high: 9.4, kind: 'door' }];
    else if (i === 20) openings = row(length, 2, 2.1, 7.45, 9.5);
    facade(a, b, openings, 'mapped-edge-' + i, exposed.has(i));
  }
  // The accepted south tower face was moved to t=-56.9 against its visible
  // exterior, leaving a1.2–1.6m overhang beyond the old podium. Enclose exactly
  // beneath that accepted tower, without extending any farther into the court.
  const a = footprint[15], b = footprint[16], s0 = 9.9, s1 = 45.9, front = -56.9;
  const rear = (s: number) => a[1] + (b[1] - a[1]) * (s - a[0]) / (b[0] - a[0]);
  const strip: Point[] = [[s0, rear(s0)], [s0, front], [s1, front], [s1, rear(s1)]];
  stats.southSupportAreaM2 = (s1 - s0) * (front - (rear(s0) + rear(s1)) / 2);
  slab(strip, p.foundation, p.foundation + .28, materials.stone);
  slab(strip, p.top - .25, p.top, materials.metal);
  // The rear is buried against the existing closed wall, keeping this support
  // a closed body even if the engine changes culling or viewpoint later.
  for (let i = 0; i < strip.length; i++) {
    const aa = strip[i], bb = strip[(i + 1) % strip.length], length = Math.hypot(bb[0] - aa[0], bb[1] - aa[1]);
    const openings = i === 1 ? row(length, 4, 3.6, 6.5, 9.92).map(o => ({ ...o, kind: 'door' as const })) : [];
    facade(aa, bb, openings, 'south-support-' + i, false);
  }
  return { stats, witnesses, plan: p, footprint, southSupport: strip };
}
