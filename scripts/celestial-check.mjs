import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true, hmr: false, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { sunDirectionAt, moonDirectionAt, LUNAR_MONTH_DAYS } = await server.ssrLoadModule('/src/celestial.ts');
  const { createAtmosphereState, evaluateAtmosphere } = await server.ssrLoadModule('/src/atmosphere.ts');
  const { PaletteSystem } = await server.ssrLoadModule('/src/palette.ts');
  const direction = (fn, time) => fn(time, new THREE.Vector3());
  const sun = hour => direction(sunDirectionAt, hour);
  const moon = hours => direction(moonDirectionAt, hours);
  assert(sun(0).y < 0 && sun(5).y < 0 && sun(6).y > 0 && sun(18).y > 0 && sun(19).y < 0);
  assert(Math.abs(THREE.MathUtils.radToDeg(Math.asin(sun(12).y)) - 62) < 1e-9);
  for (let hour = -24; hour <= 72; hour += .01) {
    assert(Math.abs(sun(hour).length() - 1) < 1e-10);
    assert(sun(hour).distanceTo(sun(hour + 24)) < 1e-10);
    assert(sun(hour).distanceTo(sun(hour + .001)) < .0003, 'Solar path jumps, including at midnight and the horizon');
    assert(moon(hour).distanceTo(moon(hour + .001)) < .0003, 'Lunar path jumps');
  }
  const full = 24;
  const newMoon = full + LUNAR_MONTH_DAYS * 12;
  assert(sun(full).dot(moon(full)) < -.999999);
  assert(sun(newMoon).dot(moon(newMoon)) > .999999);
  assert(Math.abs(sun(full + LUNAR_MONTH_DAYS * 6).dot(moon(full + LUNAR_MONTH_DAYS * 6))) < 1e-9);
  assert(moon(24).distanceTo(moon(48)) > .15, 'Moon must advance between successive days');
  // Consecutive moonrises should progress to a later hour, not repeat daily.
  const rises = [];
  for (let t = 24; t < 96; t += .01) {
    if (moon(t).y <= 0 && moon(t + .01).y > 0) rises.push(t);
  }
  assert(rises.length >= 2);
  assert(rises[1] - rises[0] > 24.4 && rises[1] - rises[0] < 25.2);
  const palette = new PaletteSystem();
  const state = createAtmosphereState();
  for (let hours = 0; hours < LUNAR_MONTH_DAYS * 24; hours += .25) {
    evaluateAtmosphere(hours % 24, palette, 0, state, Math.floor(hours / 24));
    assert(state.moonVisibility >= 0 && state.moonVisibility <= 1);
    assert(state.moonIllumination >= 0 && state.moonIllumination <= 1);
    if (state.moonDirection.y <= 0) assert.equal(state.moonIntensity, 0, 'No moonlight or glitter from beneath the horizon');
    if (state.sunDirection.y <= 0) assert.equal(state.sunIntensity, 0);
  }
  const before = evaluateAtmosphere(24, palette, 0, createAtmosphereState(), 3);
  const after = evaluateAtmosphere(0, palette, 0, createAtmosphereState(), 4);
  assert(before.moonDirection.distanceTo(after.moonDirection) < 1e-10, 'Photo hour 24 and next midnight must agree');
  assert.equal(before.moonIllumination, after.moonIllumination);
  console.log('Celestial checks passed: continuous orbits, horizon crossings, lunar phases, later moonrises, and midnight continuity.');
} finally {
  await server.close();
}
