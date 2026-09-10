import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname } from 'node:path';
import ts from 'typescript';
import * as T from 'three';
import R from '@dimforge/rapier3d-compat';

// Compile live TypeScript imports only. No source substitution or scene injection.
registerHooks({
  resolve(s, c, next) {
    if (s.startsWith('.') && c.parentURL && !/\.[a-z]+$/i.test(s)) {
      const url = new URL(`${s}.ts`, c.parentURL);
      if (existsSync(url)) return { url: url.href, shortCircuit: true };
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
const paths = [
  'lib/campus/walkway.ts',
  'lib/campus/welch-north-exit.ts',
  'lib/campus/welch-north-exit-plan.json',
];
const hashes = () =>
  Object.fromEntries(
    paths.map((p) => [
      p,
      createHash('sha256')
        .update(readFileSync(new URL(`../${p}`, import.meta.url)))
        .digest('hex'),
    ]),
  );
const sources = hashes();
const { SpeedwayWalkway } = await import('../lib/campus/walkway.ts');
const { Terrain } = await import('../lib/campus/terrain.ts');
const { buildWelchNorthExit } =
  await import('../lib/campus/welch-north-exit.ts');
const { characterSupported } =
  await import('../lib/campus/character-support.ts');
const { subtractVolumes } = await import('../lib/campus/clip-volume.ts');
// Observed after the initial 15 m cleanup; protects against floating cutoff blades.
const revisedFragments = [
  {
    label: 'north upper floating blade',
    triangle: [
      [-6.359649190980138, 15.629030136039818, -101.94002537171586],
      [-6.9224616239739705, 14.999999966262521, -103.05485596626151],
      [-6.612235943522187, 14.999999852749156, -101.89317257330752],
    ],
  },
  {
    label: 'north low floating blade',
    triangle: [
      [-4.943175540854493, 15.686222765546706, -118.68716415323078],
      [-6.251880720562907, 15.776548955009037, -119.8373776105329],
      [-6.397977434345952, 15.00000021117732, -119.85059219000931],
    ],
  },
];
const plan = JSON.parse(
  readFileSync(
    new URL('../lib/campus/welch-north-exit-plan.json', import.meta.url),
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
const borrowed = new T.MeshStandardMaterial();
// Expectations only: these meshes are never added to the actual scene/world.
const helper = buildWelchNorthExit({ concrete: borrowed, grass: borrowed });
const origin = new T.Vector3(plan.origin[0], 0, plan.origin[1]);
const along = new T.Vector3(...plan.along),
  out = new T.Vector3(...plan.out);
const point = (s, d) =>
  origin.clone().addScaledVector(along, s).addScaledVector(out, d);
const width = (s) => {
  let i = 0;
  while (i < plan.rows.length - 2 && s > plan.rows[i + 1].s) i++;
  const a = plan.rows[i],
    b = plan.rows[i + 1];
  return T.MathUtils.lerp(a.width, b.width, (s - a.s) / (b.s - a.s));
};
await R.init();
const world = new R.World({ x: 0, y: -24, z: 0 });
world.timestep = 1 / 60;
const descriptor = Object.getOwnPropertyDescriptor(
  T.TextureLoader.prototype,
  'load',
);
let walkway;
try {
  T.TextureLoader.prototype.load = (url) => {
    const texture = new T.Texture();
    texture.name = url;
    return texture;
  };
  walkway = new SpeedwayWalkway(
    data,
    terrain,
    world,
    { capabilities: { getMaxAnisotropy: () => 8 } },
    true,
  );
} finally {
  Object.defineProperty(T.TextureLoader.prototype, 'load', descriptor);
}
walkway.group.updateWorldMatrix(true, true);
world.step();
const meshes = walkway.surfaces.children.filter((m) =>
  m.name.startsWith('Welch north exit:'),
);
const seams = walkway.surfaces.getObjectByName(
  'Ground registration transitions',
);
const ray = new T.Raycaster(),
  down = new T.Vector3(0, -1, 0);
const checks = [],
  failures = [],
  ambiguities = [],
  tracked = new Map();
const track = (geometry) => {
  if (!tracked.has(geometry)) {
    const record = { disposed: 0 };
    geometry.addEventListener('dispose', () => record.disposed++);
    tracked.set(geometry, record);
  }
  return tracked.get(geometry);
};
const check = (name, fn) => {
  try {
    checks.push({ name, passed: true, details: fn() });
  } catch (error) {
    const failure = { name, passed: false, error: String(error) };
    failures.push(failure);
    checks.push(failure);
  }
};
function ground(p, requireNorth = helper.contains(p.x, p.z)) {
  const expected = requireNorth ? helper.height(p.x, p.z) : null;
  const origin = p.clone().setY(expected === null ? 8 : expected + 0.25);
  ray.set(origin, down);
  ray.far = expected === null ? 12 : 2;
  const view = ray
    .intersectObject(walkway.surfaces, true)
    .find((h) => h.face.normal.y > 0.6);
  const hit = world.castRay(
    new R.Ray(origin, down),
    ray.far,
    true,
    R.QueryFilterFlags.EXCLUDE_KINEMATIC,
  );
  assert(view && hit, `Missing live floor at ${p.x},${p.z}`);
  const y = origin.y - hit.timeOfImpact;
  const error = Math.abs(y - view.point.y);
  assert(error < 0.003, `Visual/physical mismatch ${error} at ${p.x},${p.z}`);
  if (requireNorth) {
    assert(
      meshes.includes(view.object),
      `Obsolete ground at ${p.x},${p.z}: ${view.object.name}`,
    );
    assert(
      Math.abs(expected - y) < 0.003,
      `Unexpected northern grade at ${p.x},${p.z}`,
    );
  }
  return { y, error, name: view.object.name };
}
function survey() {
  let samples = 0,
    maxError = 0;
  for (const s of [0.31, 3.15, 9.16, 15.21, 23.82, 28.35, 33.27, 39.15, 42.05])
    for (const d of [0.7, 1.1, 2.35, 5.15, 10.2, 14.25, 18.3, 20.1]) {
      const g = ground(point(s, d));
      samples++;
      maxError = Math.max(maxError, g.error);
    }
  for (const st of plan.stairs)
    for (let d = 2.3; d < st.outerWidth - 0.1; d += 0.139) {
      const g = ground(point(st.s, d));
      samples++;
      maxError = Math.max(maxError, g.error);
    }
  return { samples, maxError };
}
function topology(name, faces) {
  const edges = new Map(),
    key = (v) =>
      v
        .toArray()
        .map((x) => Math.round(x * 1e5))
        .join(',');
  let signedVolume = 0;
  for (const v of faces) {
    assert(v.every((p) => p.toArray().every(Number.isFinite)));
    assert(
      v[1].clone().sub(v[0]).cross(v[2].clone().sub(v[0])).lengthSq() > 1e-14,
    );
    signedVolume += v[0].dot(v[1].clone().cross(v[2])) / 6;
    for (let j = 0; j < 3; j++) {
      const a = key(v[j]),
        b = key(v[(j + 1) % 3]),
        k = [a, b]
          .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))
          .join('|');
      const e = edges.get(k) ?? { count: 0, balance: 0 };
      e.count++;
      e.balance += a < b ? 1 : -1;
      edges.set(k, e);
    }
  }
  assert(
    [...edges.values()].every((e) => e.count === 2 && e.balance === 0),
    `${name} is not closed/oriented`,
  );
  assert(signedVolume > 0, `${name} has inverted winding`);
  return { name, triangles: faces.length, signedVolume };
}
function run(points, speed) {
  const first = points[0],
    body = world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(
        first.x,
        ground(first).y + 0.905,
        first.z,
      ),
    );
  const capsule = world.createCollider(
      R.ColliderDesc.capsule(0.54, 0.34),
      body,
    ),
    controller = world.createCharacterController(0.025);
  controller.enableAutostep(0.32, 0.2, false);
  controller.enableSnapToGround(0.38);
  controller.setMaxSlopeClimbAngle(Math.PI * 0.25);
  controller.setMinSlopeSlideAngle(Math.PI * 0.28);
  world.step();
  let vertical = 0,
    frames = 0,
    unsupported = 0,
    minimumClearance = Infinity;
  const unsupportedPoints = [];
  try {
    for (const target of points.slice(1)) {
      let reached = false;
      for (let f = 0; f < 7000; f++) {
        const p = body.translation(),
          dx = target.x - p.x,
          dz = target.z - p.z,
          distance = Math.hypot(dx, dz);
        if (distance < 0.09) {
          reached = true;
          break;
        }
        vertical = Math.max(-35, vertical - 24 / 60);
        const step = Math.min(distance, speed / 60);
        controller.computeColliderMovement(capsule, {
          x: (dx / distance) * step,
          y: vertical / 60,
          z: (dz / distance) * step,
        });
        const delta = controller.computedMovement();
        if (characterSupported(controller, p.y, vertical) && vertical < 0)
          vertical = 0;
        else {
          unsupported++;
          unsupportedPoints.push({
            position: { ...p },
            local: helper.local(p.x, p.z),
            delta: { ...delta },
            vertical,
          });
        }
        body.setNextKinematicTranslation({
          x: p.x + delta.x,
          y: p.y + delta.y,
          z: p.z + delta.z,
        });
        world.step();
        frames++;
        const q = body.translation(),
          clearance = q.y - 0.905 - ground(new T.Vector3(q.x, q.y, q.z)).y;
        minimumClearance = Math.min(minimumClearance, clearance);
        assert(clearance > -0.06, `Fell through northern floor: ${clearance}`);
      }
      assert(reached, `Route blocked at ${JSON.stringify(body.translation())}`);
    }
    assert.equal(
      unsupported,
      0,
      `Unsupported frames: ${JSON.stringify(unsupportedPoints)}`,
    );
    return {
      speed,
      frames,
      unsupported,
      minimumClearance,
      final: { ...body.translation() },
    };
  } finally {
    world.removeCharacterController(controller);
    world.removeRigidBody(body);
  }
}
let actualTrees = [];
try {
  check('Live north asset, material ownership, and component winding', () => {
    assert.equal(walkway.welchNorthExit.triangles, 1836);
    assert.equal(meshes.length, 3);
    assert.equal(walkway.welchNorthExit.sourceCutVolumes, 26);
    assert.equal(
      meshes[0].material,
      walkway.surfaces.getObjectByName(
        'Welch middle east yard: connected walks',
      ).material,
    );
    assert.equal(
      meshes[1].material,
      walkway.surfaces.getObjectByName(
        'Welch middle east yard: graded planting',
      ).material,
    );
    const triangles = (mat, start, count) => {
      const p = meshes[mat].geometry.attributes.position;
      return Array.from({ length: count }, (_, i) =>
        [0, 1, 2].map((j) =>
          new T.Vector3().fromBufferAttribute(p, (start + i) * 3 + j),
        ),
      );
    };
    const counts = walkway.welchNorthExit.terrainTrianglesByMaterial,
      cursors = [...counts];
    const result = [
      topology(
        'Continuous terrain',
        triangles(0, 0, counts[0]).concat(triangles(1, 0, counts[1])),
      ),
    ];
    for (const c of walkway.welchNorthExit.componentStats.slice(1)) {
      const mat = c.name === 'Central raised planting terrace' ? 1 : 0;
      result.push(topology(c.name, triangles(mat, cursors[mat], c.triangles)));
      cursors[mat] += c.triangles;
    }
    for (
      let i = 0;
      i < meshes[2].geometry.attributes.position.count / 3;
      i += 24
    )
      result.push(topology(`Rail ${i / 24}`, triangles(2, i, 24)));
    meshes.forEach((m) => track(m.geometry));
    track(walkway.seamGeometry);
    track(seams.geometry);
    return {
      components: result.length,
      triangles: 1836,
      allClosedAndOriented: true,
    };
  });
  check(
    'Actual live floor and both tread sequences match visible collision',
    survey,
  );
  check('Old yard, Speedway and fixed 24th edge remain joined', () => {
    let samples = 0,
      maxJump = 0;
    const pair = (a, b) => {
      const h = Math.abs(ground(a).y - ground(b).y);
      assert(h < 0.055, `Seam jump ${h}`);
      samples += 2;
      maxJump = Math.max(maxJump, h);
    };
    for (const d of [0.8, 1.1, 2, 6, 12, 18])
      pair(point(0.035, d), point(-0.035, d));
    for (const s of [2, 12, 25, 32, 40])
      pair(point(s, width(s) - 0.035), point(s, width(s) + 0.035));
    const cap = plan.rows.at(-1).vertices;
    for (const t of [0.05, 0.15, 0.4, 0.6, 0.8, 0.98]) {
      let i = 0;
      while (i < cap.length - 2 && t > cap[i + 1].t) i++;
      const a = cap[i],
        b = cap[i + 1],
        p = new T.Vector3(...a.p).lerp(
          new T.Vector3(...b.p),
          (t - a.t) / (b.t - a.t),
        );
      pair(
        p.clone().addScaledVector(along, -0.035),
        p.clone().addScaledVector(along, 0.035),
      );
    }
    return {
      samples,
      maxJump,
      inheritedGrayCornerDifference: plan.roadCornerMismatch,
    };
  });
  check(
    'Registered live source cuts remove original fragments and both post-cut blades',
    () => {
      const witnesses = JSON.parse(
        readFileSync(
          new URL(
            '../../research/welch-north-exit-55/source-triangle-witnesses.json',
            import.meta.url,
          ),
        ),
      );
      witnesses.push(...revisedFragments);
      const tested = witnesses
        .filter((w) => w.triangle.every((p) => helper.contains(p[0], p[2])))
        .map((w) => {
          const g = new T.BufferGeometry().setAttribute(
            'position',
            new T.Float32BufferAttribute(w.triangle.flat(), 3),
          );
          const clipped = subtractVolumes(g, new T.Matrix4(), walkway.volumes);
          assert(
            clipped && clipped.attributes.position.count === 0,
            `Live cut did not remove ${w.label}`,
          );
          g.dispose();
          clipped.dispose();
          return { label: w.label, removed: true };
        });
      assert.equal(tested.length, 10);
      return tested;
    },
  );
  check(
    'Tree placements use clear routes and current supported heights',
    () => {
      actualTrees = walkway.treePlacements
        .filter((p) => helper.contains(p.x, p.z))
        .map((p) => ({
          ...p,
          local: helper.local(p.x, p.z),
          expectedGroundY: helper.height(p.x, p.z),
        }));
      for (const tree of actualTrees) {
        assert(!helper.paved(tree.x, tree.z), 'Trunk placed on northern path');
        assert(
          Math.abs(tree.y - tree.expectedGroundY + 0.025) < 0.003,
          'Tree not reseated',
        );
      }
      return {
        count: actualTrees.length,
        placements: actualTrees,
        collisionScope:
          'Placements only; loaded tree colliders require browser validation.',
      };
    },
  );
  check(
    'Four real seam commits preserve northern floor and collider ownership',
    () => {
      const canonical = walkway.seamGeometry,
        count = world.colliders.len(),
        commits = [];
      const desc = Object.getOwnPropertyDescriptor(performance, 'now');
      let now = performance.now() + 1000;
      try {
        Object.defineProperty(performance, 'now', {
          configurable: true,
          value: () => now,
        });
        for (let pass = 0; pass < 4; pass++) {
          const previous = seams.geometry;
          track(previous);
          now += 700;
          let sampled = 0;
          walkway.stitchGround(world, point(20, 8), (x, z, y) => {
            assert(
              !helper.contains(x, z),
              'Source query inside authored north exit',
            );
            sampled++;
            return y + (pass % 2 ? 0.23 : -0.19);
          });
          world.step();
          walkway.group.updateWorldMatrix(true, true);
          assert(sampled > 0);
          assert.notEqual(previous, seams.geometry);
          assert.equal(track(previous).disposed, 1);
          assert.equal(walkway.seamGeometry, canonical);
          assert.equal(track(canonical).disposed, 0);
          assert.equal(world.colliders.len(), count);
          track(seams.geometry);
          commits.push({ pass, sampled, floors: survey() });
        }
      } finally {
        if (desc) Object.defineProperty(performance, 'now', desc);
        else delete performance.now;
      }
      return { commits, canonicalPreserved: true, colliderCountStable: true };
    },
  );
  for (const speed of [1.65, 8]) {
    check(
      `Continuous inner walk through both seams and 24th: ${speed} m/s`,
      () =>
        run(
          [point(-3, 1.1), point(plan.length + 3, 1.1), point(-3, 1.1)],
          speed,
        ),
    );
    for (const st of plan.stairs)
      check(`${st.id} ascend/descend: ${speed} m/s`, () =>
        run(
          [
            point(st.s, st.outerWidth + 0.6),
            point(st.s, 1.1),
            point(st.s, st.outerWidth + 0.6),
          ],
          speed,
        ),
      );
  }
  check('Live teardown disposes owned and canonical geometries once', () => {
    walkway.dispose(world);
    assert([...tracked.values()].every((r) => r.disposed === 1));
    assert.equal(world.colliders.len(), 0);
    return { trackedGeometries: tracked.size, remainingColliders: 0 };
  });
  check('Live source hashes stayed stable throughout the run', () => {
    assert.deepEqual(hashes(), sources);
  });
} finally {
  walkway.dispose(world);
  helper.dispose();
  borrowed.dispose();
  world.free();
  const output =
    process.env.UT_WELCH_NORTH_EVIDENCE ||
    new URL(
      '../evidence/iteration-55/welch-north-exit-check.json',
      import.meta.url,
    ).pathname;
  mkdirSync(dirname(output), { recursive: true });
  const report = {
    passed: failures.length === 0,
    checks,
    failures,
    sources,
    actualTrees,
    pointRayAmbiguities: ambiguities,
    browserRoutes: {
      innerWalk: [
        point(-3, 1.1).toArray(),
        point(plan.length + 3, 1.1).toArray(),
      ],
      stairs: plan.stairs.map((s) => ({
        name: s.id,
        from: point(s.s, s.outerWidth + 0.6).toArray(),
        to: point(s.s, 1.1).toArray(),
      })),
    },
    checkerSha256: createHash('sha256')
      .update(readFileSync(new URL(import.meta.url)))
      .digest('hex'),
    sourceCeiling: plan.sourceCeiling,
    revisedFragments,
    limits:
      'Live authored scene imports and normal Rapier controller, without code substitution. Reference helper is never registered into scene or physics. Photogrammetry, tree collider loading and browser frame time require separate acceptance.',
  };
  writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report, null, 2));
}
if (failures.length) process.exitCode = 1;
