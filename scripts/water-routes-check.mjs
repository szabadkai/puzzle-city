import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createServer } from 'vite';

const gradient = { addColorStop() {} };
const context = {
  createRadialGradient() { return gradient; },
  fillRect() {}, strokeRect() {}, fillText() {}, clearRect() {}, save() {}, restore() {},
  beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {}, fill() {}, arc() {}, ellipse() {},
  set fillStyle(_value) {}, set strokeStyle(_value) {}, set lineWidth(_value) {},
  set lineCap(_value) {}, set lineJoin(_value) {}, set font(_value) {},
  set textAlign(_value) {}, set textBaseline(_value) {},
};
globalThis.document = {
  createElement() { return { width: 0, height: 0, getContext() { return context; } }; },
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const { HarborAmbience } = await server.ssrLoadModule('/src/harbor.ts');
  const { createDockNavigationPath, createShorelineRoute, WORLD_CELL_SIZE } = await server.ssrLoadModule('/src/water.ts');
  const cell = (x, z) => ({ x, z, height: 1, color: 0, placedAt: 0, foundedAt: 0, renovatedAt: 0 });
  const northDock = {
    land: { x: 0, z: 0 }, water: { x: 0, z: -1 }, direction: 0, dock: true,
  };

  // This detached wall sits in the direct offshore corridor that the old
  // quadratic merchant route could cross.
  const obstructedTown = [
    cell(0, 0),
    ...Array.from({ length: 7 }, (_, index) => cell(-1, -2 - index)),
  ];
  const navigationPath = createDockNavigationPath(obstructedTown, northDock, 1);
  assert.ok(navigationPath.length >= 4, 'dock navigation did not detour around a detached island');
  const occupied = new Set(obstructedTown.map(({ x, z }) => `${x},${z}`));
  for (let index = 0; index < navigationPath.length - 1; index++) {
    const from = navigationPath[index];
    const to = navigationPath[index + 1];
    assert.ok(from.x === to.x || from.z === to.z, 'dock navigation introduced a diagonal land-cutting segment');
    const dx = Math.sign(to.x - from.x);
    const dz = Math.sign(to.z - from.z);
    const steps = Math.abs(to.x - from.x) + Math.abs(to.z - from.z);
    for (let step = 0; step <= steps; step++) {
      assert.ok(!occupied.has(`${from.x + dx * step},${from.z + dz * step}`), 'dock navigation crossed an occupied cell');
    }
  }
  assert.deepEqual(
    createDockNavigationPath([cell(0, 0), cell(-1, -1)], northDock, 1),
    [],
    'a berth was offered on an occupied side of the dock',
  );
  assert.ok(
    createDockNavigationPath([cell(0, 0), cell(-1, -1)], northDock, -1).length > 0,
    'the open side of a partly blocked dock was not usable',
  );

  const outerRoute = createShorelineRoute(obstructedTown, 42, 0);
  for (let index = 0; index < 1200; index++) {
    const point = outerRoute.getPointAt(index / 1200);
    for (const building of obstructedTown) {
      const dx = Math.max(0, Math.abs(point.x - building.x * WORLD_CELL_SIZE) - WORLD_CELL_SIZE / 2);
      const dz = Math.max(0, Math.abs(point.z - building.z * WORLD_CELL_SIZE) - WORLD_CELL_SIZE / 2);
      assert.ok(Math.hypot(dx, dz) > 1.05, 'an outer fleet route clipped a building footprint');
    }
  }

  // Integration check: every sampled merchant centre and its slow movement
  // across the berth stay outside all occupied building cells.
  const ambience = new HarborAmbience(42, new THREE.PerspectiveCamera(), obstructedTown);
  assert.ok(ambience.importDock && ambience.merchantInboundRoute && ambience.merchantOutboundRoute, 'merchant routes were not configured');
  const routes = [ambience.merchantInboundRoute, ambience.merchantOutboundRoute];
  for (const route of routes) for (let index = 0; index <= 800; index++) {
    const point = route.getPointAt(index / 800);
    for (const building of obstructedTown) {
      assert.ok(
        Math.abs(point.x - building.x * WORLD_CELL_SIZE) >= WORLD_CELL_SIZE / 2
          || Math.abs(point.z - building.z * WORLD_CELL_SIZE) >= WORLD_CELL_SIZE / 2,
        'merchant route entered a building footprint',
      );
    }
  }
  for (let index = 0; index <= 100; index++) {
    const point = new THREE.Vector3().lerpVectors(ambience.merchantArrivalPoint, ambience.merchantDeparturePoint, index / 100);
    for (const building of obstructedTown) {
      assert.ok(
        Math.abs(point.x - building.x * WORLD_CELL_SIZE) >= WORLD_CELL_SIZE / 2
          || Math.abs(point.z - building.z * WORLD_CELL_SIZE) >= WORLD_CELL_SIZE / 2,
        'merchant berth movement entered a building footprint',
      );
    }
  }

  console.log('Water-route check passed: outer fleet and dock journeys remain clear of occupied blocks.');
} finally {
  await server.close();
}
