// Read-only Inner Campus Circle / Union audit of current authored geometry.
// Google source tiles are not loaded; missing authored coverage is not a hole claim.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';

registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
      const url = new URL(`${specifier}.ts`, context.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (!url.endsWith('.ts')) return next(url, context);
    return { format: 'module', shortCircuit: true, source: ts.transpileModule(
      readFileSync(new URL(url), 'utf8'),
      { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } },
    ).outputText };
  },
});

const { SpeedwayWalkway } = await import('../lib/campus/walkway.ts');
const { Terrain } = await import('../lib/campus/terrain.ts');
const packet = new URL('../../research/inner-campus-union-reference-2026-09-06/', import.meta.url);
const reference = JSON.parse(readFileSync(new URL('route-reference.json', packet)));
const data = JSON.parse(readFileSync(new URL('../public/data/campus.json', import.meta.url)));
const terrain = new Terrain(JSON.parse(readFileSync(new URL('../public/data/terrain.json', import.meta.url))));
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
const descriptor = Object.getOwnPropertyDescriptor(T.TextureLoader.prototype, 'load');
assert(descriptor);
let walkway;
try {
  T.TextureLoader.prototype.load = url => { const texture = new T.Texture(); texture.name = url; return texture; };
  walkway = new SpeedwayWalkway(data, terrain, world, { capabilities: { getMaxAnisotropy: () => 8 } }, true);
} finally {
  Object.defineProperty(T.TextureLoader.prototype, 'load', descriptor);
}
walkway.surfaces.updateWorldMatrix(true, true);
world.step();
const ray = new T.Raycaster();
const down = new T.Vector3(0, -1, 0);
const sourceFiles = ['lib/campus/walkway.ts', 'lib/campus/west24.ts', 'lib/campus/west24-buildings.ts', 'lib/campus/central-malls.ts', 'public/data/campus.json', 'public/data/terrain.json', 'public/data/west24-plan.json', 'public/data/west24-buildings-plan.json', 'public/data/west-mall-plan.json', 'public/data/central-mall-plan.json'];
const sourceSha256 = () => Object.fromEntries(sourceFiles.map(path => [path,
  createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')]));
function floorAt(x, z) {
  const hint = terrain.height(x, z), origin = new T.Vector3(x, hint + 3, z);
  ray.set(origin, down); ray.far = 9;
  const hit = ray.intersectObject(walkway.surfaces, true).find(h => h.face
    && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .6);
  const physical = world.castRayAndGetNormal(new RAPIER.Ray(origin, down), 9, true);
  return { x, z, contourHeightHint: hint,
    rendered: hit ? { height: hit.point.y, mesh: hit.object.name,
      material: hit.object.material.name, texture: hit.object.material.map?.name ?? null,
      normalY: hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y } : null,
    physical: physical ? { height: origin.y - physical.timeOfImpact, normalY: physical.normal.y } : null };
}
const samples = [];
let chainage = 0;
try {
  if (process.argv.includes('--seams')) {
    const queue = JSON.parse(readFileSync(new URL('authored-seam-probes.json', packet)));
    const seams = queue.seams.map(p => ({ ...p,
      old: floorAt(...p.oldXZ), proposed: floorAt(...p.newXZ) }));
    const transition = queue.westMallTransition.samples.map(p => ({ ...p, ...floorAt(p.x, p.z) }));
    const all = [...seams.flatMap(s => [s.old, s.proposed]), ...transition];
    const comparable = all.filter(s => s.rendered && s.physical);
    const summary = {
      seamPairs: seams.length,
      oldSideAuthoredFloors: seams.filter(s => s.old.rendered).length,
      proposedSideAlreadyHasAuthoredFloor: seams.filter(s => s.proposed.rendered).length,
      transitionSamples: transition.length,
      transitionAuthoredFloors: transition.filter(s => s.rendered).length,
      transitionCenterlineSamples: transition.filter(s => s.offsetM === 0).length,
      transitionCenterlineAuthoredFloors: transition.filter(s => s.offsetM === 0 && s.rendered).length,
      comparableRenderCollisionSamples: comparable.length,
      maxRenderCollisionHeightDifferenceM: comparable.length
        ? Math.max(...comparable.map(s => Math.abs(s.rendered.height - s.physical.height))) : null,
    };
    const result = { recordedAt: new Date().toISOString(),
      scope: 'Iteration 44: current authored surfaces at proposed joins; no streamed tiles or tree models loaded.',
      summary, seams, westMallTransition: transition, sourceSha256: sourceSha256(),
      queueSha256: createHash('sha256').update(readFileSync(new URL('authored-seam-probes.json', packet))).digest('hex'),
      limits: queue.limits };
    writeFileSync(new URL('current-authored-seam-audit.json', packet), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(summary, null, 2));
  } else {
  for (const segment of reference.routeSegments) {
    const points = segment.pointsXZ;
    for (let i = 1; i < points.length; i++) {
      const a = new T.Vector2(...points[i - 1]), b = new T.Vector2(...points[i]);
      const length = a.distanceTo(b), count = Math.ceil(length / 5);
      for (let j = 0; j < count; j++) {
        const p = a.clone().lerp(b, j / count), hint = terrain.height(p.x, p.y);
        const origin = new T.Vector3(p.x, hint + 3, p.y);
        ray.set(origin, down); ray.far = 9;
        const hit = ray.intersectObject(walkway.surfaces, true).find(h => h.face
          && h.face.normal.clone().transformDirection(h.object.matrixWorld).y > .6);
        const physical = world.castRay(new RAPIER.Ray(origin, down), 9, true);
        const material = hit?.object.material;
        samples.push({ wayId: segment.osmWayId, chainage: chainage + length * j / count,
          x: p.x, z: p.y, contourHeightHint: hint,
          authored: hit ? { height: hit.point.y, mesh: hit.object.name, material: material.name,
            texture: material.map?.name ?? null,
            physicalHeight: physical ? origin.y - physical.timeOfImpact : null } : null });
      }
      chainage += length;
    }
  }
  const segments = reference.routeSegments.map(segment => {
    const rows = samples.filter(s => s.wayId === segment.osmWayId);
    return { wayId: segment.osmWayId, label: segment.label,
      runtimePathPresent: data.paths.some(p => p.id === segment.osmWayId),
      samples: rows.length, authoredFloorSamples: rows.filter(s => s.authored).length,
      contourHintRange: [Math.min(...rows.map(s => s.contourHeightHint)), Math.max(...rows.map(s => s.contourHeightHint))],
      materials: [...new Set(rows.filter(s => s.authored).map(s => s.authored.texture ?? s.authored.material))] };
  });
  const result = { recordedAt: new Date().toISOString(), scope: 'Current authored centerline floor audit; streamed tiles and tree models are not loaded.',
    routeLengthM: chainage, probeSpacingMaximumM: 5, segments, samples,
    sourceSha256: sourceSha256(),
    limitations: ['Missing authored support does not prove a hole in the game: streamed terrain may provide support.',
      'Contour height is only a planning hint; source terrain and curb elevations require browser measurements.',
      'Diagnostic raycasts are not normal-controller movement, visual acceptance, or proof of route walkability.'] };
  writeFileSync(new URL('current-authored-route-audit.json', packet), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ routeLengthM: chainage, segments }, null, 2));
  }
} finally {
  walkway.dispose(world);
  world.free();
}
