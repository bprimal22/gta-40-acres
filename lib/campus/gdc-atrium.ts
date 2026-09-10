import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { CutVolume } from './clip-volume';
import { annotateGdcGlazing, createGdcGlazing } from './gdc-glazing';

/** Fixed campus registration: local u points into campus, v toward south. */
export const gdcAtriumFrame = {
  origin: [21.8, 0, -19.1] as const,
  east: [.996164, 0, .087504] as const,
  south: [-.087504, 0, .996164] as const,
};
export const gdcAtriumProfile = [
  { low: 2.45, high: 6.95, front: 16.0 },
  { low: 6.95, high: 11.45, front: 14.6 },
  { low: 11.45, high: 15.95, front: 18.6 },
  { low: 15.95, high: 20.45, front: 24.3 },
  { low: 20.45, high: 25.08, front: 30.0 },
] as const;

export type GdcAtriumOptions = {
  /** Ground threshold height. Shifts the whole profile, including roof. */
  baseElevation?: number;
  /** Measured source allowance at each front (0–1.25m), never at side/back.
   * Roof allowance is capped at .12m even when front cleanup is wider. */
  clearancePadding?: number;
};

/** Photo/section-guided stepped exterior, with closed opaque glazing. All
 * vertices are in campus coordinates. Trellises and handles are decorative;
 * other collider geometries share the corresponding rendered geometry.
 * No material has a scene-reflection capture or requires a texture request.
 */
export function buildGdcAtrium(options: GdcAtriumOptions = {}) {
  const base = options.baseElevation ?? 2.45;
  const padding = options.clearancePadding ?? .12;
  if (![base, padding].every(Number.isFinite) || padding < 0 || padding > 1.25)
    throw new Error('Invalid GDC atrium datum or clearance padding');
  const shift = base - 2.45;
  const halfWidth = 7.8, back = 34.5;
  const bands = gdcAtriumProfile.map(b => ({ ...b, low: b.low + shift, high: b.high + shift }));
  const east = new THREE.Vector3(...gdcAtriumFrame.east).normalize();
  const south = new THREE.Vector3(...gdcAtriumFrame.south).normalize();
  const up = new THREE.Vector3(0, 1, 0);
  const matrix = new THREE.Matrix4().makeBasis(east, up, south);
  matrix.setPosition(...gdcAtriumFrame.origin);
  const materials = {
    glass: createGdcGlazing('GDC atrium shaded glazing with recessed room depth'),
    frame: new THREE.MeshStandardMaterial({ color: 0x8b938e, metalness: .72, roughness: .30 }),
    trellis: new THREE.MeshStandardMaterial({ color: 0x805339, metalness: .30, roughness: .57 }),
    stone: new THREE.MeshStandardMaterial({ color: 0xa79c88, roughness: .89 }),
    recess: new THREE.MeshStandardMaterial({ color: 0x414540, roughness: .92 }),
  };
  materials.frame.name = 'GDC atrium silver mullions and terrace rails';
  materials.trellis.name = 'GDC atrium open bronze-brown trellis';
  materials.stone.name = 'GDC atrium pale terrace slabs and thresholds';
  materials.recess.name = 'GDC atrium shaded closure';
  const batches = new Map<THREE.Material, THREE.BufferGeometry[]>();
  let glassPanels = 0, trellisBars = 0, railPosts = 0;
  const add = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    if (material === materials.glass) {
      geometry.computeBoundingBox();
      const center = geometry.boundingBox!.getCenter(new THREE.Vector3());
      annotateGdcGlazing(geometry, 'z', south, east.clone().negate(), center.z * 3.3 + center.y * 5.1);
    }
    const p = geometry.attributes.position, n = geometry.attributes.normal, uv = geometry.attributes.uv;
    // Retain metre UVs for future calibrated material detail, without external assets.
    for (let i = 0; i < p.count; i++) {
      const front = Math.abs(n.getX(i)) > .7, top = Math.abs(n.getY(i)) > .7;
      uv.setXY(i, front ? p.getZ(i) : p.getX(i), top ? p.getZ(i) : p.getY(i));
    }
    geometry.applyMatrix4(matrix);
    if (!batches.has(material)) batches.set(material, []);
    batches.get(material)!.push(geometry);
  };
  const box = (u: number, y: number, v: number, du: number, dy: number, dv: number,
    material: THREE.Material) => {
    if (Math.min(du, dy, dv) <= 0) throw new Error('Degenerate GDC atrium part');
    add(new THREE.BoxGeometry(du, dy, dv).translate(u, y, v), material);
  };
  const glazedField = (u: number, low: number, high: number, a: number, b: number, subdivisions: number) => {
    const width = b - a, pitch = width / subdivisions, center = (a + b) / 2;
    box(u + .035, (low + high) / 2, center, .07, high - low, width, materials.glass);
    for (let j = 0; j <= subdivisions; j++) {
      const v = a + pitch * j;
      box(u - .015, (low + high) / 2, v, .17, high - low, .055, materials.frame);
    }
    for (const y of [low + .035, high - .035])
      box(u - .025, y, center, .19, .07, width, materials.frame);
    glassPanels += subdivisions;
  };

  for (let i = 0; i < bands.length; i++) {
    const { low, high, front } = bands[i], height = high - low;
    const slabFront = front - .20, slabDepth = back - slabFront;
    // A complete floor closes the replacement. The exposed part before the
    // next recessed facade is a terrace, rather than a roof floating in space.
    box((slabFront + back) / 2, low - .10, 0, slabDepth, .20, halfWidth * 2, materials.stone);
    box(front - .09, low + .025, 0, .18, .25, halfWidth * 2, materials.frame);
    const next = bands[i + 1];
    if (next && next.front > front) {
      // Close the horizontal step outside the next inset storey. Without this
      // strip an aerial view would see an open slot between the glazed bands.
      box((front + next.front) / 2 - .2, high - .10, 0,
        next.front - front, .20, halfWidth * 2, materials.stone);
    }
    for (const side of [-1, 1])
      box((front + back) / 2, (low + high) / 2, side * (halfWidth - .065),
        back - front, height, .13, materials.recess);
    box(back - .065, (low + high) / 2, 0, .13, height, halfWidth * 2, materials.recess);

    if (i === 0) {
      // Glass wings flank a visibly recessed double-door bay. Doors are closed
      // and opaque: the builder does not invent a navigable public interior.
      const doorHalf = 1.65, face = front + .12, door = front + .91;
      glazedField(face, low + .06, high - .16, -7.69, -doorHalf, 4);
      glazedField(face, low + .06, high - .16, doorHalf, 7.69, 4);
      for (const v of [-4.67, 4.67])
        box(face, low + .04, v, .20, .08, 6.04, materials.frame);
      glazedField(door, low + .025, low + 2.7, -doorHalf + .075, doorHalf - .075, 2);
      glazedField(door, low + 2.7, high - .16, -doorHalf + .075, doorHalf - .075, 2);
      // Deep jambs and header close every reveal around the recessed doors.
      for (const side of [-1, 1])
        box((face + door) / 2, (low + high) / 2, side * doorHalf,
          door - face + .16, height, .15, materials.frame);
      box((face + door) / 2, high - .15, 0, door - face + .16, .30, 3.45, materials.frame);
      box((front - .2 + door) / 2, low - .025, 0, door - front + .2, .05, 3.45, materials.stone);
      for (const v of [-.12, .12]) {
        box(door - .14, low + 1.22, v, .045, .48, .03, materials.trellis);
        for (const y of [low + 1.01, low + 1.43])
          box(door - .07, y, v, .12, .025, .03, materials.trellis);
      }
      // Shallow head transoms distinguish ground glazing from the terrace rows.
      for (const v of [-4.67, 4.67])
        box(face - .02, low + 2.73, v, .15, .045, 6.04, materials.frame);
      continue;
    }

    const glassFront = front + .92, screenLow = low + .12, screenHigh = low + 2.56;
    glazedField(glassFront, low + .17, high - .15, -7.68, 7.68, 10);
    box(glassFront, low + .09, 0, .20, .18, 15.36, materials.frame);
    box(glassFront - .025, low + 2.76, 0, .18, .045, 15.36, materials.frame);
    // Repeated framed open rectangles reproduce the actual screening depth.
    // Grids have real holes; no facade photograph or alpha-mask sheet is used.
    const columns = 7, screenHalf = 7.63, bay = screenHalf * 2 / columns;
    for (let j = 0; j <= columns; j++) {
      const v = -screenHalf + j * bay;
      box(front + .025, (screenLow + screenHigh) / 2, v, .17, screenHigh - screenLow + .1, .065, materials.trellis);
      // Major supports carry the terrace rails as well as the grid.
      box(front + .21, low + 1.82, v, .075, 3.52, .075, materials.frame);
      railPosts++;
      for (const y of [screenLow, screenHigh])
        box(front + .47, y, v, 1.05, .055, .055, materials.trellis);
    }
    for (const y of [screenLow, screenHigh])
      box(front + .025, y, 0, .17, .07, 15.32, materials.trellis);
    const rows = 14, cells = 76;
    for (let j = 1; j < rows; j++) {
      box(front + .018, screenLow + j * (screenHigh - screenLow) / rows, 0,
        .115, .025, 15.26, materials.trellis); trellisBars++;
    }
    for (let j = 1; j < cells; j++) {
      box(front + .032, (screenLow + screenHigh) / 2, -screenHalf + j * 15.26 / cells,
        .07, screenHigh - screenLow, .023, materials.trellis); trellisBars++;
    }
    // The L-shaped trellis projects back over the sheltered terrace/glass line.
    const canopyDepth = 1.06;
    for (let j = 0; j <= cells; j++) {
      box(front + canopyDepth / 2, screenHigh + .025, -screenHalf + j * 15.26 / cells,
        canopyDepth, .075, .032, materials.trellis); trellisBars++;
    }
    for (let j = 0; j <= 5; j++) {
      box(front + j * canopyDepth / 5, screenHigh + .025, 0,
        .032, .075, 15.26, materials.trellis); trellisBars++;
    }
    for (const y of [low + 2.89, low + 3.20, low + 3.52])
      box(front + .19, y, 0, .055, .045, 15.4, materials.frame);
  }
  // Solid top cap below the measured 25.08m plateau; side/back closures meet it.
  const top = bands.at(-1)!;
  box((top.front - .2 + back) / 2, top.high - .11, 0,
    back - top.front + .2, .22, halfWidth * 2, materials.stone);
  box(top.front - .09, top.high - .06, 0, .18, .12, halfWidth * 2, materials.frame);

  const geometries: THREE.BufferGeometry[] = [], meshes: THREE.Mesh[] = [];
  for (const [material, parts] of batches) {
    const normalized = parts.map(p => p.index ? p.toNonIndexed() : p);
    const geometry = mergeGeometries(normalized);
    if (!geometry) throw new Error('Could not merge GDC atrium geometry');
    geometry.computeBoundingBox(); geometry.computeBoundingSphere(); geometries.push(geometry);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = material.name; mesh.castShadow = true; mesh.receiveShadow = true; meshes.push(mesh);
    for (const part of new Set([...parts, ...normalized])) part.dispose();
  }
  const colliderGeometries = meshes.filter(m => m.material !== materials.trellis).map(m => m.geometry);
  const bounds = new THREE.Box3();
  for (const geometry of geometries) bounds.union(geometry.boundingBox!);
  const volumeRecords = bands.map((b, i) => ({
    minU: b.front - .2 - padding, maxU: back, minV: -halfWidth, maxV: halfWidth,
    minY: b.low - .20,
    maxY: b.high + (i === bands.length - 1 ? Math.min(padding, .12) : 0),
  }));
  const volumes: CutVolume[] = volumeRecords.map(b => {
    const corners: THREE.Vector3[] = [];
    for (const u of [b.minU, b.maxU]) for (const v of [b.minV, b.maxV])
      for (const y of [b.minY, b.maxY]) corners.push(new THREE.Vector3(u, y, v).applyMatrix4(matrix));
    const point = (u: number, y: number, v: number) => new THREE.Vector3(u, y, v).applyMatrix4(matrix);
    return { bounds: new THREE.Box3().setFromPoints(corners), planes: [
      new THREE.Plane().setFromNormalAndCoplanarPoint(east.clone().negate(), point(b.minU, 0, 0)),
      new THREE.Plane().setFromNormalAndCoplanarPoint(east, point(b.maxU, 0, 0)),
      new THREE.Plane().setFromNormalAndCoplanarPoint(south.clone().negate(), point(0, 0, b.minV)),
      new THREE.Plane().setFromNormalAndCoplanarPoint(south, point(0, 0, b.maxV)),
      new THREE.Plane(up.clone().negate(), b.minY), new THREE.Plane(up.clone(), -b.maxY),
    ] };
  });
  let disposed = false;
  return { meshes, materials, geometries, colliderGeometries, volumes, bounds, bands,
    frame: gdcAtriumFrame, volumeRecords,
    stats: { bands: bands.length, glassPanels, trellisBars, railPosts, drawCalls: meshes.length,
      triangles: geometries.reduce((n, g) => n + g.attributes.position.count / 3, 0),
      colliderTriangles: colliderGeometries.reduce((n, g) => n + g.attributes.position.count / 3, 0),
      cutVolumes: volumes.length },
    dispose() {
      if (disposed) return; disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
    },
  };
}
