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
  uTime: { value: 0 },
  /** Wind direction and speed in world units per second, shared by smoke, cloth, and water. */
  uWind: { value: new THREE.Vector2(.6, .25) },
};

let cascadeCount = 0;

/** Tells every standard material how many shadow cascades the scene renders. */
export function setShadowCascadeCount(count: number) {
  cascadeCount = count;
}

/** Marks a hanging or flying cloth material: its vertices sway with the wind in the shader. */
export function useClothSway<T extends THREE.Material>(material: T) {
  material.userData.cloth = true;
  return material;
}

/** Marks an emissive material that flickers like a flame. `amount` is the peak fraction. */
export function useFlicker<T extends THREE.Material>(material: T, amount: number) {
  material.userData.flicker = amount;
  return material;
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
varying vec3 vLtWorld;
uniform float uTime;
uniform vec2 uWind;
`;

const FOG_VERTEX = /* glsl */`
#include <fog_vertex>
{
  vec4 ltWorld = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    ltWorld = instanceMatrix * ltWorld;
  #endif
  ltWorld = modelMatrix * ltWorld;
  vLtWorld = ltWorld.xyz;
}
`;

// Cloth hangs from its top edge or flies from its left edge; the free corners move most.
const CLOTH_SWAY = /* glsl */`
#include <begin_vertex>
{
  float ltFree = clamp( ( 1.0 - uv.y ) * 0.7 + uv.x * 0.5, 0.0, 1.0 );
  float ltPhase = dot( modelMatrix[ 3 ].xz, vec2( 1.7, 2.3 ) );
  float ltSpeed = length( uWind );
  float ltWave = sin( uTime * ( 2.2 + ltSpeed * 1.5 ) + ltPhase + position.y * 4.0 ) * 0.5
    + sin( uTime * 3.7 + ltPhase * 1.3 + position.x * 5.0 ) * 0.3;
  vec3 ltWindDir = vec3( uWind.x, 0.0, uWind.y );
  vec3 ltLocalWind = ( inverse( mat3( modelMatrix ) ) * ltWindDir );
  transformed += ltLocalWind * ltFree * ( 0.05 + ltWave * 0.06 );
  transformed.y -= ltFree * ltFree * abs( ltWave ) * 0.025 * ltSpeed;
}
`;

const FOG_PARS_FRAGMENT = /* glsl */`
#include <fog_pars_fragment>
varying vec3 vLtWorld;
uniform float uFogFloor;
uniform float uFogHeightFalloff;
uniform float uFogDesaturate;
uniform float uTime;
`;

const FLICKER = /* glsl */`
#include <emissivemap_fragment>
{
  float ltSeed = fract( sin( dot( floor( vLtWorld * 2.0 ), vec3( 12.9898, 78.233, 37.719 ) ) ) * 43758.5453 );
  float ltFlicker = sin( uTime * ( 2.6 + ltSeed * 2.0 ) + ltSeed * 40.0 ) * 0.6 + sin( uTime * 7.1 + ltSeed * 90.0 ) * 0.4;
  totalEmissiveRadiance *= 1.0 + ltFlicker * LT_FLICKER;
}
`;

// Distance fog weighted by height: dense along the water, thinner over roofs.
// Far surfaces also lose saturation before they take the haze colour.
const FOG_FRAGMENT = /* glsl */`
#ifdef USE_FOG
  float ltDistanceFog = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
  float ltHeight = exp( - max( vLtWorld.y - uFogFloor, 0.0 ) * uFogHeightFalloff );
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
  if (this.userData.cloth) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', CLOTH_SWAY);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', FOG_PARS_FRAGMENT)
    .replace('#include <fog_fragment>', FOG_FRAGMENT);
  const flicker = this.userData.flicker as number | undefined;
  if (flicker) {
    shader.fragmentShader = `#define LT_FLICKER ${flicker.toFixed(3)}\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', FLICKER);
  }
  if (this.userData.paletteLookup) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nuniform sampler2D uPalette;')
      .replace('#include <color_fragment>', PALETTE_LOOKUP);
  }
}

function presentationCacheKey(this: THREE.Material) {
  return `little-tides:${this.userData.paletteLookup ? 'palette' : 'plain'}:csm${cascadeCount}:cloth${this.userData.cloth ? 1 : 0}:flicker${this.userData.flicker ?? 0}`;
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
