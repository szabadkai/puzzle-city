import { CARDINALS, type Cell, type FormationId, keyOf } from './types.ts';

type Cells = ReadonlyMap<string, Cell>;
export type SpacePoint = Readonly<{ x: number; z: number }>;
export type HarborSpace = Readonly<{
  id: FormationId;
  kind: 'basin' | 'lane';
  anchor: SpacePoint;
  tiles: readonly SpacePoint[];
  /** Basin mouth points toward open water; lane directions come from its neighbors. */
  direction: number;
}>;
export type HarborSpaces = Readonly<{
  spaces: readonly HarborSpace[];
  byTile: ReadonlyMap<string, HarborSpace>;
  ground: ReadonlySet<string>;
  plazas: readonly SpacePoint[];
}>;

const cache = new WeakMap<Cells, { signature: string; result: HarborSpaces }>();
// Simulations clone cell maps; a bounded occupancy cache shares their geometry.
const layoutCache = new Map<string, HarborSpaces>();
const pointOrder = (a: SpacePoint, b: SpacePoint) => a.z - b.z || a.x - b.x;
const pointKey = (point: SpacePoint) => keyOf(point.x, point.z);

function rawPlazas(cells: Cells, reserved: ReadonlySet<string> = new Set()) {
  const anchors: SpacePoint[] = [];
  const claimed = new Set<string>();
  for (let x = -9; x < 9; x++) for (let z = -9; z < 9; z++) {
    const inside = [keyOf(x, z), keyOf(x + 1, z), keyOf(x, z + 1), keyOf(x + 1, z + 1)];
    if (inside.some((key) => cells.has(key) || reserved.has(key) || claimed.has(key))) continue;
    const perimeter = [[x, z - 1], [x + 1, z - 1], [x, z + 2], [x + 1, z + 2],
      [x - 1, z], [x - 1, z + 1], [x + 2, z], [x + 2, z + 1]];
    if (perimeter.filter(([px, pz]) => cells.has(keyOf(px, pz))).length < 6) continue;
    anchors.push({ x, z });
    inside.forEach((key) => claimed.add(key));
  }
  return anchors;
}

function groundFor(cells: Cells, plazas: readonly SpacePoint[], reserved: ReadonlySet<string>) {
  const ground = new Set<string>();
  for (const { x, z } of plazas) for (const dx of [0, 1]) for (const dz of [0, 1]) ground.add(keyOf(x + dx, z + dz));
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
    const key = keyOf(x, z);
    if (cells.has(key) || reserved.has(key)) continue;
    if (CARDINALS.filter(([dx, dz]) => cells.has(keyOf(x + dx, z + dz))).length >= 3) ground.add(key);
  }
  return ground;
}

/** One shared geometry decision for architecture, the Atlas, feet, and boats.
 * Heights never change these shapes. Cache checks occupancy so in-place edits
 * invalidate it, while raising a roof leaves the layout untouched. */
export function analyzeHarborSpaces(cells: Cells): HarborSpaces {
  const signature = [...cells.keys()].join(';');
  const cached = cache.get(cells);
  if (cached?.signature === signature) return cached.result;
  const layoutKey = [...cells.keys()].sort().join(';');
  const shared = layoutCache.get(layoutKey);
  if (shared) {
    cache.set(cells, { signature, result: shared });
    return shared;
  }
  const rawGround = groundFor(cells, rawPlazas(cells), new Set());
  const candidates: HarborSpace[] = [];
  const emptyNeighbors = new Map<string, SpacePoint>();
  for (const cell of cells.values()) for (const [dx, dz] of CARDINALS) {
    const point = { x: cell.x + dx, z: cell.z + dz };
    if (!cells.has(pointKey(point)) && Math.abs(point.x) <= 9 && Math.abs(point.z) <= 9) emptyNeighbors.set(pointKey(point), point);
  }
  const reachesSea = (start: SpacePoint, reserved: Set<string>) => {
    const pending = [start], visited = new Set<string>();
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const point = pending[cursor], key = pointKey(point);
      if (visited.has(key) || cells.has(key) || rawGround.has(key) && !reserved.has(key)) continue;
      if (Math.abs(point.x) > 9 || Math.abs(point.z) > 9) return true;
      visited.add(key);
      for (const [dx, dz] of CARDINALS) pending.push({ x: point.x + dx, z: point.z + dz });
    }
    return false;
  };

  // A two-to-four-wide, three-to-five-deep inlet has a continuous back and
  // two banks. Unlike the old 2x2 plaza it has a deliberate seaward mouth.
  for (const origin of emptyNeighbors.values()) for (let direction = 0; direction < 4; direction++) {
    const [dx, dz] = CARDINALS[direction], lx = dz, lz = -dx;
    const at = (side: number, depth: number) => ({ x: origin.x + lx * side + dx * depth, z: origin.z + lz * side + dz * depth });
    for (let width = 2; width <= 4; width++) for (let depth = 3; depth <= 5; depth++) {
      const inside: SpacePoint[] = [], walls: SpacePoint[] = [];
      for (let side = 0; side < width; side++) {
        walls.push(at(side, -1));
        for (let run = 0; run < depth; run++) inside.push(at(side, run));
      }
      for (let run = 0; run < depth; run++) walls.push(at(-1, run), at(width, run));
      if (walls.some((point) => !cells.has(pointKey(point))) || inside.some((point) => cells.has(pointKey(point)) || Math.abs(point.x) > 9 || Math.abs(point.z) > 9)) continue;
      const mouth = Array.from({ length: width }, (_, side) => at(side, depth)).filter((point) => !cells.has(pointKey(point)));
      if (mouth.length !== width && mouth.length !== 1) continue;
      const tiles = [...inside, ...mouth], reserved = new Set(tiles.map(pointKey));
      if (!reachesSea(mouth[0], reserved)) continue;
      candidates.push({ kind: 'basin', id: mouth.length === 1 ? 'boat-haven' : inside.length >= 9 ? 'working-basin' : 'sheltered-basin',
        anchor: [...inside].sort(pointOrder)[0], tiles, direction });
    }
  }
  candidates.sort((a, b) => b.tiles.length - a.tiles.length || pointOrder(a.anchor, b.anchor) || a.direction - b.direction);
  const spaces: HarborSpace[] = [], byTile = new Map<string, HarborSpace>();
  for (const space of candidates) {
    if (space.tiles.some((point) => byTile.has(pointKey(point)))) continue;
    spaces.push(space);
    space.tiles.forEach((point) => byTile.set(pointKey(point), space));
  }
  const reserved = new Set(byTile.keys());
  const plazas = rawPlazas(cells, reserved);
  const ground = groundFor(cells, plazas, reserved);
  // A plaza has four ground tiles but is only one destination. Count connected
  // dry spaces, so looping beside one square cannot earn three market exits.
  const dryRegions = new Map<string, string>();
  for (const origin of ground) {
    if (dryRegions.has(origin)) continue;
    const pending = [origin];
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const key = pending[cursor];
      if (dryRegions.has(key)) continue;
      dryRegions.set(key, origin);
      const [x, z] = key.split(',').map(Number);
      for (const [dx, dz] of CARDINALS) {
        const next = keyOf(x + dx, z + dz);
        if (ground.has(next) && !dryRegions.has(next)) pending.push(next);
      }
    }
  }

  // Lanes join existing dry courts/plazas. Two facing rows alone stay canals.
  // Corner gaps and junctions allow a route to bend or branch without tools.
  const passages = new Map<string, SpacePoint>();
  for (const [key, point] of emptyNeighbors) {
    if (reserved.has(key) || ground.has(key)) continue;
    if (CARDINALS.filter(([dx, dz]) => cells.has(keyOf(point.x + dx, point.z + dz))).length === 2) passages.set(key, point);
  }
  const junctions: SpacePoint[] = [];
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
    const key = keyOf(x, z);
    if (cells.has(key) || reserved.has(key) || ground.has(key) || passages.has(key)) continue;
    if (CARDINALS.filter(([dx, dz]) => passages.has(keyOf(x + dx, z + dz))).length >= 3) junctions.push({ x, z });
  }
  junctions.forEach((point) => passages.set(pointKey(point), point));
  const visited = new Set<string>();
  for (const start of passages.values()) {
    if (visited.has(pointKey(start))) continue;
    const tiles: SpacePoint[] = [], pending = [start], ends = new Set<string>();
    let leaks = false, branched = false;
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const point = pending[cursor], key = pointKey(point);
      if (visited.has(key)) continue;
      visited.add(key); tiles.push(point);
      let connections = 0;
      for (const [dx, dz] of CARDINALS) {
        const next = keyOf(point.x + dx, point.z + dz);
        if (passages.has(next)) { pending.push(passages.get(next)!); connections++; }
        else if (ground.has(next)) { ends.add(dryRegions.get(next)!); connections++; }
        else if (!cells.has(next)) leaks = true;
      }
      if (connections >= 3) branched = true;
    }
    if (leaks || ends.size < 2 || tiles.length < 2) continue;
    tiles.sort(pointOrder);
    const space: HarborSpace = { kind: 'lane', id: branched && ends.size >= 3 ? 'market-lanes' : tiles.length >= 4 ? 'through-lane' : 'pocket-lane',
      anchor: tiles[0], tiles, direction: 0 };
    spaces.push(space);
    for (const point of tiles) { byTile.set(pointKey(point), space); ground.add(pointKey(point)); }
  }
  const result = Object.freeze({ spaces: Object.freeze(spaces), byTile, ground, plazas: Object.freeze(plazas) });
  cache.set(cells, { signature, result });
  layoutCache.set(layoutKey, result);
  if (layoutCache.size > 16) layoutCache.delete(layoutCache.keys().next().value!);
  return result;
}
