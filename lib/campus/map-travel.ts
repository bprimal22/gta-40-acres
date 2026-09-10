import * as THREE from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
import type { CampusData, Point } from './types';

export const WALK_SPEED = 1.65;
export const RUN_SPEED = 8;
export type MapView = { x: number; z: number; scale: number; size: number };

export function mapView(bounds: number[], position: { x: number; z: number }, expanded: boolean): MapView {
  if (!expanded) return { x: position.x, z: position.z, scale: .43, size: 220 };
  const [west, north, east, south] = bounds;
  return { x: (west + east) / 2, z: (north + south) / 2,
    scale: 820 / Math.max(east - west, south - north), size: 900 };
}

export function mapPoint(view: MapView, u: number, v: number): Point {
  return [view.x + (u - .5) * view.size / view.scale,
    view.z + (v - .5) * view.size / view.scale];
}

function inRing([x, z]: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i], b = ring[j];
    if ((a[1] > z) !== (b[1] > z) && x < (b[0] - a[0]) * (z - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function nearestOnSegment(p: Point, a: Point, b: Point): Point {
  const dx = b[0] - a[0], dz = b[1] - a[1], d = dx * dx + dz * dz;
  const t = d ? THREE.MathUtils.clamp(((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / d, 0, 1) : 0;
  return [a[0] + dx * t, a[1] + dz * t];
}

export function outdoorPoint(data: CampusData, p: Point) {
  const [west, north, east, south] = data.bounds;
  if (!p.every(Number.isFinite) || p[0] < west + 2 || p[0] > east - 2 || p[1] < north + 2 || p[1] > south - 2) return false;
  return !data.buildings.some(b => {
    if (inRing(p, b.rings[0]) && !b.rings.slice(1).some(r => inRing(p, r))) return true;
    return b.rings.some(r => r.some((a, i) => {
      const q = nearestOnSegment(p, a, r[(i + 1) % r.length]);
      return Math.hypot(q[0] - p[0], q[1] - p[1]) < .8;
    }));
  });
}

/** Prefer the clicked area, then nearby clear ground and paths; never a mapped roof. */
export function travelCandidates(data: CampusData, requested: Point): Point[] {
  if (!requested.every(Number.isFinite)) return [];
  const candidates: Point[] = [requested];
  const kinds = new Set(['footway', 'path', 'pedestrian', 'steps', 'service', 'living_street', 'residential', 'unclassified']);
  for (const path of data.paths) {
    if (!kinds.has(path.kind) || path.area) continue;
    for (let i = 1; i < path.points.length; i++) {
      const a = path.points[i - 1], b = path.points[i], p = nearestOnSegment(requested, a, b);
      if (Math.hypot(p[0] - requested[0], p[1] - requested[1]) > 120) continue;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (length < .1) continue;
      candidates.push(p);
      for (const offset of [-2, 2]) candidates.push([p[0] + (b[0] - a[0]) / length * offset, p[1] + (b[1] - a[1]) / length * offset]);
    }
  }
  candidates.sort((a, b) => Math.hypot(a[0] - requested[0], a[1] - requested[1]) - Math.hypot(b[0] - requested[0], b[1] - requested[1]));
  const result: Point[] = [];
  for (const p of candidates) {
    if (result.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.2) || !outdoorPoint(data, p)) continue;
    result.push(p);
    if (result.length === 24) break;
  }
  // A stair edge or trunk can invalidate the exact click even when usable
  // ground is less than a metre away. Mapped path centerlines alone can skip
  // that ground entirely. Reserve at most half the existing 24-candidate
  // budget for local probes, leaving the other half for path fallbacks.
  const nearby: Point[] = [];
  for (const radius of [.75, 1.5, 3]) {
    for (let direction = 0; direction < 8; direction++) {
      const angle = direction * Math.PI / 4;
      const p: Point = [requested[0] + Math.cos(angle) * radius,
        requested[1] + Math.sin(angle) * radius];
      if (!outdoorPoint(data, p) || nearby.some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < .5)) continue;
      nearby.push(p);
      if (nearby.length === 12) break;
    }
    if (nearby.length === 12) break;
  }
  return [...result.slice(0, 24 - nearby.length), ...nearby]
    .sort((a, b) => Math.hypot(a[0] - requested[0], a[1] - requested[1]) - Math.hypot(b[0] - requested[0], b[1] - requested[1]))
    .filter((p, i, points) => !points.slice(0, i).some(q => Math.hypot(p[0] - q[0], p[1] - q[1]) < .5));
}

export function travelLanding(
  world: RAPIER.World, player: RAPIER.Collider, point: Point, terrainHeight: number,
  surface: (x: number, z: number, fromY: number, distance: number) => THREE.Intersection | null,
) {
  const [x, z] = point, down = { x: 0, y: -1, z: 0 };
  const center = surface(x, z, terrainHeight + 5, 12);
  if (!center) return null;
  const height = center.point.y;
  for (const [dx, dz] of [[0, 0], [.3, 0], [-.3, 0], [0, .3], [0, -.3]]) {
    const visible = surface(x + dx, z + dz, height + 1, 2);
    const tile = visible?.object.userData.tile;
    if (!visible || (tile && tile.geometricError > 4) || Math.abs(visible.point.y - height) > .22) return null;
    const physical = world.castRay(new RAPIER.Ray({ x: x + dx, y: height + 1, z: z + dz }, down),
      2, true, undefined, undefined, player);
    if (!physical || Math.abs(height + 1 - physical.timeOfImpact - visible.point.y) > .06) return null;
  }
  const position = new THREE.Vector3(x, height + .905, z);
  if (world.intersectionWithShape(position, { x: 0, y: 0, z: 0, w: 1 },
    new RAPIER.Capsule(.54, .34), undefined, undefined, player)) return null;
  return position;
}
