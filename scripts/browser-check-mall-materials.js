// Isolated visual fixture executed through agent-browser eval --stdin.
// Uses the real authored meshes/materials and game lighting; makes no tile
// requests and never changes the game's character, camera, or physics.
// oxlint-disable-next-line typescript/no-floating-promises
(async () => {
  const T = await import('/node_modules/three/build/three.module.js');
  const { Sky } = await import('/node_modules/three/examples/jsm/objects/Sky.js');
  const { buildCentralMalls } = await import('/lib/campus/central-malls.ts');
  const { createSkyEnvironment } = await import('/lib/campus/sky-environment.ts');
  const { Terrain } = await import('/lib/campus/terrain.ts');
  const terrain = new Terrain(await (await fetch('/data/terrain.json')).json());
  const renderer = new T.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(1280, 720); renderer.toneMapping = T.ACESFilmicToneMapping; renderer.toneMappingExposure = .88;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = T.PCFShadowMap;
  const map = await new T.TextureLoader().loadAsync('/assets/concrete-diff.jpg');
  map.colorSpace = T.SRGBColorSpace; map.wrapS = map.wrapT = T.RepeatWrapping; map.anisotropy = 8;
  const concrete = new T.MeshStandardMaterial({ map }), grass = new T.MeshStandardMaterial({ color: 0x596647, roughness: 1 });
  const mall = buildCentralMalls(() => 3.05, (x,z) => terrain.height(x,z), concrete, grass);
  const scene = new T.Scene(); scene.add(...mall.meshes);
  const sky = new Sky(); sky.scale.setScalar(10000);
  for (const [key, value] of Object.entries({ turbidity: 2.3, rayleigh: 1.5, mieCoefficient: .003, mieDirectionalG: .8 })) sky.material.uniforms[key].value = value;
  sky.material.uniforms.sunPosition.value.set(80,105,45); scene.add(sky);
  scene.add(new T.HemisphereLight(0xc9e7ff, 0x665e44, .85));
  const sun = new T.DirectionalLight(0xfff0d6, 3.3);
  sun.position.set(-48,120,98); sun.target.position.set(-128,15,53);
  sun.castShadow = true; sun.shadow.mapSize.set(2048,2048);
  Object.assign(sun.shadow.camera, { left:-40, right:40, top:40, bottom:-40, near:1, far:220 });
  sun.shadow.camera.updateProjectionMatrix(); sun.shadow.normalBias=.008; sun.shadow.bias=-.000015;
  scene.add(sun,sun.target);
  const environment = createSkyEnvironment(renderer,sky); scene.environment=environment.texture; scene.environmentIntensity=.25;
  const camera = new T.PerspectiveCamera(55,1280/720,.1,20000);
  const views = [];
  for (const {name, position, target} of [
    {name:'sphere-approach',position:[-94,14.3,60],target:[-126,16,52]},
    {name:'tower-stair',position:[-157,18.2,48.8],target:[-176,18.2,47.2]},
  ]) {
    camera.position.set(...position);camera.lookAt(...target);renderer.render(scene,camera);
    const gl = renderer.getContext(), pixel = new Uint8Array(4); gl.readPixels(640,160,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
    if(pixel.slice(0,3).every(x=>x===0))throw Error('Material fixture unexpectedly black');
    views.push({ name, png:renderer.domElement.toDataURL('image/png'), sample:Array.from(pixel) });
  }
  for(const mesh of mall.meshes)mesh.geometry.dispose();
  for(const material of [...mall.materials,concrete,grass])material.dispose();
  map.dispose();environment.dispose();sky.geometry.dispose();sky.material.dispose();renderer.dispose();
  return {views,stats:mall.stats,limits:'Isolated authored-geometry fixture; excludes streamed buildings and vegetation. Not a gameplay or full-scene realism acceptance capture.'};
})()
