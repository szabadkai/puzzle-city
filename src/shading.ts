import * as THREE from 'three';
import { PALETTE_TEXTURE_WIDTH } from './palette';

/**
 * Uniforms shared by every standard material in the scene. Update the `value`
 * fields in place; each compiled program references these same objects.
 */
export const presentationUniforms = {
  uPalette: { value: null as THREE.Texture | null },
  /** Fog thins with height above this water level. */
  uFogFloor: { value: -.3 },
  uFogHeightFalloff: { value: .16 },
  uFogDesaturate: { value: .45 },
  CSM_cascades: { value: [new THREE.Vector2(0, 1), new THREE.Vector2(1, 1), new THREE.Vector2(1, 1)] },
  cameraNear: { value: .1 },
  shadowFar: { value: 100 },
};

let cascadeCount = 0;

/** Tells every standard material how many shadow cascades the scene renders. */
export function setShadowCascadeCount(count: number) {
  cascadeCount = count;
}

/** Marks a material whose vertex colour red channel is a palette slot index. */
export function usePaletteLookup<T extends THREE.Material>(material: T) {
  material.userData.paletteLookup = true;
  return material;
}

/** Encodes a palette slot as the vertex colour a palette-lookup material expects. */
export function paletteSlotColor(slot: number, target = new THREE.Color()) {
  return target.setRGB(slot / (PALETTE_TEXTURE_WIDTH - 1), 0, 0);
}

const PALETTE_LOOKUP = /* glsl */`
  diffuseColor.rgb *= texture2D( uPalette, vec2( ( vColor.r * ${(PALETTE_TEXTURE_WIDTH - 1).toFixed(1)} + 0.5 ) / ${PALETTE_TEXTURE_WIDTH.toFixed(1)}, 0.5 ) ).rgb;
`;

const FOG_PARS_VERTEX = /* glsl */`
#include <fog_pars_vertex>
varying float vLtWorldY;
`;

const FOG_VERTEX = /* glsl */`
#include <fog_vertex>
{
  vec4 ltWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    ltWorld = instanceMatrix * ltWorld;
  #endif
  ltWorld = modelMatrix * ltWorld;
  vLtWorldY = ltWorld.y;
}
`;

const FOG_PARS_FRAGMENT = /* glsl */`
#include <fog_pars_fragment>
varying float vLtWorldY;
uniform float uFogFloor;
uniform float uFogHeightFalloff;
uniform float uFogDesaturate;
`;

// Distance fog weighted by height: dense along the water, thinner over roofs.
// Far surfaces also lose saturation before they take the haze colour.
const FOG_FRAGMENT = /* glsl */`
#ifdef USE_FOG
  float ltDistanceFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  float ltHeight = exp( - max( vLtWorldY - uFogFloor, 0.0 ) * uFogHeightFalloff );
  float ltFog = clamp( ltDistanceFog * ( 0.5 + 0.5 * ltHeight ), 0.0, 1.0 );
  float ltLuma = dot( gl_FragColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3( ltLuma ), ltFog * uFogDesaturate );
  gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, ltFog );
#endif
`;

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

function injectPresentation(this: THREE.Material, shader: Shader) {
  Object.assign(shader.uniforms, presentationUniforms);
  if (cascadeCount > 0) {
    shader.fragmentShader = `#define USE_CSM 1\n#define CSM_CASCADES ${cascadeCount}\n#define CSM_FADE\n${shader.fragmentShader}`;
  }
  shader.vertexShader = shader.vertexShader
    .replace('#include <fog_pars_vertex>', FOG_PARS_VERTEX)
    .replace('#include <fog_vertex>', FOG_VERTEX);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', FOG_PARS_FRAGMENT)
    .replace('#include <fog_fragment>', FOG_FRAGMENT);
  if (this.userData.paletteLookup) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nuniform sampler2D uPalette;')
      .replace('#include <color_fragment>', PALETTE_LOOKUP);
  }
}

function presentationCacheKey(this: THREE.Material) {
  return `little-tides:${this.userData.paletteLookup ? 'palette' : 'plain'}:csm${cascadeCount}`;
}

/**
 * Installs the shared shader additions on every standard material. Materials are
 * created in many modules, so the hook lives on the prototype instead of at
 * each creation site.
 */
export function installPresentationShading() {
  THREE.MeshStandardMaterial.prototype.onBeforeCompile = injectPresentation;
  THREE.MeshStandardMaterial.prototype.customProgramCacheKey = presentationCacheKey;
}
