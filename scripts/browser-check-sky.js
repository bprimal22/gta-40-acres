// Execute through agent-browser eval --stdin in the local Vite browser.
// This creates a separate tiny renderer; it never changes the game or player.
// The browser driver's evaluate call awaits this returned promise.
// oxlint-disable-next-line typescript/no-floating-promises
(async () => {
  const THREE = await import('/node_modules/three/build/three.module.js');
  const { Sky } = await import('/node_modules/three/examples/jsm/objects/Sky.js');
  const { createSkyEnvironment } = await import('/lib/campus/sky-environment.ts');
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setSize(32, 32);
  const sky = new Sky();
  sky.scale.setScalar(10000);
  sky.material.uniforms.turbidity.value = 2.3;
  sky.material.uniforms.rayleigh.value = 1.5;
  sky.material.uniforms.mieCoefficient.value = 0.003;
  sky.material.uniforms.mieDirectionalG.value = 0.8;
  sky.material.uniforms.sunPosition.value.set(80, 105, 45);
  const originalDisc = sky.material.uniforms.showSunDisc.value;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x888888, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  sun.position.set(1, 2, 3);
  scene.add(sun);
  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xcc8844, roughness: 0.8 }),
  );
  scene.add(cube);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(0, 0, 3);
  const target = new THREE.WebGLRenderTarget(32, 32);
  const sample = () => {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const rgba = new Uint8Array(4);
    renderer.readRenderTargetPixels(target, 16, 16, 1, 1, rgba);
    return Array.from(rgba);
  };
  const inspect = (environment) => {
    const halfFloats = new Uint16Array(environment.width * environment.height * 4);
    renderer.readRenderTargetPixels(environment, 0, 0, environment.width, environment.height, halfFloats);
    let nonFinite = 0;
    for (const value of halfFloats) if ((value & 0x7c00) === 0x7c00) nonFinite++;
    scene.environment = environment.texture;
    scene.environmentIntensity = 0.25;
    return { nonFiniteHalfFloats: nonFinite, rgba: sample() };
  };
  const baseline = sample();
  const oldScene = new THREE.Scene();
  oldScene.add(sky.clone());
  const oldPmrem = new THREE.PMREMGenerator(renderer);
  const oldEnvironment = oldPmrem.fromScene(oldScene, 0.035, 0.1, 20000);
  const before = inspect(oldEnvironment);
  const environment = createSkyEnvironment(renderer, sky);
  const after = inspect(environment);
  const visibleSunUnchanged = sky.material.uniforms.showSunDisc.value === originalDisc;
  const gl = renderer.getContext();
  const debug = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = debug ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL) : 'Unavailable';
  oldEnvironment.dispose();
  oldPmrem.dispose();
  environment.dispose();
  target.dispose();
  cube.geometry.dispose();
  cube.material.dispose();
  sky.geometry.dispose();
  sky.material.dispose();
  renderer.dispose();
  if (after.nonFiniteHalfFloats || after.rgba.slice(0, 3).every(v => v === 0) || !visibleSunUnchanged)
    throw Error('Sky environment regression: invalid lighting or changed visible sun');
  return { gpu, baseline, before, after, visibleSunUnchanged,
    limits: 'Small real WebGL material test. This does not prove campus visual quality or hardware performance.' };
})()
