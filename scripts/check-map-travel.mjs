import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import ts from 'typescript';
import * as T from 'three';
import RAPIER from '@dimforge/rapier3d-compat';
registerHooks({ resolve(specifier, context, next) {
  if (specifier.endsWith('?worker')) return { url: new URL(specifier, context.parentURL).href, shortCircuit: true };
  if (specifier.startsWith('.') && context.parentURL && !/\.[a-z]+$/i.test(specifier)) {
    const url = new URL(`${specifier}.ts`, context.parentURL);
    if (existsSync(url)) return { url: url.href, shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  // Bundler-only worker constructors are not instantiated by these controller checks.
  if (url.endsWith('?worker')) return { format: 'module', shortCircuit: true,
    source: 'export default class UnusedBrowserWorker {}' };
  if (url.endsWith('.json')) return { format: 'module', shortCircuit: true,
    source: `export default ${readFileSync(new URL(url), 'utf8')};` };
  if (!url.endsWith('.ts')) return next(url, context);
  return { format: 'module', shortCircuit: true, source: ts.transpileModule(readFileSync(new URL(url), 'utf8'),
    { compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext } }).outputText };
} });
const { mapView, mapPoint, outdoorPoint, travelCandidates, travelLanding } = await import('../lib/campus/map-travel.ts');
const { CampusGame } = await import('../lib/campus/game.ts');
const checks = [];
function check(name, fn) { fn(); checks.push({ name, passed: true }); }
const data = { bounds: [-100, -100, 100, 100], buildings: [{ rings: [[[-10,-10],[10,-10],[10,10],[-10,10]], [[-3,-3],[-3,3],[3,3],[3,-3]]] }],
  paths: [{ kind: 'footway', area: false, points: [[-40,15],[40,15]] }] };
check('Expanded and local map transforms roundtrip at different CSS display sizes', () => {
  for (const expanded of [false, true]) for (const cssSize of [135, 190, 550, 760]) {
    const view = mapView(data.bounds, { x: 23, z: -12 }, expanded), target = [-38, 44];
    const css = target.map((value, i) => (.5 + (value - (i ? view.z : view.x)) * view.scale / view.size) * cssSize);
    const point = mapPoint(view, css[0] / cssSize, css[1] / cssSize);
    assert(Math.hypot(point[0] - target[0], point[1] - target[1]) < 1e-9);
  }
});
check('Mapped roofs and wall margins are excluded; open courtyard stays usable', () => {
  assert(!outdoorPoint(data, [8,0])); assert(!outdoorPoint(data, [10.4,0])); assert(outdoorPoint(data, [0,0]));
  const candidates = travelCandidates(data, [8,0]); assert(candidates.length);
  assert(candidates.every(p => outdoorPoint(data,p)));
  assert.deepEqual(travelCandidates(data, [NaN,0]), []);
});
await RAPIER.init();
const world = new RAPIER.World({x:0,y:-24,z:0});
const floor = world.createCollider(RAPIER.ColliderDesc.cuboid(20,.1,20).setTranslation(0,-.1,0));
const player = world.createCollider(RAPIER.ColliderDesc.capsule(.54,.34).setTranslation(10,.905,10));
const mesh = new T.Mesh(new T.PlaneGeometry(40,40).rotateX(-Math.PI/2),new T.MeshBasicMaterial());
mesh.updateMatrixWorld(); world.step();
const ray = new T.Raycaster();
const surface = (x,z,y,d) => {ray.set(new T.Vector3(x,y,z),new T.Vector3(0,-1,0));ray.far=d;return ray.intersectObject(mesh)[0]??null;};
try {
  check('Installed visible and physical ground accepts a clear capsule', () => {
    const p=travelLanding(world,player,[0,0],0,surface);assert(p);assert(Math.abs(p.y-.905)<1e-6);
  });
  check('Nearby obstacle blocks landing even with ground beneath', () => {
    const wall=world.createCollider(RAPIER.ColliderDesc.cuboid(.2,.7,.2).setTranslation(.25,1,0));world.step();
    assert.equal(travelLanding(world,player,[0,0],0,surface),null);world.removeCollider(wall,true);world.step();
  });
  check('Coarse streamed surfaces cannot finish travel', () => {
    mesh.userData.tile={geometricError:8};assert.equal(travelLanding(world,player,[0,0],0,surface),null);delete mesh.userData.tile;
  });
  check('Missing or height-mismatched physical ground cannot finish travel', () => {
    floor.setTranslation({x:0,y:-.5,z:0});world.step();assert.equal(travelLanding(world,player,[0,0],0,surface),null);
    world.removeCollider(floor,true);world.step();assert.equal(travelLanding(world,player,[0,0],0,surface),null);
  });
  check('Obstructed readiness advances to another candidate; timeout preserves departure', () => {
    let cancelled = false;
    const fake = { travel: { requested: [0,0], candidates: [[0,0],[2,0]], index: 0,
      started: 0, candidateSince: 0, lastProbe: 0, origin: new T.Vector3(10,1,10) },
      world: { terrain: { height: () => 0 } }, focus: new T.Vector3(), camera: new T.PerspectiveCamera(),
      photoreal: { setTravelDestination() {}, update() {}, syncCollisions: () => false },
      cancelTravel() { cancelled = true; this.travel = undefined; } };
    CampusGame.prototype.updateTravel.call(fake, 6001);
    assert.equal(fake.travel.index, 1); assert(!cancelled);
    CampusGame.prototype.updateTravel.call(fake, 46001);
    assert(cancelled); assert.equal(fake.travel, undefined);
  });
  check('Real game movement at the faster speed stops at a wall and can retreat', () => {
    const physics = new RAPIER.World({x:0,y:-24,z:0}); physics.timestep=1/60;
    physics.createCollider(RAPIER.ColliderDesc.cuboid(100,.1,100).setTranslation(0,-.1,0));
    physics.createCollider(RAPIER.ColliderDesc.cuboid(10,2,.1).setTranslation(0,2,-10));
    const body=physics.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0,.905,0));
    const collider=physics.createCollider(RAPIER.ColliderDesc.capsule(.54,.34),body);
    const controller=physics.createCharacterController(.025);controller.enableAutostep(.32,.2,false);controller.enableSnapToGround(.38);
    const game={physics,body,collider,controller,keys:new Set(['KeyW','ShiftLeft']),pressedAt:new Map(),
      yaw:0,pitch:0,velocity:new T.Vector3(),grounded:true,vertical:0,jumpQueued:false,jumps:0,
      previousPosition:new T.Vector3(),avatar:new T.Group(),actions:{},action:'Idle',airBones:{}};
    physics.step();
    try {
      for(let i=0;i<180;i++)CampusGame.prototype.step.call(game,1/60);
      assert(body.translation().z>-9.57 && body.translation().z<-9.4);
      assert(game.grounded);
      game.keys=new Set(['KeyS','ShiftLeft']);
      for(let i=0;i<120;i++)CampusGame.prototype.step.call(game,1/60);
      assert(body.translation().z>4.5);assert(game.grounded);
    } finally {physics.free();}
  });
  const result={passed:true,checks,limits:'Map transforms, outdoor candidates, real Rapier landing and movement, and travel retry logic. Live streaming and UI behavior are covered separately by browser evidence.'};
  writeFileSync('evidence/iteration-40-map-travel-check.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
} finally {world.free();mesh.geometry.dispose();mesh.material.dispose();}
