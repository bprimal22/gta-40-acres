import * as THREE from 'three';
import type { Sky } from 'three/addons/objects/Sky.js';

/** Diffuse sky illumination; direct sunlight is supplied by DirectionalLight. */
export function createSkyEnvironment(renderer: THREE.WebGLRenderer, sky: Sky) {
  const lightingSky = sky.clone();
  // Mesh.clone shares materials. Clone this separately so the visible sky keeps
  // its sun disc. The disc exceeds the half-float PMREM range on SwiftShader;
  // Infinity then spreads through filtering and makes lit materials black.
  lightingSky.material = sky.material.clone();
  lightingSky.material.uniforms.showSunDisc.value = false;
  const source = new THREE.Scene();
  source.add(lightingSky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  try {
    return pmrem.fromScene(source, 0.035, 0.1, 20000);
  } finally {
    pmrem.dispose();
    lightingSky.material.dispose();
    // The visible sky owns the shared geometry. The caller owns the returned
    // render target, including its framebuffer and environment texture.
  }
}
