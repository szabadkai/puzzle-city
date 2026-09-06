import * as THREE from 'three';
import { CARDINALS, type Cell, keyOf } from './types';
import { hash } from './random';
import { findPlazaAnchors } from './topology';
import { CELL_SIZE } from './spatial';

export const WORLD_CELL_SIZE = CELL_SIZE;

export type WaterPoint = Readonly<{ x: number; z: number }>;

export type ShorelineEdge = Readonly<{
  land: WaterPoint;
  water: WaterPoint;
  direction: number;
  dock: boolean;
}>;

export type WaterTopology = Readonly<{
  shoreline: readonly ShorelineEdge[];
  docks: readonly ShorelineEdge[];
  canals: readonly WaterPoint[];
  sheltered: readonly WaterPoint[];
}>;

/**
 * Find a cardinal water-cell path from one side of a dock to open water.
 * Keeping the path on cell centres prevents the vessel curve from taking a
 * visual shortcut through a detached island or a later-built block.
 */
export function createDockNavigationPath(cells: Iterable<Cell>, dock: ShorelineEdge, side: -1 | 1) {
  const cellList = [...cells];
  const blocked = new Set(cellList.map((cell) => keyOf(cell.x, cell.z)));
  const occupied = new Map(cellList.map((cell) => [keyOf(cell.x, cell.z), cell]));

  // Plazas and almost-enclosed courtyards render as solid ground even though
  // they do not have Cell records, so boats must route around those as well.
  for (const anchor of findPlazaAnchors(occupied)) {
    blocked.add(keyOf(anchor.x, anchor.z));
    blocked.add(keyOf(anchor.x + 1, anchor.z));
    blocked.add(keyOf(anchor.x, anchor.z + 1));
    blocked.add(keyOf(anchor.x + 1, anchor.z + 1));
  }
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
    if (blocked.has(keyOf(x, z))) continue;
    const landSides = CARDINALS.filter(([dx, dz]) => occupied.has(keyOf(x + dx, z + dz))).length;
    if (landSides >= 3) blocked.add(keyOf(x, z));
  }

  const outwardX = dock.water.x - dock.land.x;
  const outwardZ = dock.water.z - dock.land.z;
  const lateralX = outwardZ;
  const lateralZ = -outwardX;
  const start = {
    x: dock.water.x + lateralX * side,
    z: dock.water.z + lateralZ * side,
  };
  if (blocked.has(keyOf(start.x, start.z))) return Object.freeze([]) as readonly WaterPoint[];

  const minCellX = Math.min(dock.land.x, ...cellList.map((cell) => cell.x));
  const maxCellX = Math.max(dock.land.x, ...cellList.map((cell) => cell.x));
  const minCellZ = Math.min(dock.land.z, ...cellList.map((cell) => cell.z));
  const maxCellZ = Math.max(dock.land.z, ...cellList.map((cell) => cell.z));
  const openWaterPadding = 12;
  const lateralOffset = 3 * side;
  const goal = {
    x: outwardX < 0 ? minCellX - openWaterPadding
      : outwardX > 0 ? maxCellX + openWaterPadding
        : dock.land.x + lateralX * lateralOffset,
    z: outwardZ < 0 ? minCellZ - openWaterPadding
      : outwardZ > 0 ? maxCellZ + openWaterPadding
        : dock.land.z + lateralZ * lateralOffset,
  };
  const searchMinX = Math.min(minCellX - openWaterPadding, start.x, goal.x) - 2;
  const searchMaxX = Math.max(maxCellX + openWaterPadding, start.x, goal.x) + 2;
  const searchMinZ = Math.min(minCellZ - openWaterPadding, start.z, goal.z) - 2;
  const searchMaxZ = Math.max(maxCellZ + openWaterPadding, start.z, goal.z) + 2;
  const goalKey = keyOf(goal.x, goal.z);
  const startKey = keyOf(start.x, start.z);
  const open: WaterPoint[] = [start];
  const openKeys = new Set([startKey]);
  const closed = new Set<string>();
  const cameFrom = new Map<string, string>();
  const points = new Map<string, WaterPoint>([[startKey, start]]);
  const cost = new Map<string, number>([[startKey, 0]]);
  const estimate = (point: WaterPoint) => Math.abs(point.x - goal.x) + Math.abs(point.z - goal.z);

  while (open.length) {
    let bestIndex = 0;
    let bestScore = Infinity;
    for (let index = 0; index < open.length; index++) {
      const point = open[index];
      const score = (cost.get(keyOf(point.x, point.z)) ?? Infinity) + estimate(point);
      if (score < bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = keyOf(current.x, current.z);
    openKeys.delete(currentKey);
    if (currentKey === goalKey) {
      const path: WaterPoint[] = [current];
      let cursor = currentKey;
      while (cameFrom.has(cursor)) {
        cursor = cameFrom.get(cursor)!;
        path.unshift(points.get(cursor)!);
      }
      const simplified = path.filter((point, index) => {
        if (index === 0 || index === path.length - 1) return true;
        const before = path[index - 1];
        const after = path[index + 1];
        const straightAlongX = before.z === point.z && point.z === after.z;
        const straightAlongZ = before.x === point.x && point.x === after.x;
        return !straightAlongX && !straightAlongZ;
      });
      return Object.freeze(simplified.map((point) => Object.freeze({ ...point })));
    }
    closed.add(currentKey);

    // Trying outward and the selected berth side first gives equally short
    // paths a stable, harbor-like shape without changing collision behavior.
    const directions = [
      [outwardX, outwardZ],
      [lateralX * side, lateralZ * side],
      [-lateralX * side, -lateralZ * side],
      [-outwardX, -outwardZ],
    ] as const;
    for (const [dx, dz] of directions) {
      const next = { x: current.x + dx, z: current.z + dz };
      if (next.x < searchMinX || next.x > searchMaxX || next.z < searchMinZ || next.z > searchMaxZ) continue;
      const nextKey = keyOf(next.x, next.z);
      if (blocked.has(nextKey) || closed.has(nextKey)) continue;
      const nextCost = (cost.get(currentKey) ?? 0) + 1;
      if (nextCost >= (cost.get(nextKey) ?? Infinity)) continue;
      cameFrom.set(nextKey, currentKey);
      points.set(nextKey, next);
      cost.set(nextKey, nextCost);
      if (!openKeys.has(nextKey)) {
        open.push(next);
        openKeys.add(nextKey);
      }
    }
  }
  return Object.freeze([]) as readonly WaterPoint[];
}

export function hasDock(cell: Cell, direction: number, seed: number) {
  return cell.height === 1 && hash(seed, cell.x, cell.z, 200 + direction) > .74;
}

export function hasWaterStairs(cell: Cell, direction: number, seed: number) {
  return !hasDock(cell, direction, seed) && hash(seed, cell.x, cell.z, 260 + direction) > .82;
}

export function analyzeWaterTopology(cells: Iterable<Cell>, seed: number): WaterTopology {
  const cellList = [...cells];
  const occupied = new Map(cellList.map((cell) => [keyOf(cell.x, cell.z), cell]));
  const groundFeatures = new Set<string>();
  for (const anchor of findPlazaAnchors(occupied)) {
    groundFeatures.add(keyOf(anchor.x, anchor.z));
    groundFeatures.add(keyOf(anchor.x + 1, anchor.z));
    groundFeatures.add(keyOf(anchor.x, anchor.z + 1));
    groundFeatures.add(keyOf(anchor.x + 1, anchor.z + 1));
  }
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
    if (occupied.has(keyOf(x, z)) || groundFeatures.has(keyOf(x, z))) continue;
    const landSides = CARDINALS.filter(([dx, dz]) => occupied.has(keyOf(x + dx, z + dz))).length;
    if (landSides >= 3) groundFeatures.add(keyOf(x, z));
  }
  const shoreline: ShorelineEdge[] = [];

  for (const cell of cellList) {
    CARDINALS.forEach(([dx, dz], direction) => {
      if (occupied.has(keyOf(cell.x + dx, cell.z + dz))) return;
      if (groundFeatures.has(keyOf(cell.x + dx, cell.z + dz))) return;
      shoreline.push(Object.freeze({
        land: Object.freeze({ x: cell.x, z: cell.z }),
        water: Object.freeze({ x: cell.x + dx, z: cell.z + dz }),
        direction,
        dock: hasDock(cell, direction, seed),
      }));
    });
  }

  const candidates = new Map<string, WaterPoint>();
  for (const edge of shoreline) candidates.set(keyOf(edge.water.x, edge.water.z), edge.water);
  const canals: WaterPoint[] = [];
  const sheltered: WaterPoint[] = [];

  for (const point of candidates.values()) {
    const cardinal = CARDINALS.map(([dx, dz]) => occupied.has(keyOf(point.x + dx, point.z + dz)));
    const landSides = cardinal.filter(Boolean).length;
    if (landSides >= 3) continue; // Rendered as a courtyard rather than navigable water.
    const oppositeBanks = (cardinal[0] && cardinal[2]) || (cardinal[1] && cardinal[3]);
    if (oppositeBanks && landSides === 2) canals.push(point);

    let nearbyLand = 0;
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      if (occupied.has(keyOf(point.x + dx, point.z + dz))) nearbyLand += 1;
    }
    if (landSides === 2 || nearbyLand >= 6) sheltered.push(point);
  }

  return Object.freeze({
    shoreline: Object.freeze(shoreline),
    docks: Object.freeze(shoreline.filter((edge) => edge.dock)),
    canals: Object.freeze(canals),
    sheltered: Object.freeze(sheltered),
  });
}

export function createShorelineRoute(cells: Iterable<Cell>, seed: number, lane = 0) {
  const cellList = [...cells];
  if (!cellList.length) {
    const radius = 5.2 + lane * .75;
    return new THREE.CatmullRomCurve3(Array.from({ length: 16 }, (_, index) => {
      const angle = index / 16 * Math.PI * 2;
      return new THREE.Vector3(Math.cos(angle) * radius, -.12, Math.sin(angle) * radius * .86);
    }), true, 'catmullrom', .35);
  }

  // Follow a rounded water-cell envelope outside the town. Ordering exposed edges by angle can
  // cut across land when the player builds several islands, while this lane remains collision-safe.
  const clearance = WORLD_CELL_SIZE * (1.28 + lane * .2);
  const left = Math.min(...cellList.map((cell) => cell.x * WORLD_CELL_SIZE)) - clearance;
  const right = Math.max(...cellList.map((cell) => cell.x * WORLD_CELL_SIZE)) + clearance;
  const top = Math.min(...cellList.map((cell) => cell.z * WORLD_CELL_SIZE)) - clearance;
  const bottom = Math.max(...cellList.map((cell) => cell.z * WORLD_CELL_SIZE)) + clearance;
  const horizontalSteps = Math.max(3, Math.ceil((right - left) / (WORLD_CELL_SIZE * .78)));
  const verticalSteps = Math.max(3, Math.ceil((bottom - top) / (WORLD_CELL_SIZE * .78)));
  const routePoints: THREE.Vector3[] = [];
  const jitter = (index: number) => hash(seed, index, Math.round(lane * 100), 1601) * .18;
  for (let index = 0; index < horizontalSteps; index++) {
    const amount = index / horizontalSteps;
    routePoints.push(new THREE.Vector3(THREE.MathUtils.lerp(left, right, amount), -.12, top - jitter(index)));
  }
  for (let index = 0; index < verticalSteps; index++) {
    const amount = index / verticalSteps;
    routePoints.push(new THREE.Vector3(right + jitter(horizontalSteps + index), -.12, THREE.MathUtils.lerp(top, bottom, amount)));
  }
  for (let index = 0; index < horizontalSteps; index++) {
    const amount = index / horizontalSteps;
    routePoints.push(new THREE.Vector3(THREE.MathUtils.lerp(right, left, amount), -.12, bottom + jitter(horizontalSteps + verticalSteps + index)));
  }
  for (let index = 0; index < verticalSteps; index++) {
    const amount = index / verticalSteps;
    routePoints.push(new THREE.Vector3(left - jitter(horizontalSteps * 2 + verticalSteps + index), -.12, THREE.MathUtils.lerp(bottom, top, amount)));
  }
  return new THREE.CatmullRomCurve3(routePoints, true, 'catmullrom', .18);
}
