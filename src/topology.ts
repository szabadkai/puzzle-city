import type { Cell } from './types';
import { keyOf } from './types';

export type PlazaAnchor = Readonly<{ x: number; z: number }>;

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
