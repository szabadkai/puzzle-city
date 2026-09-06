import { hash } from './random.ts';
import { CARDINALS, keyOf, type HarborArchetype, type HarborConstraintCell, type HarborProfileSave, type WorldPackId } from './types.ts';

export const HARBOR_GENERATOR_VERSION = 1;
export const HARBOR_RADIUS = 8.8;

const ARCHETYPES: readonly Exclude<HarborArchetype, 'classic-harbor'>[] = [
  'split-channel',
  'sheltered-lagoon',
  'stepping-stones',
  'long-shoal',
] as const;

const TITLES: Record<HarborArchetype, string> = {
  'classic-harbor': 'Classic Harbor',
  'split-channel': 'Split Channel',
  'sheltered-lagoon': 'Sheltered Lagoon',
  'stepping-stones': 'Stepping Stones',
  'long-shoal': 'Long Shoal',
};

type MutableConstraint = { x: number; z: number; type: HarborConstraintCell['type']; detail?: 'reef' };

function withinHarbor(x: number, z: number) {
  return Math.hypot(x, z) <= HARBOR_RADIUS;
}

function transformPoint(x: number, z: number, quarterTurns: number, reflected: boolean) {
  let px = reflected ? -x : x;
  let pz = z;
  for (let turn = 0; turn < quarterTurns; turn++) [px, pz] = [-pz, px];
  return { x: px, z: pz };
}

function basePattern(archetype: Exclude<HarborArchetype, 'classic-harbor'>) {
  const cells = new Map<string, MutableConstraint>();
  const set = (x: number, z: number, type: MutableConstraint['type']) => {
    if (withinHarbor(x, z)) cells.set(keyOf(x, z), { x, z, type });
  };
  let firstTide = { x: 0, z: 0 };

  if (archetype === 'split-channel') {
    firstTide = { x: -3, z: 0 };
    for (let z = -8; z <= 8; z++) {
      set(0, z, 'deep-current');
      if (Math.abs(z) <= 7) set(-1, z, 'shoal');
      if (Math.abs(z) <= 7) set(1, z, 'shoal');
    }
    set(-1, -5, 'rock-outcrop');
    set(1, 4, 'rock-outcrop');
  } else if (archetype === 'sheltered-lagoon') {
    firstTide = { x: 0, z: 0 };
    for (let x = -4; x <= 4; x++) for (let z = -4; z <= 4; z++) {
      const distance = Math.hypot(x, z);
      if (distance <= 3.65 && distance >= 1.35) set(x, z, 'shoal');
    }
    for (let z = -6; z <= 6; z++) {
      const x = 5 - Math.round(Math.abs(z) * .18);
      set(x, z, 'deep-current');
      if (Math.abs(z) < 5) set(x - 1, z, 'shoal');
    }
    set(-2, -1, 'rock-outcrop');
    set(2, 1, 'rock-outcrop');
  } else if (archetype === 'stepping-stones') {
    firstTide = { x: -5, z: -3 };
    const anchors = [[-2, -2], [2, -1], [-1, 2], [3, 3]] as const;
    for (const [x, z] of anchors) {
      set(x, z, 'rock-outcrop');
      for (const [dx, dz] of CARDINALS) set(x + dx, z + dz, 'deep-current');
    }
    for (let x = -7; x <= 7; x++) if (x % 2 === 0) set(x, -5, 'shoal');
  } else {
    firstTide = { x: -4, z: 0 };
    for (let x = -7; x <= 7; x++) {
      set(x, 0, 'shoal');
      set(x, -1, 'deep-current');
      set(x, 1, 'deep-current');
    }
    set(-7, 0, 'rock-outcrop');
    set(0, 0, 'rock-outcrop');
    set(7, 0, 'rock-outcrop');
  }

  return { cells: [...cells.values()], firstTide };
}

function tradeWindDetails(seed: number, cells: MutableConstraint[]) {
  const byKey = new Map(cells.map((cell) => [keyOf(cell.x, cell.z), cell]));
  for (const cell of cells) {
    if (cell.type === 'shoal' && hash(seed, cell.x, cell.z, 8311) > .18) cell.detail = 'reef';
  }
  // A visible reef shelf adds shallow-water choices without sealing any route.
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
    if (!withinHarbor(x, z) || byKey.has(keyOf(x, z))) continue;
    const nearCurrent = CARDINALS.some(([dx, dz]) => byKey.get(keyOf(x + dx, z + dz))?.type === 'deep-current');
    if (!nearCurrent || hash(seed, x, z, 8312) < .62) continue;
    const reef: MutableConstraint = { x, z, type: 'shoal', detail: 'reef' };
    cells.push(reef);
    byKey.set(keyOf(x, z), reef);
  }
}

function seededNaturalDetails(seed: number, cells: MutableConstraint[], firstTide: Readonly<{ x: number; z: number }>, worldPackId: WorldPackId) {
  const byKey = new Map(cells.map((cell) => [keyOf(cell.x, cell.z), cell]));
  const candidates: Array<{ x: number; z: number; order: number }> = [];
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
    if (!withinHarbor(x, z) || byKey.has(keyOf(x, z))) continue;
    if (Math.abs(x - firstTide.x) + Math.abs(z - firstTide.z) <= 3) continue;
    candidates.push({ x, z, order: hash(seed, x, z, worldPackId === 'trade-wind-isles' ? 8341 : 8340) });
  }
  candidates.sort((a, b) => b.order - a.order || a.z - b.z || a.x - b.x);
  candidates.slice(0, 8).forEach((candidate, index) => {
    const cell: MutableConstraint = {
      x: candidate.x,
      z: candidate.z,
      type: index >= 6 ? 'rock-outcrop' : 'shoal',
      detail: worldPackId === 'trade-wind-isles' && index < 6 ? 'reef' : undefined,
    };
    cells.push(cell);
    byKey.set(keyOf(cell.x, cell.z), cell);
  });
}

export function classicHarborProfile(): HarborProfileSave {
  return Object.freeze({
    generatorVersion: 0,
    archetype: 'classic-harbor',
    title: TITLES['classic-harbor'],
    firstTide: Object.freeze({ x: 0, z: 0 }),
    constraints: Object.freeze([]),
  });
}

export function generateHarborProfile(
  seed: number,
  worldPackId: WorldPackId = 'classic-harbor',
  generatorVersion = HARBOR_GENERATOR_VERSION,
): HarborProfileSave {
  if (generatorVersion !== HARBOR_GENERATOR_VERSION) throw new Error(`Unknown harbor generator version ${generatorVersion}.`);
  const packSalt = worldPackId === 'trade-wind-isles' ? 4937 : 0;
  const archetype = ARCHETYPES[Math.floor(hash(seed, generatorVersion, packSalt, 8100) * ARCHETYPES.length) % ARCHETYPES.length];
  const pattern = basePattern(archetype);
  const quarterTurns = Math.floor(hash(seed, generatorVersion, packSalt, 8101) * 4);
  const reflected = hash(seed, generatorVersion, packSalt, 8102) > .5;
  const transformed = pattern.cells.map((cell) => ({
    ...transformPoint(cell.x, cell.z, quarterTurns, reflected),
    type: cell.type,
    detail: cell.detail,
  }));
  const firstTide = transformPoint(pattern.firstTide.x, pattern.firstTide.z, quarterTurns, reflected);
  seededNaturalDetails(seed, transformed, firstTide, worldPackId);
  if (worldPackId === 'trade-wind-isles') tradeWindDetails(seed, transformed);
  const constraints = Object.freeze(transformed
    .sort((a, b) => a.z - b.z || a.x - b.x)
    .map((cell) => Object.freeze(cell)));
  const profile = Object.freeze({
    generatorVersion,
    archetype,
    title: TITLES[archetype],
    firstTide: Object.freeze(firstTide),
    constraints,
  });
  const feasibility = checkHarborFeasibility(profile);
  if (!feasibility.valid) throw new Error(`Generated an infeasible ${archetype}: ${feasibility.reasons.join(', ')}`);
  return profile;
}

export function constraintAt(profile: HarborProfileSave, x: number, z: number) {
  return profile.constraints.find((cell) => cell.x === x && cell.z === z);
}

export function isFoundationPosition(profile: HarborProfileSave, x: number, z: number) {
  return withinHarbor(x, z) && constraintAt(profile, x, z)?.type !== 'deep-current';
}

export type HarborFeasibility = Readonly<{
  valid: boolean;
  buildablePositions: number;
  largestConnectedArea: number;
  formationFamilies: readonly string[];
  reasons: readonly string[];
}>;

export function checkHarborFeasibility(profile: HarborProfileSave): HarborFeasibility {
  const buildable = new Set<string>();
  for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) {
    if (isFoundationPosition(profile, x, z)) buildable.add(keyOf(x, z));
  }
  let largestConnectedArea = 0;
  const unseen = new Set(buildable);
  while (unseen.size) {
    const first = unseen.values().next().value as string;
    const queue = [first];
    unseen.delete(first);
    let count = 0;
    while (queue.length) {
      const [x, z] = queue.pop()!.split(',').map(Number);
      count += 1;
      for (const [dx, dz] of CARDINALS) {
        const next = keyOf(x + dx, z + dz);
        if (unseen.delete(next)) queue.push(next);
      }
    }
    largestConnectedArea = Math.max(largestConnectedArea, count);
  }

  const isBuildable = (x: number, z: number) => buildable.has(keyOf(x, z));
  const families = new Set<string>();
  for (const key of buildable) {
    const [x, z] = key.split(',').map(Number);
    if (CARDINALS.some(([dx, dz]) => isBuildable(x + dx, z + dz))) families.add('street');
    if ((isBuildable(x + 1, z) && isBuildable(x + 2, z)) || (isBuildable(x, z + 1) && isBuildable(x, z + 2))) families.add('terrace');
    if (isBuildable(x + 1, z) && isBuildable(x, z + 1) && isBuildable(x + 1, z + 1)) families.add('rooftop');
    if (CARDINALS.filter(([dx, dz]) => isBuildable(x + dx, z + dz)).length >= 3) families.add('courtyard');
    if ((isBuildable(x - 1, z) && isBuildable(x + 1, z)) || (isBuildable(x, z - 1) && isBuildable(x, z + 1))) families.add('water');
  }
  if (buildable.size) families.add('landmark');

  const start = profile.firstTide;
  const firstTideRoute = isBuildable(start.x, start.z) && CARDINALS.some(([dx, dz]) =>
    isBuildable(start.x + dx * 2, start.z + dz * 2)
    && CARDINALS.some(([nx, nz]) => isBuildable(start.x + dx * 2 + nx, start.z + dz * 2 + nz)));
  const reasons: string[] = [];
  if (!firstTideRoute) reasons.push('no First Tide route');
  if (largestConnectedArea < 12) reasons.push('fewer than twelve connected foundations');
  if (families.size < 4) reasons.push('too few formation families');
  return Object.freeze({
    valid: reasons.length === 0,
    buildablePositions: buildable.size,
    largestConnectedArea,
    formationFamilies: Object.freeze([...families].sort()),
    reasons: Object.freeze(reasons),
  });
}
