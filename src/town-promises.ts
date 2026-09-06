import { hash } from './random.ts';
import type {
  BusinessSave,
  Cell,
  FormationId,
  HarborProfileSave,
  PlaceIdentityId,
  TownPromiseId,
} from './types.ts';

export type PromiseFormation = Readonly<{ id: FormationId; x: number; z: number }>;
export type PromisePlace = Readonly<{ id: PlaceIdentityId; x: number; z: number }>;

export type TownPromiseSnapshot = Readonly<{
  profile: HarborProfileSave;
  cells: readonly Cell[];
  formations: readonly PromiseFormation[];
  places: readonly PromisePlace[];
  businesses: readonly BusinessSave[];
}>;

export type TownPromiseProgress = Readonly<{
  value: number;
  complete: boolean;
  summary: string;
}>;

export type TownPromiseDefinition = Readonly<{
  id: TownPromiseId;
  title: string;
  description: string;
  reward: string;
  progress: (snapshot: TownPromiseSnapshot) => TownPromiseProgress;
}>;

function hasPlace(snapshot: TownPromiseSnapshot, id: PlaceIdentityId) {
  return snapshot.places.some((place) => place.id === id);
}

function result(checks: readonly [boolean, string][]) {
  const met = checks.filter(([complete]) => complete).length;
  return Object.freeze({
    value: met / checks.length,
    complete: met === checks.length,
    summary: checks.map(([complete, label]) => `${complete ? '✓' : '○'} ${label}`).join(' · '),
  });
}

function buildingsSpanCurrent(snapshot: TownPromiseSnapshot) {
  const currents = snapshot.profile.constraints.filter((cell) => cell.type === 'deep-current');
  if (!currents.length || snapshot.cells.length < 2) return false;
  const xSpread = Math.max(...currents.map((cell) => cell.x)) - Math.min(...currents.map((cell) => cell.x));
  const zSpread = Math.max(...currents.map((cell) => cell.z)) - Math.min(...currents.map((cell) => cell.z));
  if (zSpread >= xSpread) {
    const line = currents.reduce((sum, cell) => sum + cell.x, 0) / currents.length;
    return snapshot.cells.some((cell) => cell.x < line - .5) && snapshot.cells.some((cell) => cell.x > line + .5);
  }
  const line = currents.reduce((sum, cell) => sum + cell.z, 0) / currents.length;
  return snapshot.cells.some((cell) => cell.z < line - .5) && snapshot.cells.some((cell) => cell.z > line + .5);
}

export const TOWN_PROMISE_CATALOG: readonly TownPromiseDefinition[] = [
  {
    id: 'between-two-waters',
    title: 'Between Two Waters',
    description: 'Let homes find both sides of the harbor, then give the separated shores a crossing.',
    reward: 'A double-sided harbor pennant becomes a keepsake.',
    progress: (snapshot) => result([
      [buildingsSpanCurrent(snapshot), 'homes on both sides'],
      [snapshot.formations.some((formation) => ['sea-arch', 'high-bridge', 'covered-skybridge', 'lantern-gate'].includes(formation.id)), 'a crossing between them'],
    ]),
  },
  {
    id: 'gardens-above',
    title: 'Gardens Above',
    description: 'Establish planted life in shelter and on the town’s upper paths.',
    reward: 'An heirloom seed packet joins the town keepsakes.',
    progress: (snapshot) => result([
      [snapshot.formations.some((formation) => ['terraced-garden', 'lantern-stair', 'rooftop-pavilion', 'hanging-roof-garden'].includes(formation.id)), 'an upper garden form'],
      [hasPlace(snapshot, 'garden-commons'), 'a Garden Commons'],
    ]),
  },
  {
    id: 'makers-tide',
    title: 'The Makers’ Tide',
    description: 'Let several crafts gather around a continuous working place.',
    reward: 'A makers’ stamp becomes a fired detail on future commissions.',
    progress: (snapshot) => {
      const makers = new Set(snapshot.businesses
        .filter((business) => ['workshop', 'weaver', 'pottery', 'bookstore'].includes(business.type))
        .map((business) => business.type));
      return result([
        [hasPlace(snapshot, 'makers-walk'), 'a Makers’ Walk'],
        [makers.size >= 2, 'two kinds of maker'],
      ]);
    },
  },
  {
    id: 'returning-light',
    title: 'A Light for Returning Boats',
    description: 'Shape a High Harbor whose crossing and clear horizon can answer the tide.',
    reward: 'The first expedition from its beacon carries a promise pennant.',
    progress: (snapshot) => result([
      [snapshot.formations.some((formation) => ['high-bridge', 'covered-skybridge', 'lantern-gate'].includes(formation.id)), 'a high crossing'],
      [hasPlace(snapshot, 'high-harbor'), 'a High Harbor'],
    ]),
  },
  {
    id: 'evenings-for-everyone',
    title: 'Evenings Belong to Everyone',
    description: 'Establish a civic gathering place where the harbor can settle together at dusk.',
    reward: 'A shared lantern design is remembered by the town.',
    progress: (snapshot) => result([
      [snapshot.formations.some((formation) => formation.id === 'harbor-plaza'), 'a harbor plaza'],
      [hasPlace(snapshot, 'lantern-square'), 'a Lantern Square'],
    ]),
  },
] as const;

export const TOWN_PROMISE_BY_ID = new Map(TOWN_PROMISE_CATALOG.map((promise) => [promise.id, promise]));

const ARCHETYPE_AFFINITY: Record<HarborProfileSave['archetype'], Partial<Record<TownPromiseId, number>>> = {
  'classic-harbor': {},
  'split-channel': { 'between-two-waters': 5, 'returning-light': 2, 'makers-tide': 1 },
  'sheltered-lagoon': { 'gardens-above': 5, 'evenings-for-everyone': 3, 'makers-tide': 1 },
  'stepping-stones': { 'returning-light': 5, 'between-two-waters': 3, 'gardens-above': 1 },
  'long-shoal': { 'makers-tide': 5, 'between-two-waters': 3, 'evenings-for-everyone': 1 },
};

export function offeredTownPromises(seed: number, profile: HarborProfileSave) {
  return Object.freeze([...TOWN_PROMISE_CATALOG]
    .sort((a, b) => {
      const affinity = (ARCHETYPE_AFFINITY[profile.archetype][b.id] ?? 0) - (ARCHETYPE_AFFINITY[profile.archetype][a.id] ?? 0);
      if (affinity) return affinity;
      return hash(seed, b.id.length, profile.generatorVersion, 8450) - hash(seed, a.id.length, profile.generatorVersion, 8450)
        || a.id.localeCompare(b.id);
    })
    .slice(0, 3));
}

export function townPromiseProgress(id: TownPromiseId, snapshot: TownPromiseSnapshot) {
  return TOWN_PROMISE_BY_ID.get(id)?.progress(snapshot) ?? Object.freeze({ value: 0, complete: false, summary: 'Promise unavailable.' });
}
