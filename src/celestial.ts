import * as THREE from 'three';

/** A compressed game calendar, independent of wall-clock time and frame rate. */
export const LUNAR_MONTH_DAYS = 29.53059;
const TAU = Math.PI * 2;
const LATITUDE = THREE.MathUtils.degToRad(42);
// A fixed summer sky preserves the harbor's long days and ~62° noon sun.
// This is a circular-orbit approximation, not a dated terrestrial ephemeris.
const SOLAR_DECLINATION = THREE.MathUtils.degToRad(14);
const SOUTH_AZIMUTH = THREE.MathUtils.degToRad(40.5);

function horizonDirection(hourAngle: number, declination: number, target: THREE.Vector3) {
  const cosDec = Math.cos(declination);
  const east = -cosDec * Math.sin(hourAngle);
  const south = Math.sin(LATITUDE) * cosDec * Math.cos(hourAngle) - Math.cos(LATITUDE) * Math.sin(declination);
  const up = Math.cos(LATITUDE) * cosDec * Math.cos(hourAngle) + Math.sin(LATITUDE) * Math.sin(declination);
  return target.set(
    south * Math.cos(SOUTH_AZIMUTH) - east * Math.sin(SOUTH_AZIMUTH),
    up,
    south * Math.sin(SOUTH_AZIMUTH) + east * Math.cos(SOUTH_AZIMUTH),
  ).normalize();
}

export function sunDirectionAt(hour: number, target: THREE.Vector3) {
  return horizonDirection((hour - 12) / 24 * TAU, SOLAR_DECLINATION, target);
}

/** Day 1 opens near full moon; absolute game days carry its orbit across midnight.
 * Phase period: https://science.nasa.gov/moon/moon-phases/
 */
export function moonDirectionAt(absoluteHours: number, target: THREE.Vector3) {
  const elongation = Math.PI + (absoluteHours / 24 - 1) / LUNAR_MONTH_DAYS * TAU;
  const rightAscension = Math.atan2(Math.cos(elongation) * Math.cos(SOLAR_DECLINATION), -Math.sin(elongation)) - Math.PI / 2;
  const declination = Math.asin(Math.cos(elongation) * Math.sin(SOLAR_DECLINATION));
  return horizonDirection((absoluteHours - 12) / 24 * TAU - rightAscension, declination, target);
}
