import {
  FORMATION_BY_ID,
  formationBusinessAffinity,
  formationOpeningPopulation,
  type FormationAffinity,
  type FormationFamily,
  type FormationOccurrence,
} from './formations.ts';
import type { BusinessType, Cell, FormationId, PlaceIdentityId } from './types.ts';

export type PlaceLandmarkKind =
  | 'market-barge'
  | 'seed-house'
  | 'guild-kiln'
  | 'roof-hall'
  | 'signal-beacon'
  | 'lantern-theatre';

export type PlaceLandmarkDefinition = Readonly<{
  kind: PlaceLandmarkKind;
  title: string;
  description: string;
  activity: string;
  effect: string;
}>;

export type PlaceIdentityDefinition = Readonly<{
  id: PlaceIdentityId;
  title: string;
  mark: string;
  description: string;
  hint: string;
  mysteryTitle: string;
  rumor: string;
  influence: string;
  businesses: readonly BusinessType[];
  requirements: readonly [string, string];
  range: number;
  landmark: PlaceLandmarkDefinition;
}>;

export type PlaceIdentityOccurrence = Readonly<{
  id: PlaceIdentityId;
  x: number;
  z: number;
  formations: readonly [FormationId, FormationId];
  members: readonly [FormationOccurrence, FormationOccurrence];
}>;

export type PlaceIdentityProgress = Readonly<{
  value: number;
  state: 'missing' | 'one-form' | 'distant' | 'active';
  requirements: readonly [string, string];
  found: readonly [boolean, boolean];
  hint: string;
  focus: Readonly<{ x: number; z: number }> | null;
}>;

export type PlaceLandmarkSocket = Readonly<{
  identityId: PlaceIdentityId;
  kind: PlaceLandmarkKind;
  title: string;
  description: string;
  activity: string;
  effect: string;
  x: number;
  z: number;
}>;

export const PLACE_IDENTITY_CATALOG: readonly PlaceIdentityDefinition[] = [
  {
    id: 'canal-market', title: 'Canal Market', mark: '≋',
    description: 'A sheltered waterway meets a busy built edge, making a natural exchange point between boats and doorways.',
    hint: 'Bring a water crossing close to an arcade row or harbor plaza.',
    mysteryTitle: 'A waterside exchange',
    rumor: 'Boat crews talk about a place where baskets could pass directly between water and doorways.',
    influence: 'Fish, food, lodging, and waterside trades arrive earlier and move larger batches.',
    businesses: ['fishmonger', 'restaurant', 'inn', 'mill', 'smokehouse'],
    requirements: ['water crossing', 'arcade row or harbor plaza'], range: 4,
    landmark: { kind: 'market-barge', title: 'Market Barge', description: 'A bright trading boat can only settle where a working street reaches a sheltered crossing.', activity: 'trading news and baskets at the market barge', effect: 'Its painted awning draws merchant boats into the harbor before the wider trade route is known.' },
  },
  {
    id: 'garden-commons', title: 'Garden Commons', mark: '✿',
    description: 'Sheltered ground and planted upper paths overlap into a green place shared across several levels.',
    hint: 'Bring a courtyard close to a terrace or shared rooftop.',
    mysteryTitle: 'A layered green',
    rumor: 'Gardeners wonder whether sheltered earth and sunny upper paths could begin sharing their seeds.',
    influence: 'Flowers, tea, cafés, pottery, and kitchens flourish around the layered gardens.',
    businesses: ['flower-shop', 'tea-house', 'cafe', 'pottery', 'restaurant'],
    requirements: ['courtyard', 'terrace or shared rooftop'], range: 4,
    landmark: { kind: 'seed-house', title: 'Seed House', description: 'A communal growing house replaces the ordinary courtyard garden where planted levels meet.', activity: 'swapping cuttings inside the seed house', effect: 'Seed trays and window boxes begin appearing on nearby homes.' },
  },
  {
    id: 'makers-walk', title: 'Makers’ Walk', mark: '⌁',
    description: 'A covered street meets a stepped route, giving workshops a continuous path for hands, tools, and deliveries.',
    hint: 'Bring an arcade row close to a stepped terrace.',
    mysteryTitle: 'A working passage',
    rumor: 'A covered street might carry the sound of tools farther if it met a route between levels.',
    influence: 'Workshops, weavers, potters, and booksellers arrive earlier and make larger batches.',
    businesses: ['workshop', 'weaver', 'pottery', 'bookstore'],
    requirements: ['arcade row', 'stepped terrace'], range: 4,
    landmark: { kind: 'guild-kiln', title: 'Guild Kiln', description: 'A shared kiln and work yard appear only where an arcade and stepped working route overlap.', activity: 'sharing tools beside the guild kiln', effect: 'Fired plaques and clay vessels mark the nearby workshop façades.' },
  },
  {
    id: 'roof-village', title: 'Roof Village', mark: '▤',
    description: 'A roof promenade joins a shared rooftop court, turning separate upper rooms into a small neighborhood in the sky.',
    hint: 'Bring a roof promenade close to a rooftop court.',
    mysteryTitle: 'A neighborhood above',
    rumor: 'At dusk, separate rooftops seem only one small common room away from becoming neighbors.',
    influence: 'Cafés, books, tea, and guest rooms benefit from the connected upper life.',
    businesses: ['cafe', 'bookstore', 'tea-house', 'inn'],
    requirements: ['roof promenade', 'shared rooftop court'], range: 4,
    landmark: { kind: 'roof-hall', title: 'Roof Hall', description: 'A little common hall replaces the ordinary roof-court planter when upper streets become a neighborhood.', activity: 'sharing tea in the roof hall', effect: 'Neighbors favor the hall at dusk, making rooftop friendships form through ordinary meetings.' },
  },
  {
    id: 'high-harbor', title: 'High Harbor', mark: '△',
    description: 'A high crossing and an overlook answer one another, joining the working tide to a view of the horizon.',
    hint: 'Bring a high bridge close to a lookout tower or elevated shared roof.',
    mysteryTitle: 'A signal above the tide',
    rumor: 'Sailors look for a place where a high crossing and a clear horizon could answer one another.',
    influence: 'Shipyards, workshops, and inns benefit from the connected crossing and clear horizon.',
    businesses: ['shipyard', 'workshop', 'inn'],
    requirements: ['high water crossing', 'lookout or elevated shared roof'], range: 5,
    landmark: { kind: 'signal-beacon', title: 'Signal Beacon', description: 'A harbor signal can settle only where a high crossing meets a clear overlook.', activity: 'reading the harbor signals from the signal beacon', effect: 'A small survey boat begins tracing the outer water by the beacon’s signals.' },
  },
  {
    id: 'lantern-square', title: 'Lantern Square', mark: '✧',
    description: 'A harbor plaza gathers taller gardens or rooftops around it and becomes an evening civic heart.',
    hint: 'Bring a harbor plaza close to a tier-two courtyard or rooftop form.',
    mysteryTitle: 'An evening heart',
    rumor: 'There are whispers of a square that would begin glowing only when higher gathering places overlook it.',
    influence: 'Restaurants, tea houses, cafés, inns, and booksellers thrive around the evening square.',
    businesses: ['restaurant', 'tea-house', 'cafe', 'inn', 'bookstore'],
    requirements: ['harbor plaza', 'tier-two courtyard or rooftop'], range: 5,
    landmark: { kind: 'lantern-theatre', title: 'Lantern Theatre', description: 'A tiny public stage replaces the ordinary plaza centerpiece where evening routes gather.', activity: 'watching the lantern theatre prepare for evening', effect: 'Its lamps become an evening anchor and draw residents into a nightly audience.' },
  },
] as const;

export const PLACE_IDENTITY_BY_ID = new Map(PLACE_IDENTITY_CATALOG.map((identity) => [identity.id, identity]));

function family(formation: FormationOccurrence): FormationFamily | undefined {
  return FORMATION_BY_ID.get(formation.id)?.family;
}

function tier(formation: FormationOccurrence) {
  return FORMATION_BY_ID.get(formation.id)?.tier ?? 0;
}

function matches(id: PlaceIdentityId, first: FormationOccurrence, second: FormationOccurrence) {
  const a = family(first);
  const b = family(second);
  const hasFamilies = (left: FormationFamily, right: FormationFamily) => (a === left && b === right) || (a === right && b === left);
  if (id === 'canal-market') return hasFamilies('water', 'street')
    || (a === 'water' && second.id === 'harbor-plaza') || (b === 'water' && first.id === 'harbor-plaza');
  if (id === 'garden-commons') return hasFamilies('courtyard', 'terrace') || hasFamilies('courtyard', 'rooftop');
  if (id === 'makers-walk') return hasFamilies('street', 'terrace');
  if (id === 'roof-village') return (first.id === 'roof-promenade' && b === 'rooftop') || (second.id === 'roof-promenade' && a === 'rooftop');
  if (id === 'high-harbor') {
    const highWater = a === 'water' && tier(first) >= 3 ? first : b === 'water' && tier(second) >= 3 ? second : null;
    const partner = highWater === first ? second : first;
    return Boolean(highWater && (partner.id === 'lookout-tower' || (family(partner) === 'rooftop' && tier(partner) >= 2)));
  }
  if (id === 'lantern-square') {
    const plaza = first.id === 'harbor-plaza' ? first : second.id === 'harbor-plaza' ? second : null;
    const partner = plaza === first ? second : first;
    return Boolean(plaza && ['courtyard', 'rooftop'].includes(family(partner) ?? '') && tier(partner) >= 2);
  }
  return false;
}

function roleMatches(id: PlaceIdentityId, role: 0 | 1, formation: FormationOccurrence) {
  const formationFamily = family(formation);
  if (id === 'canal-market') return role === 0 ? formationFamily === 'water' : formationFamily === 'street' || formation.id === 'harbor-plaza';
  if (id === 'garden-commons') return role === 0 ? formationFamily === 'courtyard' : formationFamily === 'terrace' || formationFamily === 'rooftop';
  if (id === 'makers-walk') return role === 0 ? formationFamily === 'street' : formationFamily === 'terrace';
  if (id === 'roof-village') return role === 0 ? formation.id === 'roof-promenade' : formationFamily === 'rooftop';
  if (id === 'high-harbor') return role === 0
    ? formationFamily === 'water' && tier(formation) >= 3
    : formation.id === 'lookout-tower' || formationFamily === 'rooftop' && tier(formation) >= 2;
  return role === 0
    ? formation.id === 'harbor-plaza'
    : (formationFamily === 'courtyard' || formationFamily === 'rooftop') && tier(formation) >= 2;
}

export function detectPlaceIdentities(formations: readonly FormationOccurrence[]): readonly PlaceIdentityOccurrence[] {
  const found: PlaceIdentityOccurrence[] = [];
  for (const definition of PLACE_IDENTITY_CATALOG) {
    const range = definition.range;
    for (let firstIndex = 0; firstIndex < formations.length; firstIndex++) {
      for (let secondIndex = firstIndex + 1; secondIndex < formations.length; secondIndex++) {
        const first = formations[firstIndex];
        const second = formations[secondIndex];
        const distance = Math.abs(first.x - second.x) + Math.abs(first.z - second.z);
        if (distance > range || !matches(definition.id, first, second)) continue;
        const x = Math.round((first.x + second.x) / 2);
        const z = Math.round((first.z + second.z) / 2);
        if (found.some((identity) => identity.id === definition.id && Math.abs(identity.x - x) + Math.abs(identity.z - z) <= 2)) continue;
        found.push(Object.freeze({ id: definition.id, x, z, formations: [first.id, second.id] as const, members: [first, second] as const }));
      }
    }
  }
  return Object.freeze(found);
}

export function placeIdentityProgress(id: PlaceIdentityId, formations: readonly FormationOccurrence[]): PlaceIdentityProgress {
  const definition = PLACE_IDENTITY_BY_ID.get(id)!;
  const active = detectPlaceIdentities(formations).find((occurrence) => occurrence.id === id);
  if (active) return Object.freeze({
    value: 1,
    state: 'active',
    requirements: definition.requirements,
    found: [true, true] as const,
    hint: `${definition.landmark.title} has settled here.`,
    focus: { x: active.x, z: active.z },
  });
  const first = formations.filter((formation) => roleMatches(id, 0, formation));
  const second = formations.filter((formation) => roleMatches(id, 1, formation));
  if (first.length && second.length) {
    const closest = first.flatMap((a) => second.filter((b) => b !== a).map((b) => ({
      a, b, distance: Math.abs(a.x - b.x) + Math.abs(a.z - b.z),
    }))).sort((a, b) => a.distance - b.distance)[0];
    if (closest) return Object.freeze({
      value: .75,
      state: 'distant',
      requirements: definition.requirements,
      found: [true, true] as const,
      hint: `Both forms exist. Bring them within ${definition.range} tiles of one another.`,
      focus: { x: closest.a.x, z: closest.a.z },
    });
  }
  const found: readonly [boolean, boolean] = [first.length > 0, second.length > 0];
  const missing = !found[0] && !found[1] ? definition.hint : `Shape ${definition.requirements[found[0] ? 1 : 0]} near the form already here.`;
  const focusFormation = first[0] ?? second[0];
  return Object.freeze({
    value: found[0] || found[1] ? .45 : 0,
    state: found[0] || found[1] ? 'one-form' : 'missing',
    requirements: definition.requirements,
    found,
    hint: missing,
    focus: focusFormation ? { x: focusFormation.x, z: focusFormation.z } : null,
  });
}

export function livingPlaceIntroductionReady(
  knownFormations: ReadonlySet<FormationId>,
  activeFormations: readonly FormationOccurrence[],
  residentCount: number,
) {
  const activeFamilies = new Set(activeFormations
    .map((formation) => FORMATION_BY_ID.get(formation.id)?.family)
    .filter((family): family is FormationFamily => Boolean(family)));
  return knownFormations.size >= 3 && activeFamilies.size >= 2 && residentCount >= 3;
}

export function placeLandmarkSocket(occurrence: PlaceIdentityOccurrence): PlaceLandmarkSocket {
  const definition = PLACE_IDENTITY_BY_ID.get(occurrence.id)!;
  const preferred = occurrence.members.find((member) => {
    const memberFamily = family(member);
    if (occurrence.id === 'canal-market') return memberFamily === 'water';
    if (occurrence.id === 'garden-commons') return memberFamily === 'courtyard';
    if (occurrence.id === 'makers-walk') return memberFamily === 'street';
    if (occurrence.id === 'roof-village') return memberFamily === 'rooftop';
    if (occurrence.id === 'high-harbor') return memberFamily !== 'water';
    return member.id === 'harbor-plaza';
  }) ?? occurrence.members[0];
  return Object.freeze({
    identityId: occurrence.id,
    ...definition.landmark,
    x: preferred.x,
    z: preferred.z,
  });
}

export type PlaceAffinity = FormationAffinity & Readonly<{ identity?: PlaceIdentityDefinition }>;

export function placeBusinessAffinity(
  type: BusinessType,
  location: Pick<Cell, 'x' | 'z'>,
  formations: readonly FormationOccurrence[],
): PlaceAffinity {
  const base = formationBusinessAffinity(type, location, formations);
  let best: PlaceAffinity = base;
  for (const occurrence of detectPlaceIdentities(formations)) {
    const identity = PLACE_IDENTITY_BY_ID.get(occurrence.id);
    if (!identity?.businesses.includes(type)) continue;
    const distance = Math.abs(location.x - occurrence.x) + Math.abs(location.z - occurrence.z);
    if (distance > 4) continue;
    const score = Math.max(0, 10 - distance * 1.5);
    if (score > best.score) best = { score, identity };
  }
  return best;
}

export function placeOpeningPopulation(type: BusinessType, basePopulation: number, formations: readonly FormationOccurrence[]) {
  const identitySupports = detectPlaceIdentities(formations)
    .some((occurrence) => PLACE_IDENTITY_BY_ID.get(occurrence.id)?.businesses.includes(type));
  return identitySupports ? Math.max(2, basePopulation - 3) : formationOpeningPopulation(type, basePopulation, formations);
}

export function placeIdentityActivity(id: PlaceIdentityId, ageGroup?: string, occupation?: string) {
  if (id === 'canal-market') return occupation === 'Fisher' ? 'bringing news from the boats to the canal market' : 'browsing baskets along the canal market';
  if (id === 'garden-commons') return occupation === 'Gardener' ? 'tending the layered garden commons' : 'sharing a quiet bench in the garden commons';
  if (id === 'makers-walk') return ageGroup === 'child' ? 'watching the makers at work along the makers’ walk' : 'carrying small errands along the makers’ walk';
  if (id === 'roof-village') return 'visiting neighbors across the roof village';
  if (id === 'high-harbor') return 'watching sails cross beneath the high harbor';
  return 'meeting neighbors as the lantern square begins to glow';
}
