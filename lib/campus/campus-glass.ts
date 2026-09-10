import * as THREE from 'three';

export interface CampusGlassOptions {
  name?: string;
  /** Borrowed raw reflection cube or PMREM CubeUV texture. Null uses scene sky. */
  envMap?: THREE.Texture | null;
  envMapIntensity?: number;
  roughness?: number;
  ior?: number;
  /** Dark interior radiance in linear working space, not an sRGB hex color. */
  interiorLevel?: number;
  /** Fractional variation of the dark interior proxy, not reflection tint. */
  interiorVariation?: number;
}

function finiteRange(name: string, value: number, lo: number, hi: number) {
  if (!Number.isFinite(value) || value < lo || value > hi) {
    throw new Error(`Invalid campus glass ${name}: expected ${lo}..${hi}`);
  }
  return value;
}

/** Opaque architectural glass with the installed Three r185 dielectric BRDF.
 * Reflection is genuine environment sampling through Three's physical shader.
 * Only its exterior diffuse term is replaced by a modest dark interior proxy.
 * It does not create rooms, move vertices, discard pixels, or alter collision.
 * Environment targets are borrowed and must be disposed by their capture owner.
 */
export function createCampusGlass(options: CampusGlassOptions = {}) {
  const roughness = finiteRange('roughness', options.roughness ?? .10, .055, .45);
  const ior = finiteRange('ior', options.ior ?? 1.52, 1.1, 2.0);
  const intensity = finiteRange('environment intensity', options.envMapIntensity ?? 1.0, 0, 4);
  const interiorLevel = finiteRange('interior level', options.interiorLevel ?? .010, 0, .08);
  const interiorVariation = finiteRange('interior variation', options.interiorVariation ?? .16, 0, .35);
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness, metalness: 0, ior,
    specularColor: 0xffffff, specularIntensity: 1,
    clearcoat: 0, transmission: 0, thickness: 0,
    transparent: false, opacity: 1, depthWrite: true,
    envMap: options.envMap ?? null, envMapIntensity: intensity,
  });
  material.name = options.name ?? 'Campus physical exterior glass';
  const levelUniform = { value: interiorLevel };
  const variationUniform = { value: interiorVariation };

  material.onBeforeCompile = shader => {
    // Fail visibly if a future Three upgrade removes a required injection point.
    if (!shader.vertexShader.includes('#include <project_vertex>') ||
        !shader.fragmentShader.includes('#include <opaque_fragment>')) {
      throw new Error('Campus glass requires the Three physical shader injection points');
    }
    shader.uniforms.campusGlassInteriorLevel = levelUniform;
    shader.uniforms.campusGlassInteriorVariation = variationUniform;
    shader.vertexShader = 'varying vec3 vCampusGlassPoint;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      #include <project_vertex>
      vCampusGlassPoint = (modelMatrix * vec4(transformed, 1.0)).xyz;
    `);
    shader.fragmentShader = `
      varying vec3 vCampusGlassPoint;
      uniform float campusGlassInteriorLevel;
      uniform float campusGlassInteriorVariation;
      float campusGlassHash(vec2 p) {
        return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);
      }
      float campusGlassNoise(vec2 p) {
        vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
        return mix(mix(campusGlassHash(i),campusGlassHash(i+vec2(1.,0.)),f.x),
                   mix(campusGlassHash(i+vec2(0.,1.)),campusGlassHash(i+vec2(1.,1.)),f.x),f.y);
      }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // Three's totalSpecular already includes GGX and dielectric Fresnel.
      // Do not multiply it by a second hand-written Fresnel factor.
      float campusFacing = clamp(dot(normal,normalize(vViewPosition)),0.,1.);
      vec3 campusFresnel = F_Schlick(material.specularColor,material.specularF90,campusFacing);
      vec3 campusWorldNormal = transformNormalByInverseViewMatrix(normal,viewMatrix);
      vec2 campusAxis = vec2(campusWorldNormal.z,-campusWorldNormal.x);
      campusAxis /= max(length(campusAxis),.0001);
      vec2 campusInteriorPoint = vec2(dot(vCampusGlassPoint.xz,campusAxis),vCampusGlassPoint.y);
      // Low-frequency neutral variation suggests a shaded interior behind the
      // pane. It is not a photographed room or exterior building projection.
      float campusInteriorSignal = campusGlassNoise(campusInteriorPoint/vec2(1.8,1.15))*2.-1.;
      float campusInteriorFade = 1.-smoothstep(.25,1.0,max(fwidth(campusInteriorPoint.x),fwidth(campusInteriorPoint.y)));
      vec3 campusInterior = vec3(.96,1.02,1.0)*campusGlassInteriorLevel*
        (1.+campusInteriorSignal*campusGlassInteriorVariation*campusInteriorFade);
      outgoingLight = totalSpecular + campusInterior*(vec3(1.)-campusFresnel);
      #include <opaque_fragment>
    `);
  };
  // Parameters are uniforms or standard physical-material properties, so all
  // instances may share a program while keeping separate local environments.
  material.customProgramCacheKey = () => 'campus-physical-glass-r185-v1';
  return material;
}

/** Bind a caller-owned environment without altering global scene illumination.
 * Invoke once a static capture is ready. Rebinding does not dispose either map.
 */
export function setCampusGlassEnvironment(material: THREE.MeshPhysicalMaterial,
  envMap: THREE.Texture | null, intensity = material.envMapIntensity) {
  finiteRange('environment intensity', intensity, 0, 4);
  const changed = material.envMap !== envMap;
  material.envMap = envMap;
  material.envMapIntensity = intensity;
  if (changed) material.needsUpdate = true;
}
