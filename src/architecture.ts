import { CARDINALS, type Cell, keyOf } from './types';
import { hash } from './random';

export type EmptyArchitectureFeature = 'narrow canal' | 'sea arch' | 'high bridge' | 'covered skybridge' | 'lantern gate';
export type ArcadeFeature = 'arcade row' | 'roof promenade';
export type TerraceFeature = 'stepped terrace' | 'terraced garden' | 'lantern stair';
export type RoofCourtFeature = 'rooftop court' | 'rooftop pavilion' | 'hanging roof garden';
export type CourtyardFeature = 'courtyard garden' | 'cloister garden' | 'courtyard pavilion';
export type VegetationPlotKind = 'herbs' | 'flowers' | 'sapling';
export type GridDirection = 0 | 1 | 2 | 3;
export type GridPoint = Readonly<{ x: number; z: number }>;
export type VegetationPlotFeature = Readonly<{
  owner: Cell;
  direction: GridDirection;
  kind: VegetationPlotKind;
  delayHours: number;
}>;

type CellMap = ReadonlyMap<string, Cell>;

export function cardinalHeights(x: number, z: number, cells: CellMap) {
  return CARDINALS.map(([dx, dz]) => cells.get(keyOf(x + dx, z + dz))?.height ?? 0);
}

/** A straight two-storey run becomes an arcade, then a walkable-looking roof promenade. */
export function arcadeFeature(cell: Cell, cells: CellMap): ArcadeFeature | null {
  if (cell.height < 2) return null;
  const heights = cardinalHeights(cell.x, cell.z, cells);
  const pair = heights[0] >= 2 && heights[2] >= 2
    ? [heights[0], heights[2]]
    : heights[1] >= 2 && heights[3] >= 2
      ? [heights[1], heights[3]]
      : null;
  if (!pair) return null;
  return Math.min(cell.height, ...pair) >= 3 ? 'roof promenade' : 'arcade row';
}

export function isArcadeCenter(cell: Cell, cells: CellMap) {
  return arcadeFeature(cell, cells) !== null;
}

/** A 1-2-3 run gains stairs; raising the whole sequence adds planting, then lanterns. */
export function steppedTerrace(cell: Cell, cells: CellMap): Readonly<{ direction: GridDirection; feature: TerraceFeature }> | null {
  const heights = cardinalHeights(cell.x, cell.z, cells);
  for (const [first, opposite] of [[0, 2], [1, 3]] as const) {
    const firstHeight = heights[first];
    const oppositeHeight = heights[opposite];
    const direction = firstHeight === cell.height - 1 && oppositeHeight === cell.height + 1
      ? first
      : oppositeHeight === cell.height - 1 && firstHeight === cell.height + 1
        ? opposite
        : null;
    if (direction !== null) {
      const feature = cell.height >= 4 ? 'lantern stair' : cell.height >= 3 ? 'terraced garden' : 'stepped terrace';
      return { direction, feature };
    }
  }
  return null;
}

export function steppedTerraceDirection(cell: Cell, cells: CellMap): GridDirection | null {
  return steppedTerrace(cell, cells)?.direction ?? null;
}

/** Equal-height 2x2 blocks of two storeys or more share one rooftop court. */
export function roofCourtAnchor(cell: Cell, cells: CellMap): GridPoint | null {
  if (cell.height < 2) return null;
  const anchors: GridPoint[] = [];
  for (const x of [cell.x - 1, cell.x]) for (const z of [cell.z - 1, cell.z]) {
    const keys = [keyOf(x, z), keyOf(x + 1, z), keyOf(x, z + 1), keyOf(x + 1, z + 1)];
    if (keys.every((key) => cells.get(key)?.height === cell.height)) anchors.push({ x, z });
  }
  anchors.sort((a, b) => a.z - b.z || a.x - b.x);
  return anchors[0] ?? null;
}

export function roofCourtFeature(cell: Cell, cells: CellMap): RoofCourtFeature | null {
  if (!roofCourtAnchor(cell, cells)) return null;
  if (cell.height >= 4) return 'hanging roof garden';
  if (cell.height >= 3) return 'rooftop pavilion';
  return 'rooftop court';
}

/** True when the generated roof is a deck rather than a pitched cap or tower roof. */
export function isWalkableRoof(cell: Cell, cells: CellMap) {
  const heights = cardinalHeights(cell.x, cell.z, cells);
  const neighborCount = heights.filter((height) => height > 0).length;
  const diagonalCount = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
    .filter(([dx, dz]) => cells.has(keyOf(cell.x + dx, cell.z + dz))).length;
  if (cell.height >= 3 && neighborCount <= 1) return false;
  if (roofCourtAnchor(cell, cells) || steppedTerrace(cell, cells) || arcadeFeature(cell, cells) === 'roof promenade') return true;
  return neighborCount > 2 || diagonalCount >= 3;
}

/** Picks one exposed wall for a roof access hatch, matching the deterministic architecture. */
export function roofAccessDirection(cell: Cell, cells: CellMap, seed: number): GridDirection | null {
  const exposed = CARDINALS
    .map((_, direction) => direction as GridDirection)
    .filter((direction) => {
      const [dx, dz] = CARDINALS[direction];
      return !cells.has(keyOf(cell.x + dx, cell.z + dz));
    });
  if (!exposed.length) return null;
  return exposed[Math.floor(hash(seed, cell.x, cell.z, 2802) * exposed.length) % exposed.length];
}

/** One hatch serves each connected, equal-height roof deck instead of cluttering every cell. */
export function isRoofAccessCell(cell: Cell, cells: CellMap, seed: number) {
  if (!isWalkableRoof(cell, cells)) return false;
  const pending = [cell];
  const visited = new Set<string>();
  const candidates: Cell[] = [];
  while (pending.length) {
    const current = pending.pop()!;
    const currentKey = keyOf(current.x, current.z);
    if (visited.has(currentKey)) continue;
    visited.add(currentKey);
    if (roofAccessDirection(current, cells, seed) !== null) candidates.push(current);
    for (const [dx, dz] of CARDINALS) {
      const neighbor = cells.get(keyOf(current.x + dx, current.z + dz));
      if (neighbor?.height === cell.height && isWalkableRoof(neighbor, cells)) pending.push(neighbor);
    }
  }
  candidates.sort((a, b) => {
    const score = hash(seed, a.x, a.z, 2801) - hash(seed, b.x, b.z, 2801);
    return score || a.z - b.z || a.x - b.x;
  });
  return candidates[0]?.x === cell.x && candidates[0]?.z === cell.z;
}

export function courtyardFeature(x: number, z: number, cells: CellMap): CourtyardFeature | null {
  const occupied = cardinalHeights(x, z, cells).filter((height) => height > 0);
  if (occupied.length < 3) return null;
  const lowestWall = Math.min(...occupied);
  if (lowestWall >= 3) return 'courtyard pavilion';
  if (lowestWall >= 2) return 'cloister garden';
  return 'courtyard garden';
}

/**
 * Some exposed homes slowly claim a neighboring water edge for a small garden.
 * The rule is local and seed-stable, so edits only need to rebuild the same
 * three-by-three neighborhood as the rest of the procedural architecture.
 */
export function vegetationPlotFeature(x: number, z: number, cells: CellMap, seed: number): VegetationPlotFeature | null {
  if (cells.has(keyOf(x, z))) return null;
  const neighbors = CARDINALS
    .map(([dx, dz], direction) => ({ owner: cells.get(keyOf(x - dx, z - dz)), direction: direction as GridDirection }))
    .filter((candidate): candidate is { owner: Cell; direction: GridDirection } => Boolean(candidate.owner));
  // Keep crossings, courtyards, and shared passages clear. These plots belong
  // to a single exposed façade, rather than filling every gap in a cluster.
  if (neighbors.length !== 1) return null;
  const { owner, direction } = neighbors[0];
  const chance = hash(seed, owner.x, owner.z, 3300 + direction);
  if (chance >= .42) return null;
  const variety = hash(seed, owner.x, owner.z, 3340 + direction);
  return Object.freeze({
    owner,
    direction,
    kind: variety < .4 ? 'herbs' : variety < .75 ? 'flowers' : 'sapling',
    delayHours: 18 + Math.floor(hash(seed, owner.x, owner.z, 3380 + direction) * 31),
  });
}

/** Opposing buildings progressively turn a water lane into an arch, bridge, then roofed skybridge. */
export function emptyCrossingFeature(x: number, z: number, cells: CellMap): EmptyArchitectureFeature | null {
  const heights = cardinalHeights(x, z, cells);
  const northSouth = heights[0] > 0 && heights[2] > 0 && heights[1] === 0 && heights[3] === 0;
  const eastWest = heights[1] > 0 && heights[3] > 0 && heights[0] === 0 && heights[2] === 0;
  if (!northSouth && !eastWest) return null;
  const [a, b] = northSouth ? [heights[0], heights[2]] : [heights[1], heights[3]];
  if (a >= 5 && b >= 5) return 'lantern gate';
  if (a >= 4 && b >= 4) return 'covered skybridge';
  if (a >= 3 && b >= 3) return 'high bridge';
  if (a >= 2 && b >= 2) return 'sea arch';
  return 'narrow canal';
}
