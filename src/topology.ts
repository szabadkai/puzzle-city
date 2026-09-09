import { analyzeHarborSpaces } from './harbor-spaces.ts';
import { hash } from './random.ts';
import type { Cell } from './types.ts';
import { CARDINALS, keyOf } from './types.ts';

export type PlazaAnchor = Readonly<{ x: number; z: number }>;
export type CardinalDirection = 0 | 1 | 2 | 3;

/**
 * Pick the exposed face used by a building entrance and anything that gathers
 * around it. Keeping this decision here prevents renderers and actors from
 * independently choosing different "fronts" for the same building.
 */
export function facadeDirectionAt(
  x: number,
  z: number,
  cells: ReadonlyMap<string, Cell>,
  seed: number,
): CardinalDirection {
  const open = CARDINALS.map(([dx, dz]) => (cells.get(keyOf(x + dx, z + dz))?.height ?? 0) === 0);
  const preferred = Math.floor(hash(seed, x, z, 27) * CARDINALS.length) as CardinalDirection;
  if (open[preferred]) return preferred;
  const first = open.findIndex(Boolean);
  return (first < 0 ? preferred : first) as CardinalDirection;
}

export function plazaAnchorAt(x: number, z: number, cells: ReadonlyMap<string, Cell>): PlazaAnchor | null {
  return findPlazaAnchors(cells).find((anchor) => x >= anchor.x && x <= anchor.x + 1 && z >= anchor.z && z <= anchor.z + 1) ?? null;
}

export function findPlazaAnchors(cells: ReadonlyMap<string, Cell>) {
  return analyzeHarborSpaces(cells).plazas;
}
