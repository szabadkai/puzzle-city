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
  /** 0 hangs the washing out, 1 draws it fully in. Eased by the town during rain. */
  uClothRetract: { value: 0 },
  /** Simulation clock in absolute hours. Trees grow against it in the vertex shader. */
  uSimHours: { value: 0 },
  /** Fraction of homes that have switched their windows on, 0 by day and 1 at night. */
  uLightsOn: { value: 0 },
  /** 0 dry, 1 soaked. Upward faces darken and turn glossy. */
  uWetness: { value: 0 },
};

/** Hours a planted tree takes to reach full size. Mirrors `TREE_MATURE_HOURS`. */
const TREE_MATURE_HOURS = 72;

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

/** Marks foliage: the whole canopy leans gently with the wind in the vertex shader. */
export function useFoliageSway<T extends THREE.Material>(material: T) {
  material.userData.foliage = true;
  return material;
}

/** Marks window glass: each building switches on at its own moment around dusk. */
export function useWindowStagger<T extends THREE.Material>(material: T) {
  material.userData.windowStagger = true;
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
uniform float uSimHours;
// xyz: world pivot of a growing tree; w: birth hour + 1, negative for seats that appear late, 0 for no growth.
attribute vec4 aTreeGrowth;
// Per-building moment in the dusk ramp at which its windows light, 0 to 1.
attribute float aLightOffset;
varying float vLtLightOffset;
#ifdef LT_CLOTH
uniform float uClothRetract;
attribute float aRetractTop;
#endif
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
  vLtLightOffset = aLightOffset;
}
`;

// Cloth hangs from its top edge or flies from its left edge; the free corners move
// most. Cloth is merged town-wide, so the phase comes from the world position and
// rain retraction pulls every vertex toward its own top edge.
const CLOTH_SWAY = /* glsl */`
#include <begin_vertex>
{
  vec3 ltClothWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  float ltFree = clamp( ( 1.0 - uv.y ) * 0.7 + uv.x * 0.5, 0.0, 1.0 );
  float ltPhase = dot( floor( ltClothWorld.xz * 1.6 ), vec2( 1.7, 2.3 ) );
  float ltSpeed = length( uWind );
  float ltWave = sin( uTime * ( 2.2 + ltSpeed * 1.5 ) + ltPhase + ltClothWorld.y * 4.0 ) * 0.5
    + sin( uTime * 3.7 + ltPhase * 1.3 + ltClothWorld.x * 5.0 ) * 0.3;
  vec3 ltWindDir = vec3( uWind.x, 0.0, uWind.y );
  vec3 ltLocalWind = ( inverse( mat3( modelMatrix ) ) * ltWindDir );
  transformed += ltLocalWind * ltFree * ( 0.05 + ltWave * 0.06 );
  transformed.y -= ltFree * ltFree * abs( ltWave ) * 0.025 * ltSpeed;
  if ( aRetractTop > -100.0 ) transformed.y += ( aRetractTop - ltClothWorld.y ) * uClothRetract;
}
`;

// Trees scale up from their pivot as the simulation clock passes their birth hour.
const TREE_GROWTH = /* glsl */`
#include <begin_vertex>
if ( aTreeGrowth.w != 0.0 ) {
  float ltBorn = abs( aTreeGrowth.w ) - 1.0;
  float ltLinear = clamp( ( uSimHours - ltBorn ) / ${TREE_MATURE_HOURS.toFixed(1)}, 0.0, 1.0 );
  float ltProgress = ltLinear * ltLinear * ( 3.0 - 2.0 * ltLinear );
  vec3 ltScale = aTreeGrowth.w > 0.0
    ? vec3( 0.24 + ltProgress * 0.76, 0.32 + ltProgress * 0.68, 0.24 + ltProgress * 0.76 )
    : vec3( step( 0.82, ltProgress ) );
  vec3 ltWorldPos = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;
  ltWorldPos = aTreeGrowth.xyz + ( ltWorldPos - aTreeGrowth.xyz ) * ltScale;
  transformed = ( inverse( modelMatrix ) * vec4( ltWorldPos, 1.0 ) ).xyz;
}
`;

const FOLIAGE_SWAY = /* glsl */`
#include <begin_vertex>
{
  vec3 ltLeafWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  float ltPhase = dot( floor( ltLeafWorld.xz * 0.9 ), vec2( 2.1, 1.3 ) );
  float ltSpeed = length( uWind );
  float ltLean = sin( uTime * 1.25 + ltPhase ) * 0.6 + sin( uTime * 2.9 + ltPhase * 1.7 ) * 0.4;
  vec3 ltLocalWind = inverse( mat3( modelMatrix ) ) * vec3( uWind.x, 0.0, uWind.y );
  transformed += ltLocalWind * ( 0.02 + ltLean * 0.028 ) * clamp( ltLeafWorld.y * 0.35, 0.0, 1.0 );
}
`;

const FOG_PARS_FRAGMENT = /* glsl */`
#include <fog_pars_fragment>
varying vec3 vLtWorld;
uniform float uFogFloor;
uniform float uFogHeightFalloff;
uniform float uFogDesaturate;
uniform float uTime;
uniform float uLightsOn;
uniform float uWetness;
varying float vLtLightOffset;
`;

// Rain settles on roofs, quays, and decks: darker albedo, lower roughness.
const WET_SURFACES = /* glsl */`
#include <normal_fragment_maps>
{
  float ltUp = clamp( dot( normal, normalize( viewMatrix[ 1 ].xyz ) ), 0.0, 1.0 );
  float ltWet = uWetness * ltUp;
  roughnessFactor *= 1.0 - ltWet * 0.55;
  diffuseColor.rgb *= 1.0 - ltWet * 0.28;
}
`;

const WINDOW_STAGGER = /* glsl */`
#include <emissivemap_fragment>
totalEmissiveRadiance *= smoothstep( vLtLightOffset - 0.04, vLtLightOffset + 0.04, uLightsOn ) * 0.94 + 0.06;
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
  if (this.userData.cloth) shader.vertexShader = `#define LT_CLOTH\n${shader.vertexShader}`.replace('#include <begin_vertex>', CLOTH_SWAY);
  else if (this.userData.foliage) shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', FOLIAGE_SWAY);
  shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', TREE_GROWTH);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <fog_pars_fragment>', FOG_PARS_FRAGMENT)
    .replace('#include <fog_fragment>', FOG_FRAGMENT);
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', WET_SURFACES);
  if (this.userData.windowStagger) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', WINDOW_STAGGER);
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
  return `little-tides:${this.userData.paletteLookup ? 'palette' : 'plain'}:csm${cascadeCount}:cloth${this.userData.cloth ? 1 : 0}:foliage${this.userData.foliage ? 1 : 0}:flicker${this.userData.flicker ?? 0}:windows${this.userData.windowStagger ? 1 : 0}`;
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
