import * as THREE from 'three';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Local contact shading from the depth already written by the color render.
 * There is no second campus/foliage geometry pass. Lit surfaces retain their
 * existing ACES transform, while photographed unlit surfaces bypass it. AO
 * operates on display-linear color; OutputPass only encodes the final sRGB.
 */
export class CampusAmbientOcclusion {
  readonly color: THREE.WebGLRenderTarget;
  readonly composite: THREE.WebGLRenderTarget;
  readonly ao: GTAOPass;
  readonly output = new OutputPass();
  // Opt-in until repeated resize/overview transitions are reliable on Metal.
  // The default uses Three's direct antialiased renderer, as before this pass.
  private readonly pipelineRequested = new URLSearchParams(location.search).get('occlusion') === 'on';
  enabled = this.pipelineRequested;
  readonly resolutionScale = .75;
  private readonly size = new THREE.Vector2();
  private applied = false;
  private patchedMaterials = 0;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
  ) {
    const depth = new THREE.DepthTexture(1, 1, THREE.UnsignedIntType);
    this.color = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthTexture: depth,
      samples: Math.min(4, renderer.capabilities.maxSamples),
    });
    this.color.texture.name = 'Campus display-linear color and shared depth';
    this.composite = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType, depthBuffer: false,
    });
    // r185 expects its internal normal target to exist for setSize/dispose,
    // even with external depth. Construct normally, then bind shared depth;
    // that unused normal target never renders or allocates a GPU framebuffer.
    this.ao = new GTAOPass(scene, camera, 1, 1);
    this.ao.setGBuffer(depth);
    this.ao.blendIntensity = .6;
    this.ao.updateGtaoMaterial({ radius: 1.2, thickness: .7, samples: 12, distanceFallOff: 1 });
    // Local contact detail fades away before the distant photographic context.
    this.ao.gtaoMaterial.defines.FRAGMENT_OUTPUT =
      'vec4(vec3(mix(1.0, ao, 1.0 - smoothstep(30.0, 65.0, -viewPos.z))), 1.0)';
    this.ao.updatePdMaterial({ radius: 5, samples: 8, rings: 2 });
    this.output.renderToScreen = true;
    this.resize();
  }

  /** Call after authored scenery and the avatar have loaded, before rendering.
   * Three normally omits per-material tone mapping for offscreen targets.
   * Keep it here for toneMapped materials, rather than applying ACES globally
   * to the photographed MeshBasicMaterials at the end of the pipeline.
   */
  prepareMaterials() {
    if (!this.pipelineRequested) return;
    const seen = new Set<THREE.Material>();
    this.scene.traverse(object => {
      const mesh = object as THREE.Mesh;
      if (!mesh.material) return;
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (const material of materials) {
        if (!material.toneMapped || seen.has(material)) continue;
        seen.add(material);
        const before = material.onBeforeCompile.bind(material), key = material.customProgramCacheKey();
        material.onBeforeCompile = (shader, renderer) => {
          before(shader, renderer);
          // Some materials delegate to another material's live shader hook
          // (the 24th/DKR asphalt does this). That hook may already be wrapped.
          if (shader.fragmentShader.includes('CAMPUS_DISPLAY_LINEAR')) return;
          if (!shader.fragmentShader.includes('#include <tonemapping_fragment>')) return;
          shader.uniforms.toneMappingExposure = { value: renderer.toneMappingExposure };
          shader.uniforms.campusLinearCapture = this.scene.userData.campusLinearCapture ?? {value:false};
          shader.fragmentShader = '#define CAMPUS_DISPLAY_LINEAR\nuniform bool campusLinearCapture;\n#ifndef TONE_MAPPING\n#include <tonemapping_pars_fragment>\n#endif\n' + shader.fragmentShader;
          shader.fragmentShader = shader.fragmentShader.replace('#include <tonemapping_fragment>', `
            #ifdef TONE_MAPPING
              #include <tonemapping_fragment>
            #else
              if(!campusLinearCapture)gl_FragColor.rgb = ACESFilmicToneMapping(gl_FragColor.rgb);
            #endif`);
        };
        material.customProgramCacheKey = () => `${key}-campus-display-linear-v3`;
        material.needsUpdate = true;
      }
    });
    this.patchedMaterials = seen.size;
  }

  get materialRenderTarget(){return this.pipelineRequested?this.color:null;}

  resize() {
    this.renderer.getDrawingBufferSize(this.size);
    const w = Math.max(1, this.size.x), h = Math.max(1, this.size.y);
    this.color.setSize(w, h);
    this.composite.setSize(w, h);
    this.ao.setSize(Math.max(1, Math.ceil(w * this.resolutionScale)), Math.max(1, Math.ceil(h * this.resolutionScale)));
  }

  render(allowOcclusion = true) {
    const renderer = this.renderer;
    if (!this.pipelineRequested) {
      this.applied = false;
      renderer.render(this.scene, this.camera);
      return;
    }
    const target = renderer.getRenderTarget(), autoReset = renderer.info.autoReset;
    const toneMapping = renderer.toneMapping;
    renderer.info.autoReset = false;
    renderer.info.reset();
    try {
      renderer.setRenderTarget(this.color);
      renderer.render(this.scene, this.camera);
      this.applied = this.enabled && allowOcclusion;
      if (this.applied) this.ao.render(renderer, this.composite, this.color, 0, false);
      renderer.toneMapping = THREE.NoToneMapping;
      this.output.render(renderer, this.composite, this.applied ? this.composite : this.color, 0, false);
    } finally {
      renderer.toneMapping = toneMapping;
      renderer.setRenderTarget(target);
      renderer.info.autoReset = autoReset;
    }
  }

  snapshot() {
    return {
      enabled: this.enabled, applied: this.applied,
      experimentalPipeline: this.pipelineRequested,
      method: 'GTAO from shared scene depth',
      radiusMeters: this.ao.gtaoMaterial.uniforms.radius.value,
      fadeDepthMeters: [30, 65],
      intensity: this.ao.blendIntensity,
      colorSize: [this.color.width, this.color.height],
      occlusionSize: [this.ao.width, this.ao.height],
      colorSamples: this.color.samples,
      sceneGeometryPasses: 1,
      toneMapping: 'Per lit material; photographed imagery bypasses ACES',
      patchedLitMaterials: this.patchedMaterials,
    };
  }

  dispose() {
    this.ao.dispose();
    // r185 GTAOPass.dispose omits these two owned shader materials.
    this.ao.gtaoMaterial.dispose();
    this.ao.blendMaterial.dispose();
    this.output.dispose();
    this.composite.dispose();
    this.color.dispose();
  }
}
