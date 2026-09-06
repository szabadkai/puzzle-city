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

function isPlazaAnchor(x: number, z: number, cells: ReadonlyMap<string, Cell>) {
  const interior = [keyOf(x, z), keyOf(x + 1, z), keyOf(x, z + 1), keyOf(x + 1, z + 1)];
  if (interior.some((key) => cells.has(key))) return false;
  const perimeter = [
    keyOf(x, z - 1), keyOf(x + 1, z - 1),
    keyOf(x, z + 2), keyOf(x + 1, z + 2),
    keyOf(x - 1, z), keyOf(x - 1, z + 1),
    keyOf(x + 2, z), keyOf(x + 2, z + 1),
  ];
  return perimeter.filter((key) => cells.has(key)).length >= 6;
}

export function plazaAnchorAt(x: number, z: number, cells: ReadonlyMap<string, Cell>): PlazaAnchor | null {
  for (const [ax, az] of [[x, z], [x - 1, z], [x, z - 1], [x - 1, z - 1]] as const) {
    if (isPlazaAnchor(ax, az, cells)) return Object.freeze({ x: ax, z: az });
  }
  return null;
}

export function findPlazaAnchors(cells: ReadonlyMap<string, Cell>) {
  const anchors: PlazaAnchor[] = [];
  const claimed = new Set<string>();
  for (let x = -9; x < 9; x++) for (let z = -9; z < 9; z++) {
    if (!isPlazaAnchor(x, z, cells)) continue;
    const keys = [keyOf(x, z), keyOf(x + 1, z), keyOf(x, z + 1), keyOf(x + 1, z + 1)];
    if (keys.some((key) => claimed.has(key))) continue;
    keys.forEach((key) => claimed.add(key));
    anchors.push(Object.freeze({ x, z }));
  }
  return Object.freeze(anchors);
}
