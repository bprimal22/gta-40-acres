import * as THREE from 'three';

/** GDC-only glazing. The depth cue is a shallow, generic shaded room box, not
 * a photographed interior or a navigable room. Real mullions remain geometry.
 * The exterior sky reflection still comes from the scene's physical lighting.
 */
export function createGdcGlazing(name: string) {
  const material = new THREE.MeshPhysicalMaterial({
    color: 0x647575, roughness: .105, metalness: 0, ior: 1.52,
    clearcoat: 0, envMapIntensity: 1.65,
  });
  material.name = name;
  material.onBeforeCompile = shader => {
    shader.vertexShader = `
      attribute vec2 gdcWindowUV;
      attribute vec2 gdcWindowSize;
      attribute vec3 gdcWindowAxis;
      attribute vec3 gdcWindowOut;
      attribute float gdcWindowSeed;
      varying vec2 vGdcWindowUV;
      varying vec2 vGdcWindowSize;
      varying vec3 vGdcWindowEye;
      varying float vGdcWindowSeed;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vec3 gdcEye = cameraPosition - (modelMatrix * vec4(transformed, 1.0)).xyz;
      vGdcWindowUV = gdcWindowUV;
      vGdcWindowSize = gdcWindowSize;
      vGdcWindowSeed = gdcWindowSeed;
      vGdcWindowEye = vec3(dot(gdcEye, gdcWindowAxis), gdcEye.y, dot(gdcEye, gdcWindowOut));
    `);
    shader.fragmentShader = `
      varying vec2 vGdcWindowUV;
      varying vec2 vGdcWindowSize;
      varying vec3 vGdcWindowEye;
      varying float vGdcWindowSeed;
      float gdcGlassHash(float p) { return fract(sin(p * 127.13) * 43758.5453); }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `
      #include <color_fragment>
      // Project the eye ray through this particular field into an enclosed box.
      // Ceilings and jambs slide with the eye, unlike a painted dark rectangle.
      vec2 gdcSize = max(vGdcWindowSize, vec2(.05));
      vec2 gdcRoomXY = (vGdcWindowUV - .5) * gdcSize;
      vec3 gdcView = normalize(vGdcWindowEye);
      vec3 gdcRay = vec3(-gdcView.xy, -max(abs(gdcView.z), .04));
      vec2 gdcWallLimit = mix(-.5 * gdcSize, .5 * gdcSize, step(vec2(0.0), gdcRay.xy));
      vec2 gdcSafeXY = sign(gdcRay.xy + vec2(.0000001)) * max(abs(gdcRay.xy), vec2(.0001));
      vec2 gdcSideT = max((gdcWallLimit - gdcRoomXY) / gdcSafeXY, vec2(.0));
      float gdcSeed = gdcGlassHash(vGdcWindowSeed);
      float gdcDepth = 1.2 + gdcSeed * .7;
      float gdcBackT = -gdcDepth / gdcRay.z;
      float gdcT = min(gdcBackT, min(gdcSideT.x, gdcSideT.y));
      vec3 gdcHit = vec3(gdcRoomXY, 0.0) + gdcRay * gdcT;
      float gdcSide = 1.0 - step(gdcBackT - .001, gdcT);
      float gdcCeiling = gdcSide * step(gdcSideT.y, gdcSideT.x) * step(0.0, gdcRay.y);
      float gdcFloor = gdcSide * step(gdcSideT.y, gdcSideT.x) * step(gdcRay.y, 0.0);
      // No exterior diffuse sun on the shaded interior. These linear levels
      // approximate dark rooms and softly lit ceilings visible in STG photos.
      vec3 gdcInterior = mix(vec3(.025,.031,.030), vec3(.042,.046,.040), gdcSeed);
      gdcInterior *= mix(1.0, .65, gdcSide);
      gdcInterior = mix(gdcInterior, vec3(.115,.116,.101), gdcCeiling * .85);
      gdcInterior = mix(gdcInterior, vec3(.016,.020,.019), gdcFloor);
      float gdcRearShadow = smoothstep(-gdcDepth, -.05, gdcHit.z);
      gdcInterior *= .7 + .3 * gdcRearShadow;
      // A minority of fields have pale blinds at varying heights, as in the
      // courtyard photos. Their slats fade out before becoming pixel noise.
      float gdcBlindBottom = .67 + gdcGlassHash(vGdcWindowSeed + 4.1) * .22;
      float gdcBlind = step(.69, gdcSeed) * smoothstep(gdcBlindBottom - .006, gdcBlindBottom + .006, vGdcWindowUV.y);
      float gdcSlatY = vGdcWindowUV.y * gdcSize.y / .035;
      float gdcSlatFade = 1.0 - smoothstep(.25, .75, fwidth(gdcSlatY));
      float gdcSlat = .82 + .18 * smoothstep(.12, .24, fract(gdcSlatY)) * gdcSlatFade;
      gdcInterior = mix(gdcInterior, vec3(.12,.119,.101) * gdcSlat, gdcBlind);
      diffuseColor.rgb = gdcInterior;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // Keep the ordinary physical specular response, but avoid treating the
      // unseen interior as an opaque painted wall lit by exterior direct sun.
      float gdcFacing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
      float gdcFresnel = .04 + .96 * pow(1.0 - gdcFacing, 5.0);
      outgoingLight = gdcInterior * (1.0 - gdcFresnel) + totalSpecular;
      #include <opaque_fragment>
    `);
  };
  material.customProgramCacheKey = () => 'gdc-recessed-glazing-v1';
  return material;
}

/** Attach per-field dimensions before applying the facade's campus matrix.
 * This changes only shading attributes, never vertex positions or colliders.
 * x: west facade local horizontal; z: atrium cross-courtyard local horizontal.
 */
export function annotateGdcGlazing(geometry: THREE.BufferGeometry,
  horizontal: 'x' | 'z', axis: THREE.Vector3, outward: THREE.Vector3, seed: number,
  subdivisions = 1) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox!, p = geometry.attributes.position;
  const lo = horizontal === 'x' ? bounds.min.x : bounds.min.z;
  const fullWidth = (horizontal === 'x' ? bounds.max.x : bounds.max.z) - lo;
  const sizeY = bounds.max.y - bounds.min.y;
  // For continuous atrium glazing, retain a coherent room behind each framed
  // group instead of creating discontinuities through one unsplit triangle.
  const roomWidth = fullWidth / Math.max(1, subdivisions);
  const uv = new Float32Array(p.count * 2), size = new Float32Array(p.count * 2);
  const axes = new Float32Array(p.count * 3), outs = new Float32Array(p.count * 3);
  const seeds = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) {
    const h = horizontal === 'x' ? p.getX(i) : p.getZ(i);
    uv.set([(h - lo) / fullWidth, (p.getY(i) - bounds.min.y) / sizeY], i * 2);
    size.set([roomWidth, sizeY], i * 2);
    axes.set(axis.toArray(), i * 3); outs.set(outward.toArray(), i * 3); seeds[i] = seed;
  }
  geometry.setAttribute('gdcWindowUV', new THREE.BufferAttribute(uv, 2));
  geometry.setAttribute('gdcWindowSize', new THREE.BufferAttribute(size, 2));
  geometry.setAttribute('gdcWindowAxis', new THREE.BufferAttribute(axes, 3));
  geometry.setAttribute('gdcWindowOut', new THREE.BufferAttribute(outs, 3));
  geometry.setAttribute('gdcWindowSeed', new THREE.BufferAttribute(seeds, 1));
}
