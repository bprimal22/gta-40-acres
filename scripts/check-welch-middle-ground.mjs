import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname } from 'node:path';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
registerHooks({
  resolve(s, c, next) {
    if (s.startsWith('.') && c.parentURL && !/\.[a-z]+$/i.test(s)) {
      const u = new URL(`${s}.ts`, c.parentURL);
      if (existsSync(u)) return { url: u.href, shortCircuit: true };
    }
    return next(s, c);
  },
  load(url, c, next) {
    if (!url.endsWith('.ts')) return next(url, c);
    return {
      format: 'module',
      shortCircuit: true,
      source: ts.transpileModule(readFileSync(new URL(url), 'utf8'), {
        compilerOptions: {
          target: ts.ScriptTarget.ES2023,
          module: ts.ModuleKind.ESNext,
        },
      }).outputText,
    };
  },
});
const sourcePaths = [
  'lib/campus/walkway.ts',
  'lib/campus/welch-middle-yard.ts',
  'lib/campus/welch-middle-yard-plan.json',
];
const sourceHashes = () =>
  Object.fromEntries(
    sourcePaths.map((p) => [
      p,
      createHash('sha256')
        .update(readFileSync(new URL(`../${p}`, import.meta.url)))
        .digest('hex'),
    ]),
  );
const sourcesAtStart = sourceHashes();
const { SpeedwayWalkway } = await import('../lib/campus/walkway.ts');
const { Terrain } = await import('../lib/campus/terrain.ts');
const { buildWelchMiddleYard } =
  await import('../lib/campus/welch-middle-yard.ts');
const { characterSupported } =
  await import('../lib/campus/character-support.ts');
const plan = JSON.parse(
  readFileSync(
    new URL('../lib/campus/welch-middle-yard-plan.json', import.meta.url),
  ),
);
const data = JSON.parse(
  readFileSync(new URL('../public/data/campus.json', import.meta.url)),
);
const terrain = new Terrain(
  JSON.parse(
    readFileSync(new URL('../public/data/terrain.json', import.meta.url)),
  ),
);
const material = new T.MeshStandardMaterial(),
  yard = buildWelchMiddleYard({ concrete: material, grass: material });
const along = new T.Vector3(...plan.facade.along),
  out = new T.Vector3(...plan.facade.out);
const point = (s, d) =>
  new T.Vector3(plan.facade.a[0], 0, plan.facade.a[1])
    .addScaledVector(along, s)
    .addScaledVector(out, d);
function widthAt(s) {
  let i = 0;
  while (i < plan.rows.length - 2 && s > plan.rows[i + 1].s) i++;
  const a = plan.rows[i],
    b = plan.rows[i + 1];
  return T.MathUtils.lerp(a.width, b.width, (s - a.s) / (b.s - a.s));
}
await RAPIER.init();
const world = new RAPIER.World({ x: 0, y: -24, z: 0 });
world.timestep = 1 / 60;
const loader = Object.getOwnPropertyDescriptor(
  T.TextureLoader.prototype,
  'load',
);
let walkway;
try {
  T.TextureLoader.prototype.load = () => new T.Texture();
  walkway = new SpeedwayWalkway(
    data,
    terrain,
    world,
    { capabilities: { getMaxAnisotropy: () => 8 } },
    true,
  );
} finally {
  Object.defineProperty(T.TextureLoader.prototype, 'load', loader);
}
walkway.group.updateWorldMatrix(true, true);
world.step();
const checks = [],
  failures = [],
  pointRayAmbiguities = [],
  ray = new T.Raycaster(),
  down = new T.Vector3(0, -1, 0);
const yardMeshes = walkway.surfaces.children.filter((m) =>
  m.name.startsWith('Welch middle east yard:'),
);
const seams = walkway.surfaces.getObjectByName(
  'Ground registration transitions',
);
const tracked = new Map();
function track(g) {
  if (!tracked.has(g)) {
    const r = { name: g.uuid, disposed: 0 };
    tracked.set(g, r);
    g.addEventListener('dispose', () => r.disposed++);
  }
  return tracked.get(g);
}
function check(name, fn) {
  try {
    checks.push({ name, passed: true, details: fn() });
  } catch (e) {
    checks.push({ name, passed: false });
    failures.push({ name, error: e.message });
  }
}
function geometryValid(g) {
  const p = g.attributes.position,
    count = g.index?.count ?? p.count;
  assert.equal(count % 3, 0);
  assert([...p.array].every(Number.isFinite));
  if (g.attributes.normal)
    assert([...g.attributes.normal.array].every(Number.isFinite));
  let min = Infinity;
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3();
  for (let i = 0; i < count; i += 3) {
    const ids = [0, 1, 2].map((j) => (g.index ? g.index.getX(i + j) : i + j));
    assert(ids.every((k) => Number.isInteger(k) && k >= 0 && k < p.count));
    a.fromBufferAttribute(p, ids[0]);
    b.fromBufferAttribute(p, ids[1]);
    c.fromBufferAttribute(p, ids[2]);
    const n = b.sub(a).cross(c.sub(a)).lengthSq();
    min = Math.min(min, n);
    assert(n > 1e-16, `Collapsed Float32 triangle ${i / 3}: ${n}`);
  }
  return { triangles: count / 3, minimumCrossSquared: min };
}
function ground(p, requireYard = true) {
  const expected = yard.inside(p.x, p.z) ? yard.height(p.x, p.z) : null;
  // Low origins exclude façade canopies but include overlapping old ground.
  const origin = new T.Vector3(
    p.x,
    expected === null ? 7 : expected + 1.25,
    p.z,
  );
  ray.set(origin, down);
  ray.far = 6;
  const visual = ray
    .intersectObject(walkway.surfaces, true)
    .find((h) => h.face.normal.y > 0.6);
  const physical = world.castRay(
    new RAPIER.Ray(origin, down),
    6,
    true,
    RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
  );
  assert(visual, `Missing visible floor at ${p.x},${p.z}`);
  let error;
  if (physical) {
    error = Math.abs(visual.point.y - (origin.y - physical.timeOfImpact));
  } else {
    // Rapier can miss a mathematically exact shared triangle edge even though
    // adjacent points hit. Preserve that miss explicitly; accept it only when
    // ALL four 0.1 mm neighboring rays agree with the visible floor. This is a
    // precision diagnosis, not a silently shifted test or a geometry change.
    const neighbors = [];
    for (const [dx, dz] of [
      [-0.0001, 0],
      [0.0001, 0],
      [0, -0.0001],
      [0, 0.0001],
    ]) {
      const adjacent = origin.clone().add(new T.Vector3(dx, 0, dz));
      ray.set(adjacent, down);
      const view = ray
        .intersectObject(walkway.surfaces, true)
        .find((h) => h.face.normal.y > 0.6);
      const hit = world.castRay(
        new RAPIER.Ray(adjacent, down),
        6,
        true,
        RAPIER.QueryFilterFlags.EXCLUDE_KINEMATIC,
      );
      assert(
        view && hit,
        `Missing floor near exact-edge ray at ${adjacent.x},${adjacent.z}`,
      );
      const y = adjacent.y - hit.timeOfImpact;
      const disagreement = Math.abs(view.point.y - y);
      assert(
        disagreement < 0.005 && Math.abs(y - visual.point.y) < 0.003,
        `Neighbor floor disagrees at ${adjacent.x},${adjacent.z}`,
      );
      if (requireYard)
        assert(
          yardMeshes.includes(view.object),
          'Neighbor probe recovered obsolete ground',
        );
      neighbors.push({
        x: adjacent.x,
        z: adjacent.z,
        visualY: view.point.y,
        physicalY: y,
        timeOfImpact: hit.timeOfImpact,
        error: disagreement,
      });
    }
    pointRayAmbiguities.push({
      x: p.x,
      z: p.z,
      originY: origin.y,
      expectedY: expected,
      visualY: visual.point.y,
      physical: null,
      offsetMetres: 0.0001,
      neighbors,
    });
    error = Math.max(...neighbors.map((neighbor) => neighbor.error));
  }
  assert(
    error < 0.005,
    `Visual/Rapier disagreement ${error} at ${p.x},${p.z}: ${visual.object.name}`,
  );
  if (requireYard) {
    assert(expected !== null);
    assert(
      yardMeshes.includes(visual.object),
      `Old ground recovered at ${p.x},${p.z}: ${visual.object.name} / ${visual.object.material.name}; expected=${expected}, actual=${visual.point.y}`,
    );
    assert(
      Math.abs(visual.point.y - expected) < 0.003,
      `Yard grade changed at ${p.x},${p.z}`,
    );
  }
  return { y: visual.point.y, error, mesh: visual.object.name };
}
const stations = [
  0.15,
  2,
  5.8,
  8,
  16,
  25,
  34,
  43,
  52,
  plan.doorChainage,
  59,
  64,
  plan.facade.length - 0.15,
];
function survey(selected = stations) {
  let samples = 0,
    maxError = 0;
  for (const s of selected)
    for (const d of [
      0.7,
      1.1,
      1.8,
      2.35,
      widthAt(s) * 0.5,
      widthAt(s) - 0.15,
    ]) {
      const g = ground(point(s, d));
      samples++;
      maxError = Math.max(maxError, g.error);
    }
  return { samples, maxError };
}
function controllerTrack(points, speed, jump = false) {
  const first = points[0],
    body = world.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(
        first.x,
        ground(first).y + 0.905,
        first.z,
      ),
    );
  const capsule = world.createCollider(
      RAPIER.ColliderDesc.capsule(0.54, 0.34),
      body,
    ),
    controller = world.createCharacterController(0.025);
  controller.enableAutostep(0.32, 0.2, false);
  controller.enableSnapToGround(0.38);
  controller.setMaxSlopeClimbAngle(Math.PI * 0.25);
  controller.setMinSlopeSlideAngle(Math.PI * 0.28);
  world.step();
  let vertical = jump ? 7.2 : 0,
    frames = 0,
    unsupported = 0,
    airborne = 0,
    minimumClearance = Infinity,
    maxHeight = 0;
  const unsupportedSpots = [];
  try {
    for (const target of points.slice(1)) {
      let reached = false;
      for (let f = 0; f < 4000; f++) {
        const p = body.translation(),
          dx = target.x - p.x,
          dz = target.z - p.z,
          d = Math.hypot(dx, dz);
        if (d < 0.08 && (!jump || (frames > 20 && vertical <= 0))) {
          reached = true;
          break;
        }
        vertical = Math.max(-35, vertical - 24 / 60);
        const step = Math.min(d, speed / 60);
        controller.computeColliderMovement(capsule, {
          x: d ? (dx / d) * step : 0,
          y: vertical / 60,
          z: d ? (dz / d) * step : 0,
        });
        const delta = controller.computedMovement(),
          supported = characterSupported(controller, p.y, vertical);
        if (supported && vertical < 0) vertical = 0;
        else if (!supported) {
          if (jump) airborne++;
          else {
            unsupported++;
            unsupportedSpots.push({
              x: p.x,
              y: p.y,
              z: p.z,
              vertical,
              delta: { ...delta },
              local: yard.local(p.x, p.z),
            });
          }
        }
        body.setNextKinematicTranslation({
          x: p.x + delta.x,
          y: p.y + delta.y,
          z: p.z + delta.z,
        });
        world.step();
        frames++;
        const q = body.translation(),
          floor = ground(new T.Vector3(q.x, 0, q.z), yard.inside(q.x, q.z)).y,
          clearance = q.y - 0.905 - floor;
        minimumClearance = Math.min(minimumClearance, clearance);
        maxHeight = Math.max(maxHeight, clearance);
        assert(
          clearance > -0.05,
          `Capsule fell through ground: ${clearance} at ${q.x},${q.z}`,
        );
      }
      assert(
        reached,
        `Capsule blocked approaching ${target.x},${target.z}; ended ${JSON.stringify(body.translation())}`,
      );
    }
    if (jump) {
      for (let i = 0; i < 90; i++) {
        const p = body.translation();
        vertical = Math.max(-35, vertical - 24 / 60);
        controller.computeColliderMovement(capsule, {
          x: 0,
          y: vertical / 60,
          z: 0,
        });
        const delta = controller.computedMovement();
        if (characterSupported(controller, p.y, vertical) && vertical < 0)
          vertical = 0;
        body.setNextKinematicTranslation({
          x: p.x + delta.x,
          y: p.y + delta.y,
          z: p.z + delta.z,
        });
        world.step();
        frames++;
      }
      const p = body.translation(),
        clearance = p.y - 0.905 - ground(new T.Vector3(p.x, 0, p.z)).y;
      assert(
        airborne > 5 && maxHeight > 0.45,
        'Jump must actually become airborne',
      );
      assert(Math.abs(clearance) < 0.06, `Jump did not land: ${clearance}`);
    } else
      assert.equal(
        unsupported,
        0,
        `Ordinary movement lost floor support: ${JSON.stringify(unsupportedSpots.slice(0, 8))}`,
      );
    return {
      frames,
      unsupported,
      airborne,
      minimumClearance,
      maxHeight,
      final: { ...body.translation() },
    };
  } finally {
    world.removeCharacterController(controller);
    world.removeRigidBody(body);
  }
}
let disposed = false;
try {
  check(
    'Integrated closed yard meshes are valid and use borrowed materials',
    () => {
      assert(walkway.welchMiddleYard);
      assert.equal(yardMeshes.length, 2);
      assert(seams?.isMesh);
      assert.equal(walkway.welchMiddleYard.ownedMaterials, 0);
      assert.equal(
        walkway.welchMiddleYard.sourceCutVolumes,
        plan.rows.length - 1,
      );
      for (const mesh of yardMeshes) track(mesh.geometry);
      // Read only: canonical geometry identity/disposal; updates use public stitchGround.
      assert(walkway.seamGeometry);
      assert.notEqual(seams.geometry, walkway.seamGeometry);
      track(walkway.seamGeometry);
      track(seams.geometry);
      return yardMeshes.map((m) => ({
        name: m.name,
        ...geometryValid(m.geometry),
      }));
    },
  );
  check(
    'Full scene retains supported yard, inner walk, and service crosspath',
    survey,
  );
  check('Exact outer Speedway edge and south seam stay joined', () => {
    let samples = 0,
      maxJump = 0;
    for (const s of [2, 12, 25, 40, plan.doorChainage, 64]) {
      const a = ground(point(s, widthAt(s) - 0.035)),
        b = ground(point(s, widthAt(s) + 0.035), false);
      maxJump = Math.max(maxJump, Math.abs(a.y - b.y));
      assert(
        Math.abs(a.y - b.y) < 0.055,
        `Outer seam height jump ${Math.abs(a.y - b.y)} at ${s}`,
      );
      samples += 2;
    }
    for (const d of [0.8, 1.1, 2, 6, 12, 18]) {
      const a = ground(point(0.035, d)),
        b = ground(point(-0.035, d), false);
      maxJump = Math.max(maxJump, Math.abs(a.y - b.y));
      assert(
        Math.abs(a.y - b.y) < 0.055,
        `South seam jump ${Math.abs(a.y - b.y)} at ${d}`,
      );
      samples += 2;
    }
    return {
      samples,
      maxJump,
      northExit:
        'North profile is partly inferred; no claim of a complete path beyond the modeled yard.',
    };
  });
  check(
    'Repeated public seam stitching cannot reinstall old ground inside the new yard',
    () => {
      const canonical = walkway.seamGeometry,
        hashes = yardMeshes.map((m) =>
          createHash('sha256')
            .update(Buffer.from(m.geometry.attributes.position.array.buffer))
            .digest('hex'),
        );
      const count = world.colliders.len(),
        commits = [],
        descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
      let now = performance.now() + 1000;
      try {
        Object.defineProperty(performance, 'now', {
          configurable: true,
          value: () => now,
        });
        for (let pass = 0; pass < 4; pass++) {
          const previous = seams.geometry,
            record = track(previous);
          let sampled = 0;
          now += 700;
          walkway.stitchGround(world, point(35, 8), (x, z, y) => {
            assert(
              !yard.inside(x, z),
              'Authored yard must not accept scanned edge heights',
            );
            sampled++;
            return y + (pass % 2 ? -0.22 : 0.27);
          });
          world.step();
          walkway.group.updateWorldMatrix(true, true);
          assert(sampled > 0);
          assert.notEqual(
            seams.geometry,
            previous,
            'Outside sample must cause real seam commit',
          );
          assert.equal(record.disposed, 1);
          assert.equal(track(canonical).disposed, 0);
          assert.equal(walkway.seamGeometry, canonical);
          assert.equal(
            world.colliders.len(),
            count,
            'Old seam collider leaked',
          );
          track(seams.geometry);
          const geometry = geometryValid(seams.geometry),
            floors = survey();
          assert.deepEqual(
            yardMeshes.map((m) =>
              createHash('sha256')
                .update(
                  Buffer.from(m.geometry.attributes.position.array.buffer),
                )
                .digest('hex'),
            ),
            hashes,
          );
          commits.push({ pass, sampled, geometry, floors });
        }
      } finally {
        if (descriptor) Object.defineProperty(performance, 'now', descriptor);
        else delete performance.now;
      }
      return { commits, canonicalSurvived: true, yardMeshesUnchanged: true };
    },
  );
  for (const speed of [1.65, 8])
    for (const north of [true, false])
      check(
        `${north ? 'Northbound' : 'Southbound'} inner walk at ${speed} m/s after seam commits`,
        () => {
          const points = [
            point(0.5, 1.1),
            point(plan.facade.length - 0.5, 1.1),
          ];
          return controllerTrack(north ? points : points.reverse(), speed);
        },
      );
  for (const speed of [1.65, 8])
    check(
      `Service crosspath approach/retreat ${speed} m/s; raised sill is not an entry`,
      () =>
        controllerTrack(
          [
            point(plan.doorChainage, 1.1),
            point(plan.doorChainage, widthAt(plan.doorChainage) - 0.15),
            point(plan.doorChainage, 1.1),
          ],
          speed,
        ),
    );
  check(
    'Bounded inner-walk jump becomes airborne and lands on authored support',
    () => controllerTrack([point(34, 1.1), point(37, 1.1)], 1.65, true),
  );
  check(
    'Owner teardown releases superseded and canonical ground geometry exactly once',
    () => {
      track(seams.geometry);
      walkway.dispose(world);
      disposed = true;
      assert.equal(world.colliders.len(), 0);
      for (const record of tracked.values())
        assert.equal(
          record.disposed,
          1,
          `Geometry disposed ${record.disposed} times: ${record.name}`,
        );
      return {
        geometries: tracked.size,
        remainingColliders: world.colliders.len(),
      };
    },
  );
} finally {
  if (!disposed) walkway.dispose(world);
  world.free();
  yard.dispose();
  material.dispose();
}
check('Source files stayed stable throughout the test', () =>
  assert.deepEqual(sourceHashes(), sourcesAtStart),
);
const result = {
  passed: failures.length === 0,
  checks,
  failures,
  pointRayAmbiguities,
  sources: sourcesAtStart,
  limits:
    'Actual full authored campus and Rapier controller; no streamed scan or downloaded tree collision. North seam partly inferred; service sill remains closed. Browser movement/source overlap require separate checks.',
};
const output =
  process.env.UT_WELCH_MIDDLE_EVIDENCE ??
  '/tmp/ut-iteration-54/welch-middle-ground-check.json';
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(
  JSON.stringify({
    passed: result.passed,
    checks: checks.length,
    failures,
    evidence: output,
  }),
);
if (!result.passed) process.exitCode = 1;
