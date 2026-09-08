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
  /** Where the cloud-shadow field has drifted to, in noise space. The wind pushes it. */
  uCloudOffset: { value: new THREE.Vector2() },
  /** 0 a clear sky, 1 a sky full of cumulus: how much of the ground lies in cloud shadow. */
  uCloudCover: { value: .45 },
  /** How dark a cloud shadow is on direct light, 0 to 1. */
  uCloudShadow: { value: .5 },
};

/** Hours a planted tree takes to reach full size. Mirrors `TREE_MATURE_HOURS`. */
const TREE_MATURE_HOURS = 72;
/** Simulated hours until a building shows its full weathering. */
const WEATHERED_HOURS = 336;

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
// xyz: world pivot of a growing tree; w: birth hour + 2, negative for seats that appear late.
// Geometry without the attribute reads the WebGL default (0, 0, 0, 1), so |w| below 1.5 means no growth.
attribute vec4 aTreeGrowth;
// Per-building moment in the dusk ramp at which its windows light, 0 to 1.
attribute float aLightOffset;
varying float vLtLightOffset;
// Founding hour of the building plus one; 0 for anything that does not weather.
attribute float aBuildingAge;
varying float vLtAge;
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
  vLtAge = aBuildingAge > 0.5 ? clamp( ( uSimHours - ( aBuildingAge - 1.0 ) ) / ${WEATHERED_HOURS.toFixed(1)}, 0.0, 1.0 ) : 0.0;
}
`;

// Cloth hangs from its top edge or flies from its left edge; the free corners move
// most. Cloth is merged town-wide, so the phase comes from the world position and
// rain retraction pulls every vertex toward its own top edge. The breeze is slow:
// one swell of several seconds, and a ripple that travels toward the free edge.
const CLOTH_SWAY = /* glsl */`
#include <begin_vertex>
{
  vec3 ltClothWorld = ( modelMatrix * vec4( position, 1.0 ) ).xyz;
  // Washing is pinned along its line and swings out from the wall at the hem;
  // a flag is pinned along its pole and flies at the fly end.
  float ltIsFlag = step( aRetractTop, -100.0 );
  float ltHang = ( 1.0 - uv.y ) * ( 0.75 + 0.25 * uv.x );
  float ltFly = uv.x * ( 0.85 + 0.15 * ( 1.0 - uv.y ) );
  float ltFree = mix( ltHang, ltFly, ltIsFlag );
  float ltPhase = dot( floor( ltClothWorld.xz * 1.6 ), vec2( 1.7, 2.3 ) );
  float ltSpeed = length( uWind );
  float ltSwell = sin( uTime * ( 0.55 + ltSpeed * 0.5 ) + ltPhase ) * 0.6
    + sin( uTime * ( 0.9 + ltSpeed * 0.7 ) + ltPhase * 1.3 + ltClothWorld.y * 2.0 ) * 0.4;
  // The ripple runs down a hanging sheet and along a flag toward the fly end.
  float ltRipplePhase = mix( ( 1.0 - uv.y ) * 5.0, uv.x * 7.0 - uv.y * 1.5, ltIsFlag ) - uTime * ( 1.1 + ltSpeed * 1.4 ) + ltPhase;
  float ltRipple = sin( ltRipplePhase );
  vec3 ltWindDir = vec3( uWind.x, 0.0, uWind.y );
  vec3 ltWorldNormal = normalize( mat3( modelMatrix ) * normal );
  float ltAcross = dot( ltWindDir, ltWorldNormal );
  // Only a flag leans along the wind; washing moves out from its wall.
  vec3 ltLocalWind = inverse( mat3( modelMatrix ) ) * ltWindDir;
  transformed += ltLocalWind * ltFree * ( 0.04 + ltSwell * 0.04 ) * ltIsFlag;
  float ltOut = mix( 0.6, 1.0, ltIsFlag );
  float ltRippleAmount = 0.025 + 0.07 * ltSpeed;
  transformed += normal * ltFree * ltOut * ( ltAcross * ( 0.08 + ltSwell * 0.03 ) + ltRipple * ltRippleAmount );
  transformed.y -= ltFree * ltFree * ( 0.5 + 0.5 * ltSwell ) * 0.03 * ltSpeed;
  // The ripple slope tilts the normal, so the wave reads in the shading as well as the silhouette.
  float ltSlope = cos( ltRipplePhase ) * mix( 5.0, 7.0, ltIsFlag ) * ltRippleAmount * ltFree * ltOut * 2.0;
  vec3 ltAlong = normalize( cross( vec3( 0.0, 1.0, 0.0 ), normal ) + vec3( 1e-4, 0.0, 0.0 ) );
  vec3 ltRippleAxis = mix( vec3( 0.0, 1.0, 0.0 ), ltAlong, ltIsFlag );
  objectNormal = normalize( objectNormal - ltRippleAxis * ltSlope );
  if ( aRetractTop > -100.0 ) transformed.y += ( aRetractTop - ltClothWorld.y ) * uClothRetract;
}
`;

// Trees scale up from their pivot as the simulation clock passes their birth hour.
const TREE_GROWTH = /* glsl */`
#include <begin_vertex>
if ( abs( aTreeGrowth.w ) > 1.5 ) {
  float ltBorn = abs( aTreeGrowth.w ) - 2.0;
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
uniform vec2 uCloudOffset;
uniform float uCloudCover;
uniform float uCloudShadow;
varying float vLtLightOffset;
varying float vLtAge;

float ltHash21( vec2 p ) {
  return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453 );
}

float ltValueNoise( vec2 p ) {
  vec2 i = floor( p );
  vec2 f = fract( p );
  f = f * f * ( 3.0 - 2.0 * f );
  return mix(
    mix( ltHash21( i ), ltHash21( i + vec2( 1.0, 0.0 ) ), f.x ),
    mix( ltHash21( i + vec2( 0.0, 1.0 ) ), ltHash21( i + vec2( 1.0, 1.0 ) ), f.x ),
    f.y );
}

// Direct light left after the cumulus overhead: soft patches that drift with the wind.
float ltCloudLight( vec2 world ) {
  vec2 p = world * 0.05 + uCloudOffset;
  float n = ltValueNoise( p ) * 0.62 + ltValueNoise( p * 2.3 + 7.0 ) * 0.38;
  float threshold = mix( 0.78, 0.42, uCloudCover );
  float cover = smoothstep( threshold, threshold + 0.24, n );
  return 1.0 - cover * uCloudShadow;
}
`;

// Every directional light (the sun and the moon) dims under the cloud field.
function cloudShadowedLights() {
  return `float ltCloudLight = ltCloudLight( vLtWorld.xz );\n${THREE.ShaderChunk.lights_fragment_begin
    .replace(/getDirectionalLightInfo\([^;]*;/g, '$& directLight.color *= ltCloudLight;')}`;
}

// Years on the waterfront: grime climbs the base of the walls, salt dulls the
// colour a little everywhere, and a green tide line settles just above the water.
const WEATHERING = /* glsl */`
if ( vLtAge > 0.001 ) {
  float ltAcross = vLtWorld.x + vLtWorld.z;
  float ltBlotch = ltValueNoise( vec2( ltAcross, vLtWorld.y ) * 2.3 ) * 0.5 + 0.5;
  float ltStreak = ltValueNoise( vec2( ltAcross * 3.1, vLtWorld.y * 0.5 ) ) * 0.6 + 0.4;
  float ltBase = exp( - max( vLtWorld.y - 0.2, 0.0 ) * 1.1 );
  float ltGrime = vLtAge * ( ltBase * ltBlotch * ltStreak + 0.16 );
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.47, 0.45, 0.42 ), ltGrime );
  float ltTide = vLtAge * exp( - max( vLtWorld.y + 0.2, 0.0 ) * 3.0 ) * ltBlotch;
  diffuseColor.rgb = mix( diffuseColor.rgb, diffuseColor.rgb * vec3( 0.5, 0.7, 0.45 ), ltTide * 0.8 );
}
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
    .replace('#include <fog_fragment>', FOG_FRAGMENT)
    .replace('#include <lights_fragment_begin>', cloudShadowedLights());
  shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', WET_SURFACES);
  const weathers = !this.userData.cloth && !this.userData.foliage && !this.userData.windowStagger && !this.userData.flicker;
  const colorStage = this.userData.paletteLookup ? PALETTE_LOOKUP : '#include <color_fragment>';
  shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', colorStage + (weathers ? WEATHERING : ''));
  if (this.userData.windowStagger) shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', WINDOW_STAGGER);
  const flicker = this.userData.flicker as number | undefined;
  if (flicker) {
    shader.fragmentShader = `#define LT_FLICKER ${flicker.toFixed(3)}\n${shader.fragmentShader}`.replace('#include <emissivemap_fragment>', FLICKER);
  }
  if (this.userData.paletteLookup) {
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nuniform sampler2D uPalette;');
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
