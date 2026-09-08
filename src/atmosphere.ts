import * as THREE from 'three';
import { PALETTE_SLOT, type PaletteSystem } from './palette';

/**
 * Lighting state for one moment of the simulation clock. Everything that
 * depends on the time of day reads from this so a clip stays coherent.
 */
export type AtmosphereState = {
  /** Unit vector from the town toward the sun. */
  sunDirection: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  sunElevation: number;
  moonDirection: THREE.Vector3;
  moonIntensity: number;
  skyZenith: THREE.Color;
  skyHorizon: THREE.Color;
  /** Warm glow strength around the sun at the horizon, 0 to 1. */
  horizonGlow: number;
  fogColor: THREE.Color;
  fogDensity: number;
  ambientSky: THREE.Color;
  ambientGround: THREE.Color;
  ambientIntensity: number;
  exposure: number;
  /** 0 in full day, 1 in full night. */
  night: number;
  wetness: number;
  /** 0 clear, 1 fully overcast: shadows fade and colours calm down. */
  overcast: number;
  shadowIntensity: number;
  saturation: number;
  /** Strength of the bow opposite a low sun while light rain falls, 0 to 1. */
  rainbow: number;
};

type Keyframe = Readonly<{ hour: number; kelvin: number; sun: number; exposure: number; ambient: number; fog: number; night: number }>;

// Golden hour is the most saturated state, not the brightest.
const KEYFRAMES: readonly Keyframe[] = [
  { hour: 0, kelvin: 2500, sun: 0, exposure: .74, ambient: .4, fog: .0105, night: 1 },
  { hour: 4.6, kelvin: 2500, sun: 0, exposure: .74, ambient: .4, fog: .0105, night: 1 },
  { hour: 5.6, kelvin: 2200, sun: .9, exposure: .9, ambient: .78, fog: .0125, night: .55 },
  { hour: 7, kelvin: 3800, sun: 3.2, exposure: 1, ambient: .9, fog: .0115, night: .08 },
  { hour: 12, kelvin: 5500, sun: 4, exposure: 1.02, ambient: 1, fog: .0082, night: 0 },
  { hour: 16.5, kelvin: 4700, sun: 3.8, exposure: 1.04, ambient: .94, fog: .009, night: 0 },
  { hour: 17.5, kelvin: 3300, sun: 3.6, exposure: 1.08, ambient: .84, fog: .011, night: 0 },
  { hour: 18.6, kelvin: 2500, sun: 2.4, exposure: 1.02, ambient: .78, fog: .0135, night: .12 },
  { hour: 19.6, kelvin: 2200, sun: .5, exposure: .9, ambient: .68, fog: .0125, night: .6 },
  { hour: 21, kelvin: 2500, sun: 0, exposure: .74, ambient: .4, fog: .0105, night: 1 },
  { hour: 24, kelvin: 2500, sun: 0, exposure: .74, ambient: .4, fog: .0105, night: 1 },
];

const NIGHT_ZENITH = new THREE.Color('#070c1f');
const NIGHT_HORIZON = new THREE.Color('#182240');
const NIGHT_SUN_FLOOR = new THREE.Color('#5a6f9a');
const MOON_COLOR = new THREE.Color('#a9c4f0');
const RAIN_SKY = new THREE.Color('#6b7a80');

function lerpKeyframes(hour: number) {
  const wrapped = ((hour % 24) + 24) % 24;
  let index = 0;
  while (index < KEYFRAMES.length - 2 && KEYFRAMES[index + 1].hour <= wrapped) index += 1;
  const a = KEYFRAMES[index];
  const b = KEYFRAMES[index + 1];
  const t = THREE.MathUtils.clamp((wrapped - a.hour) / Math.max(1e-4, b.hour - a.hour), 0, 1);
  const s = t * t * (3 - 2 * t);
  return {
    kelvin: THREE.MathUtils.lerp(a.kelvin, b.kelvin, s),
    sun: THREE.MathUtils.lerp(a.sun, b.sun, s),
    exposure: THREE.MathUtils.lerp(a.exposure, b.exposure, s),
    ambient: THREE.MathUtils.lerp(a.ambient, b.ambient, s),
    fog: THREE.MathUtils.lerp(a.fog, b.fog, s),
    night: THREE.MathUtils.lerp(a.night, b.night, s),
  };
}

/** Blackbody approximation after Tanner Helland, returned in linear space. */
export function kelvinToColor(kelvin: number, target = new THREE.Color()) {
  const t = THREE.MathUtils.clamp(kelvin, 1000, 12000) / 100;
  const red = t <= 66 ? 255 : 329.698727446 * Math.pow(t - 60, -0.1332047592);
  const green = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  const blue = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const clamp = (value: number) => THREE.MathUtils.clamp(value, 0, 255) / 255;
  return target.setRGB(clamp(red), clamp(green), clamp(blue), THREE.SRGBColorSpace);
}

export function createAtmosphereState(): AtmosphereState {
  return {
    sunDirection: new THREE.Vector3(0, 1, 0),
    sunColor: new THREE.Color(),
    sunIntensity: 0,
    sunElevation: 0,
    moonDirection: new THREE.Vector3(0, 1, 0),
    moonIntensity: 0,
    skyZenith: new THREE.Color(),
    skyHorizon: new THREE.Color(),
    horizonGlow: 0,
    fogColor: new THREE.Color(),
    fogDensity: .01,
    ambientSky: new THREE.Color(),
    ambientGround: new THREE.Color(),
    ambientIntensity: 1,
    exposure: 1,
    night: 0,
    wetness: 0,
    overcast: 0,
    shadowIntensity: 1,
    saturation: 1,
    rainbow: 0,
  };
}

const scratchWarm = new THREE.Color();

/** Sun elevation in radians for a solar day that runs from 05:00 to 19:00. */
export function sunElevationAt(hour: number) {
  const t = (((hour % 24) + 24) % 24 - 5) / 14;
  if (t < 0 || t > 1) {
    const below = t < 0 ? -t : t - 1;
    return -THREE.MathUtils.degToRad(8 + below * 40);
  }
  return THREE.MathUtils.degToRad(Math.sin(t * Math.PI) * 62);
}

export function evaluateAtmosphere(hour: number, palette: PaletteSystem, rainIntensity: number, target: AtmosphereState) {
  const keys = lerpKeyframes(hour);
  const rain = THREE.MathUtils.clamp(rainIntensity, 0, 1);
  const elevation = sunElevationAt(hour);
  // The arc runs behind the default camera at noon, so morning light comes
  // from the left, evening light rakes in from the right.
  const azimuth = THREE.MathUtils.degToRad(130.5) - (hour - 6) / 24 * Math.PI * 2;
  target.sunElevation = elevation;
  target.sunDirection.set(Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation), Math.sin(azimuth) * Math.cos(elevation)).normalize();
  // The moon hangs low ahead of the default view so its glitter path crosses the water toward the camera.
  const moonAzimuth = THREE.MathUtils.degToRad(228);
  const moonElevation = THREE.MathUtils.degToRad(26 + Math.sin(((hour + 6) % 24) / 24 * Math.PI) * 10);
  target.moonDirection.set(Math.cos(moonAzimuth) * Math.cos(moonElevation), Math.sin(moonElevation), Math.sin(moonAzimuth) * Math.cos(moonElevation));
  target.night = keys.night;
  target.wetness = rain;
  // Cloud builds before the first drop: the ramp up to 0.3 is overcast, above it rain.
  target.overcast = THREE.MathUtils.clamp(rain / .3, 0, 1);
  target.shadowIntensity = 1 - target.overcast * .75;
  target.saturation = 1 - target.overcast * .14 - THREE.MathUtils.clamp((rain - .3) / .7, 0, 1) * .1;
  // A bow needs sun on light rain: the edges of a shower, with the sun below 42 degrees.
  const elevationDegrees = THREE.MathUtils.radToDeg(elevation);
  target.rainbow = THREE.MathUtils.smoothstep(rain, .03, .1) * (1 - THREE.MathUtils.smoothstep(rain, .16, .3))
    * THREE.MathUtils.smoothstep(elevationDegrees, 0, 4) * (1 - THREE.MathUtils.smoothstep(elevationDegrees, 36, 42));

  kelvinToColor(keys.kelvin, target.sunColor);
  target.sunColor.lerp(NIGHT_SUN_FLOOR, keys.night * .5);
  target.sunIntensity = keys.sun * (1 - target.overcast * .45 - THREE.MathUtils.clamp((rain - .3) / .7, 0, 1) * .3);
  target.moonIntensity = Math.pow(keys.night, 1.4) * 1.1 * (1 - rain * .6);

  const paletteZenith = palette.color(PALETTE_SLOT.skyZenith);
  const paletteHorizon = palette.color(PALETTE_SLOT.skyHorizon);
  const haze = palette.color(PALETTE_SLOT.haze);
  const shadow = palette.color(PALETTE_SLOT.shadow);
  const water = palette.color(PALETTE_SLOT.water);

  // Glow around a low sun. Strongest just above the horizon, gone by 14 degrees.
  const glow = THREE.MathUtils.smoothstep(THREE.MathUtils.radToDeg(elevation), -6, 2) * (1 - THREE.MathUtils.smoothstep(THREE.MathUtils.radToDeg(elevation), 6, 16));
  target.horizonGlow = glow * (1 - rain * .8);
  scratchWarm.copy(target.sunColor);
  target.skyZenith.copy(paletteZenith).lerp(NIGHT_ZENITH, keys.night).lerp(RAIN_SKY, rain * .55);
  target.skyHorizon.copy(paletteHorizon).lerp(NIGHT_HORIZON, keys.night).lerp(scratchWarm, glow * .55).lerp(RAIN_SKY, rain * .5);
  target.fogColor.copy(haze).lerp(target.skyHorizon, .5).lerp(NIGHT_HORIZON, keys.night * .85).lerp(RAIN_SKY, rain * .4);
  target.fogDensity = keys.fog * (1 + rain * .9);

  // Ambient carries the palette shadow tint so shadows keep a hue.
  target.ambientSky.copy(shadow).lerp(target.skyZenith, .12).lerp(MOON_COLOR, keys.night * .35);
  target.ambientGround.copy(shadow).lerp(water, .18);
  target.ambientIntensity = keys.ambient * (3.8 + target.overcast * .9 + rain * .5);
  target.exposure = keys.exposure + rain * .1;
  return target;
}
