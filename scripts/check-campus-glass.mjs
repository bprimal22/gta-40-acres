import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname } from 'node:path';
import ts from 'typescript';
import * as T from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// This check exercises the live shader hooks and reflection owner. Only GPU
// compilation/drawing/filtering are fixtures; a browser must validate pixels.
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
const { createCampusGlass } = await import('../lib/campus/campus-glass.ts');
const { CampusLocalReflection } = await import('../lib/campus/local-reflection.ts');
const { CampusAmbientOcclusion } = await import('../lib/campus/ambient-occlusion.ts');
const checks = [];
function check(name, fn) {
  try { const details = fn(); checks.push({ name, passed: true, details }); }
  catch (error) { checks.push({ name, passed: false, error: error.message }); }
}
function assemble(material, renderer) {
  const source = material.isShaderMaterial ? material : T.ShaderLib.physical;
  const shader = { vertexShader: source.vertexShader, fragmentShader: source.fragmentShader,
    uniforms: T.UniformsUtils.clone(source.uniforms) };
  material.onBeforeCompile(shader, renderer);
  return shader;
}
function assertCustomIdentifiersDeclared(shader) {
  // Focus on our injected names, not Three's include/preprocessor language.
  // This catches the actual campusGlassInteriorSignal typo that tsc missed.
  for (const stage of ['vertexShader', 'fragmentShader']) {
    const text = shader[stage].replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    const declared = new Set([...text.matchAll(/\b(?:float|bool|int|vec[234]|mat[234])\s+([^;{}()]+)/g)]
      .flatMap(match => match[1].split(',').map(part => part.trim().match(/^([A-Za-z_]\w*)/)?.[1])));
    for (const token of text.match(/\b(?:campus|vCampus)[A-Z]\w*\b/g) ?? []) {
      assert(declared.has(token), `${stage}: undeclared custom identifier ${token}`);
    }
  }
}

function fixture({ ao = false, explicit = false, parallel = true } = {}) {
  const scene = new T.Scene(); scene.environmentIntensity = .25;
  const sky = new Sky(); scene.add(sky);
  const initialSunDisc = sky.material.uniforms.showSunDisc.value;
  const previous = explicit ? new T.Texture() : null;
  const glass = createCampusGlass({ name: 'Regression glass', envMap: previous, envMapIntensity: 1.65 });
  const mesh = new T.Mesh(new T.PlaneGeometry(2, 3), glass); scene.add(mesh);
  const excluded = [new T.Group(), new T.Group()]; excluded[1].visible = false;
  for (const object of excluded) {
    object.add(new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial())); scene.add(object);
  }
  const hidden = new T.Mesh(new T.BoxGeometry(), new T.MeshBasicMaterial()); hidden.visible = false; scene.add(hidden);
  const initialTarget = new T.WebGLRenderTarget(4, 4), mainTarget = ao ? new T.WebGLRenderTarget(8, 8) : null;
  const properties = new WeakMap(), calls = { compile: [], render: [], polls: 0, links: 0 };
  const renderer = {
    coordinateSystem: T.WebGLCoordinateSystem, toneMapping: T.ACESFilmicToneMapping, toneMappingExposure: .88,
    xr: { enabled: true }, shadowMap: { autoUpdate: true, needsUpdate: true }, autoClear: false,
    target: initialTarget, face: 2, mip: 1, ready: false, linked: true, throwRender: false,
    extensions: { has: name => name === 'KHR_parallel_shader_compile' && parallel },
    getRenderTarget() { return this.target; }, getActiveCubeFace() { return this.face; }, getActiveMipmapLevel() { return this.mip; },
    setRenderTarget(target, face = 0, mip = 0) { this.target = target; this.face = face; this.mip = mip; },
    properties: { get: material => properties.get(material) ?? {} },
    getContext() { return { LINK_STATUS: 0x8b82, getProgramParameter: (program, parameter) => {
      assert.equal(parameter, 0x8b82); calls.links++; return program.linked;
    } }; },
    compile(group, camera, targetScene) {
      assert.equal(targetScene, scene); assert(camera.isCamera);
      const call = { target: this.target, toneMapping: this.toneMapping, materials: [], shaders: [], programs: [] };
      calls.compile.push(call);
      group.traverse(object => {
        if (!object.material) return;
        for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
          const shader = assemble(material, renderer); assertCustomIdentifiersDeclared(shader);
          const record = { material, disposed: 0 };
          material.addEventListener('dispose', () => { record.disposed++; properties.delete(material); });
          const program = { program: { linked: renderer.linked }, isReady() {
            assert.equal(record.disposed, 0, 'Never poll disposed compile material'); calls.polls++; return renderer.ready;
          } };
          call.materials.push(record); call.shaders.push(shader); call.programs.push(program);
          properties.set(material, { currentProgram: program });
        }
      });
      return new Set(call.materials.map(record => record.material));
    },
    render(targetScene, camera) {
      assert.equal(targetScene, scene); assert(camera.isCamera);
      assert(excluded.every(object => !object.visible));
      assert.equal(sky.material.uniforms.showSunDisc.value, false);
      assert.equal(scene.userData.campusLinearCapture.value, true);
      assert.equal(this.toneMapping, T.NoToneMapping);
      assert.equal(this.xr.enabled, false); assert.equal(this.shadowMap.autoUpdate, false); assert.equal(this.shadowMap.needsUpdate, false);
      assert.equal(this.autoClear, true);
      calls.render.push({ face: this.face, cube: this.target });
      if (this.throwRender) throw new Error('Fixture capture failure');
    },
  };
  const reflection = new CampusLocalReflection(renderer, scene, sky, excluded, [glass], mainTarget);
  if (ao) {
    // Exercise the actual wrapper without constructing the unrelated GTAO GPU pipeline.
    CampusAmbientOcclusion.prototype.prepareMaterials.call({ pipelineRequested: true, scene, renderer });
  }
  const player = new T.Vector3(-3, 8, -5);
  const tick = now => reflection.update(player, now);
  const start = () => { tick(1); tick(1802); assert.equal(reflection.snapshot().state, 'compiling'); };
  const readyForCapture = () => { renderer.ready = true; tick(1803); assert.equal(reflection.snapshot().state, 'capturing'); };
  const restoreState = () => {
    assert.equal(renderer.target, initialTarget); assert.equal(renderer.face, 2); assert.equal(renderer.mip, 1);
    assert.equal(renderer.toneMapping, T.ACESFilmicToneMapping); assert.equal(renderer.xr.enabled, true);
    assert.equal(renderer.shadowMap.autoUpdate, true); assert.equal(renderer.shadowMap.needsUpdate, true);
    assert.equal(renderer.autoClear, false); assert.deepEqual(excluded.map(object => object.visible), [true, false]);
    assert.equal(sky.material.uniforms.showSunDisc.value, initialSunDisc); assert.equal(scene.userData.campusLinearCapture.value, false);
  };
  const cleanup = () => {
    reflection.dispose(); initialTarget.dispose(); mainTarget?.dispose(); previous?.dispose();
    scene.traverse(object => { object.geometry?.dispose();
      for (const material of object.material ? (Array.isArray(object.material) ? object.material : [object.material]) : []) material.dispose();
    });
  };
  return { scene, sky, glass, previous, renderer, reflection, calls, mainTarget, player, tick, start, readyForCapture, restoreState, cleanup };
}

const pmremDescriptor = Object.getOwnPropertyDescriptor(T.PMREMGenerator.prototype, 'fromCubemap');
const filters = [];
const originalTimeout = globalThis.setTimeout;
let scheduledCallbacks = 0;
try {
  T.PMREMGenerator.prototype.fromCubemap = function (cube) {
    assert(cube.isCubeTexture);
    const target = new T.WebGLRenderTarget(384, 512, { type: T.HalfFloatType, depthBuffer: false });
    target.texture.mapping = T.CubeUVReflectionMapping;
    const record = { target, disposed: 0 }; filters.push(record);
    target.addEventListener('dispose', () => record.disposed++);
    return target;
  };
  // A reflection owner must not schedule teardown-sensitive hidden callbacks.
  globalThis.setTimeout = (...args) => { scheduledCallbacks++; return originalTimeout(...args); };

  check('Real physical shader hooks declare their injected identifiers; prior GLSL typo is detectable', () => {
    const f = fixture();
    try {
      const shader = assemble(f.glass, f.renderer); assertCustomIdentifiersDeclared(shader);
      assert(shader.fragmentShader.includes('textureCubeUV( envMap, envMapRotation * reflectVec, roughness )'));
      assert(shader.fragmentShader.includes('outgoingLight = totalSpecular + campusInterior'));
      assert.throws(() => assertCustomIdentifiersDeclared({ ...shader,
        fragmentShader: shader.fragmentShader.replace('1.+campusInteriorSignal*', '1.+campusGlassInteriorSignal*'),
      }), /undeclared custom identifier campusGlassInteriorSignal/);
      assert.equal(f.glass.transparent, false); assert.equal(f.glass.depthWrite, true);
      return { actualShader: 'Three ShaderLib.physical + live glass/probe hooks', gpuCompilation: false };
    } finally { f.cleanup(); }
  });

  check('Nonready compile cannot capture; disposing it stops polling and releases copies exactly once', () => {
    const f = fixture();
    try {
      f.start(); f.restoreState(); f.tick(1803); f.tick(1820);
      assert.equal(f.reflection.snapshot().state, 'compiling'); assert.equal(f.calls.render.length, 0);
      assert.equal(f.calls.compile[0].materials.length, 2, 'Only visible authored sky and glass enter warmup');
      assert(f.calls.compile[0].materials.every(record => record.material !== f.glass));
      const polls = f.calls.polls; f.reflection.dispose(); f.renderer.ready = true; f.tick(9999); f.reflection.dispose();
      assert.equal(f.calls.polls, polls); assert.equal(f.reflection.snapshot().state, 'disposed');
      assert(f.calls.compile[0].materials.every(record => record.disposed === 1));
      assert.equal(scheduledCallbacks, 0);
      return { compiledObjects: 2, pendingPolls: polls, callbacksScheduled: 0 };
    } finally { f.cleanup(); }
  });

  for (const ao of [false, true]) for (const explicit of [false, true]) {
    check(`${ao ? 'AO offscreen' : 'Direct'} lifecycle and ${explicit ? 'explicit-map' : 'scene-sky'} reflection intensity`, () => {
      const f = fixture({ ao, explicit });
      try {
        const shaders = [assemble(f.glass, f.renderer), assemble(f.glass, f.renderer)];
        assert.equal(shaders[0].uniforms.campusProbeActive, shaders[1].uniforms.campusProbeActive);
        if (ao) {
          assert.equal(shaders[0].uniforms.campusLinearCapture, f.scene.userData.campusLinearCapture);
          assert.equal(shaders[1].uniforms.campusLinearCapture, shaders[0].uniforms.campusLinearCapture);
          assert(shaders[0].fragmentShader.includes('if(!campusLinearCapture)gl_FragColor.rgb = ACESFilmicToneMapping'));
        }
        f.start(); f.readyForCapture();
        for (let face = 0; face < 6; face++) { f.tick(1900 + face); f.restoreState(); }
        assert.deepEqual(f.calls.render.map(call => call.face), [0, 1, 2, 3, 4, 5]);
        f.renderer.ready = false; f.tick(2000); f.restoreState();
        assert.equal(f.reflection.snapshot().state, 'filtering');
        assert.equal(f.calls.compile[1].target, f.mainTarget, 'Final shader uses the actual direct/AO target');
        assert(f.calls.compile[0].materials.every(record => record.disposed === 1));
        assert(f.calls.compile[1].materials.every(record => record.disposed === 0));
        f.tick(2010); assert.equal(f.reflection.snapshot().state, 'filtering');
        f.renderer.ready = true; f.tick(2020); assert.equal(f.reflection.snapshot().state, 'ready');
        const expected = explicit ? 1.65 : .25;
        assert.equal(f.glass.envMapIntensity, expected); assert.equal(shaders[0].uniforms.campusProbeActive.value, 1);
        assert.equal(shaders[1].uniforms.campusProbeActive.value, 1);
        const filtered = filters.at(-1); assert.equal(f.glass.envMap, filtered.target.texture);
        f.reflection.setEnabled(false); assert.equal(f.glass.envMap, f.previous);
        assert.equal(f.glass.envMapIntensity, 1.65); assert.equal(shaders[0].uniforms.campusProbeActive.value, 0);
        f.reflection.setEnabled(true); assert.equal(f.glass.envMapIntensity, expected);
        assert.equal(shaders[1].uniforms.campusProbeActive.value, 1);
        f.tick(90000); assert(f.calls.compile[1].materials.every(record => record.disposed === 0), 'Keep final programs until actual owner teardown');
        f.reflection.dispose(); assert.equal(filtered.disposed, 1);
        assert(f.calls.compile[1].materials.every(record => record.disposed === 1));
        assert.equal(f.glass.envMap, f.previous); assert.equal(f.glass.envMapIntensity, 1.65);
        return { faces: 6, shaderPhases: 2, effectiveLocalIntensity: expected, stableUniformVariants: 2, renderTarget: ao ? 'AO color' : 'default framebuffer' };
      } finally { f.cleanup(); }
    });
  }

  check('Capture exception restores target, sky, visibility, linear radiance, XR and shadow flags', () => {
    const f = fixture({ ao: true });
    try {
      f.start(); f.readyForCapture(); f.renderer.throwRender = true; f.tick(1900);
      assert.equal(f.reflection.snapshot().state, 'failed'); assert.equal(f.reflection.snapshot().error, 'Error');
      f.restoreState(); assert(f.calls.compile[0].materials.every(record => record.disposed === 1));
      const draws = f.calls.render.length; f.tick(3000); assert.equal(f.calls.render.length, draws);
      return { throwsCaught: 1, scopedStateRestored: true };
    } finally { f.cleanup(); }
  });

  for (const phase of ['initial', 'final']) {
    check(`${phase} shader link failure never enables a broken reflection`, () => {
      const f = fixture();
      try {
        if (phase === 'initial') f.renderer.linked = false;
        f.start();
        if (phase === 'final') {
          f.readyForCapture(); for (let face = 0; face < 6; face++) f.tick(1900 + face);
          f.renderer.linked = false; f.tick(2000); assert.equal(f.reflection.snapshot().state, 'filtering');
        }
        f.renderer.ready = true; f.tick(2100);
        assert.equal(f.reflection.snapshot().state, 'failed'); assert.equal(f.glass.envMap, f.previous);
        assert(f.calls.links > 0); f.restoreState();
        assert(f.calls.compile.every(call => call.materials.every(record => record.disposed === 1)));
        return { phase, checkedLinkStatus: true, localMapEnabled: false };
      } finally { f.cleanup(); }
    });
  }

  check('Disposal during final warmup cancels owner polling and releases the filtered target', () => {
    const f = fixture();
    try {
      f.start(); f.readyForCapture(); for (let face = 0; face < 6; face++) f.tick(1900 + face);
      f.renderer.ready = false; f.tick(2000); f.tick(2001);
      const filtered = filters.at(-1), polls = f.calls.polls;
      f.reflection.dispose(); f.renderer.ready = true; f.tick(3000);
      assert.equal(f.calls.polls, polls); assert.equal(filtered.disposed, 1);
      assert.equal(f.reflection.snapshot().state, 'disposed'); assert.equal(scheduledCallbacks, 0);
      return { callbacksScheduled: 0, polledAfterDisposal: false, filteredTargetsDisposed: 1 };
    } finally { f.cleanup(); }
  });

  check('Missing parallel compilation capability is reported rather than inferred from ready state', () => {
    const f = fixture({ parallel: false });
    try { assert.equal(f.reflection.snapshot().parallelCompilation, false); return { reported: false }; }
    finally { f.cleanup(); }
  });
} finally {
  Object.defineProperty(T.PMREMGenerator.prototype, 'fromCubemap', pmremDescriptor);
  globalThis.setTimeout = originalTimeout;
}

const sourceFiles = ['lib/campus/campus-glass.ts', 'lib/campus/local-reflection.ts', 'lib/campus/ambient-occlusion.ts'];
const sources = Object.fromEntries(sourceFiles.map(path => [path,
  createHash('sha256').update(readFileSync(new URL(`../${path}`, import.meta.url))).digest('hex')]));
const result = { passed: checks.every(check => check.passed), threeRevision: T.REVISION,
  checks, sources, scheduledCallbacks,
  scope: 'Real shader assembly and owner lifecycle; renderer/program results and PMREM GPU filtering are controlled fixtures. This is not a GPU pixel or performance test.' };
const output = process.env.UT_GLASS_EVIDENCE ?? '/tmp/ut-iteration-54/glass-check.json';
mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify({ passed: result.passed, checks: checks.length, failures: checks.filter(check => !check.passed), evidence: output }));
if (!result.passed) process.exitCode = 1;
