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
  | 'lantern-theatre'
  | 'ferry-house'
  | 'tide-cistern'
  | 'reading-loggia'
  | 'wind-loom'
  | 'tide-bell'
  | 'post-house'
  | 'star-dial'
  | 'kite-loft';

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
  trace: string;
  businesses: readonly BusinessType[];
  requirements: readonly [string, string];
  range: number;
  influenceRadius: number;
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
    description: 'A covered street meets a sheltered waterway, so boats can trade directly with the shops.',
    hint: 'Bring a water crossing close to an arcade row.',
    mysteryTitle: 'A waterside exchange',
    rumor: 'Boat crews talk about a place where baskets could pass directly between water and doorways.',
    influence: 'Nearby fishmongers, restaurants, inns, mills, and smokehouses open with fewer residents and produce larger batches.',
    trace: 'Painted awnings, cargo hooks, and market baskets spread along the nearby waterfront.',
    businesses: ['fishmonger', 'restaurant', 'inn', 'mill', 'smokehouse'],
    requirements: ['water crossing', 'arcade row'], range: 2, influenceRadius: 4,
    landmark: { kind: 'market-barge', title: 'Market Barge', description: 'A painted trading boat moors where the arcade reaches the sheltered crossing.', activity: 'trading news and baskets at the market barge', effect: 'Its awning draws merchant boats into the harbor before the regular trade route opens.' },
  },
  {
    id: 'garden-commons', title: 'Garden Commons', mark: '✿',
    description: 'A courtyard shares seeds and cuttings with gardens on the roofs above it.',
    hint: 'Bring a courtyard close to a terrace or shared rooftop.',
    mysteryTitle: 'A layered green',
    rumor: 'Gardeners wonder whether sheltered earth and sunny upper paths could begin sharing their seeds.',
    influence: 'Nearby flower shops, tea houses, cafes, potteries, and restaurants open with fewer residents and produce larger batches.',
    trace: 'Seed trays, window boxes, and exchanged cuttings spread from doorway to rooftop.',
    businesses: ['flower-shop', 'tea-house', 'cafe', 'pottery', 'restaurant'],
    requirements: ['courtyard', 'terrace or shared rooftop'], range: 2, influenceRadius: 4,
    landmark: { kind: 'seed-house', title: 'Seed House', description: 'A shared greenhouse replaces the courtyard garden where the planted levels meet.', activity: 'swapping cuttings inside the seed house', effect: 'Seed trays and window boxes appear on nearby homes.' },
  },
  {
    id: 'makers-walk', title: 'Makers\' Walk', mark: '⌁',
    description: 'An arcade meets a stepped terrace, giving workshops a covered delivery route between levels.',
    hint: 'Bring an arcade row close to a stepped terrace.',
    mysteryTitle: 'A working passage',
    rumor: 'A covered street might carry the sound of tools farther if it met a route between levels.',
    influence: 'Nearby workshops, weavers, potteries, and bookstores open with fewer residents and produce larger batches.',
    trace: 'Fired address plaques, clay vessels, and tool racks mark the working lane.',
    businesses: ['workshop', 'weaver', 'pottery', 'bookstore'],
    requirements: ['arcade row', 'stepped terrace'], range: 2, influenceRadius: 4,
    landmark: { kind: 'guild-kiln', title: 'Guild Kiln', description: 'A shared kiln and work yard appear only where an arcade and stepped working route overlap.', activity: 'sharing tools beside the guild kiln', effect: 'Fired plaques and clay vessels mark the nearby workshop façades.' },
  },
  {
    id: 'roof-village', title: 'Roof Village', mark: '▤',
    description: 'A roof promenade opens into a shared court where upstairs neighbors can meet.',
    hint: 'Bring a roof promenade close to a rooftop court.',
    mysteryTitle: 'A neighborhood above',
    rumor: 'At dusk, separate rooftops seem only one small common room away from becoming neighbors.',
    influence: 'Nearby cafes, bookstores, tea houses, and inns open with fewer residents and produce larger batches.',
    trace: 'Shared tea tables, cushions, and little laundry lines turn nearby roofs into lived-in rooms.',
    businesses: ['cafe', 'bookstore', 'tea-house', 'inn'],
    requirements: ['roof promenade', 'shared rooftop court'], range: 2, influenceRadius: 4,
    landmark: { kind: 'roof-hall', title: 'Roof Hall', description: 'A common room replaces the roof-court planter beside the promenade.', activity: 'sharing tea in the roof hall', effect: 'Neighbors visit at dusk and make friends around the shared tables.' },
  },
  {
    id: 'high-harbor', title: 'High Harbor', mark: '△',
    description: 'A high crossing reaches an overlook with a clear view of boats beyond the harbor.',
    hint: 'Bring a high bridge close to a lookout tower or elevated shared roof.',
    mysteryTitle: 'A signal above the tide',
    rumor: 'Sailors keep looking for a clear signal above the high crossings.',
    influence: 'Nearby shipyards, workshops, and inns open with fewer residents and produce larger batches.',
    trace: 'Signal pennants and wind vanes appear on the surrounding roofs.',
    businesses: ['shipyard', 'workshop', 'inn'],
    requirements: ['high water crossing', 'lookout or elevated shared roof'], range: 3, influenceRadius: 5,
    landmark: { kind: 'signal-beacon', title: 'Signal Beacon', description: 'A signal lamp rises where the high crossing meets the overlook.', activity: 'reading the harbor signals from the signal beacon', effect: 'A survey boat follows the beacon around the outer water.' },
  },
  {
    id: 'lantern-square', title: 'Lantern Square', mark: '✧',
    description: 'A plaza below a high garden or roof court gives the town a place to meet after dark.',
    hint: 'Bring a harbor plaza close to a tier-two courtyard or rooftop form.',
    mysteryTitle: 'An evening heart',
    rumor: 'People say the right square could keep its lights on after the upper gardens go dark.',
    influence: 'Nearby restaurants, tea houses, cafes, inns, and bookstores open with fewer residents and produce larger batches.',
    trace: 'Paired doorway lanterns and handbills spread outward along the evening approaches.',
    businesses: ['restaurant', 'tea-house', 'cafe', 'inn', 'bookstore'],
    requirements: ['harbor plaza', 'tier-two courtyard or rooftop'], range: 3, influenceRadius: 5,
    landmark: { kind: 'lantern-theatre', title: 'Lantern Theatre', description: 'A public stage replaces the fountain where the plaza meets the routes from above.', activity: 'watching the lantern theatre prepare for evening', effect: 'Its lamps draw an audience to the square each night.' },
  },
  {
    id: 'ferry-quarter', title: 'Ferry Quarter', mark: '⇝',
    description: 'A sheltered crossing beside a plaza gives the passenger ferry a regular stop.',
    hint: 'Bring a water crossing close to a harbor plaza.',
    mysteryTitle: 'A route across the tide',
    rumor: 'Travelers wait beside the square as though the water might one day learn where to stop.',
    influence: 'Nearby inns, cafes, restaurants, bookstores, and fishmongers open with fewer residents and produce larger batches.',
    trace: 'Painted route boards, waiting benches, and numbered mooring posts mark the nearby lanes.',
    businesses: ['inn', 'cafe', 'restaurant', 'bookstore', 'fishmonger'],
    requirements: ['water crossing', 'harbor plaza'], range: 3, influenceRadius: 5,
    landmark: { kind: 'ferry-house', title: 'Ferry House', description: 'A striped shelter and landing stand where the crossing meets the square.', activity: 'waiting beneath the ferry house awning', effect: 'A passenger ferry runs a daily circuit while the quarter remains.' },
  },
  {
    id: 'tidepool-cloister', title: 'Tidepool Cloister', mark: '◉',
    description: 'A sea arch feeds rain and salt water into the garden of a covered cloister.',
    hint: 'Bring a sea arch close to a cloister garden.',
    mysteryTitle: 'A garden of rain and salt',
    rumor: 'After showers, gardeners find small shells in the covered walk and wonder where the water wishes to rest.',
    influence: 'Nearby tea houses, potteries, flower shops, cafes, and restaurants open with fewer residents and produce larger batches.',
    trace: 'Rain chains, shell basins, mossy tiles, and blue-green jars appear on neighboring walls.',
    businesses: ['tea-house', 'pottery', 'flower-shop', 'cafe', 'restaurant'],
    requirements: ['sea arch', 'cloister garden'], range: 2, influenceRadius: 4,
    landmark: { kind: 'tide-cistern', title: 'Tide Cistern', description: 'A shell-lined basin replaces the cloister tree where rain meets sheltered seawater.', activity: 'listening to rain gather in the tide cistern', effect: 'The basins fill during showers and draw crabs into the garden afterward.' },
  },
  {
    id: 'story-court', title: 'Story Court', mark: '§',
    description: 'A shaded arcade opens into a garden used for lessons and neighborhood stories.',
    hint: 'Bring an arcade row close to a courtyard garden.',
    mysteryTitle: 'A courtyard full of voices',
    rumor: 'Children leave chalk marks beneath the arcade, hoping someone will finish the tale in the garden.',
    influence: 'Nearby bookstores, tea houses, cafes, flower shops, and workshops open with fewer residents and produce larger batches.',
    trace: 'Book boxes, chalk drawings, notice boards, and small reading stools spread along the shaded approaches.',
    businesses: ['bookstore', 'tea-house', 'cafe', 'flower-shop', 'workshop'],
    requirements: ['arcade row', 'courtyard garden'], range: 2, influenceRadius: 4,
    landmark: { kind: 'reading-loggia', title: 'Reading Loggia', description: 'A roofed reading room runs along the garden wall beside the arcade.', activity: 'sharing a story beneath the reading loggia', effect: 'Teachers bring children at midday. Elders return to tell stories in the evening.' },
  },
  {
    id: 'windloom-quarter', title: 'Windloom Quarter', mark: '≀',
    description: 'A planted stair reaches a roof pavilion where dyers can dry cloth in the sun and wind.',
    hint: 'Bring a terraced garden close to a rooftop pavilion.',
    mysteryTitle: 'A bright cloth above the roofs',
    rumor: 'Loose threads caught in the high gardens keep arranging themselves into colors when the wind rises.',
    influence: 'Nearby weavers, workshops, flower shops, and bookstores open with fewer residents and produce larger batches.',
    trace: 'Dyed skeins, woven shades, pattern cards, and long strips of bright cloth spread across the upper paths.',
    businesses: ['weaver', 'workshop', 'flower-shop', 'bookstore'],
    requirements: ['terraced garden', 'rooftop pavilion'], range: 2, influenceRadius: 5,
    landmark: { kind: 'wind-loom', title: 'Wind Loom', description: 'A communal loom stands on the pavilion roof beside the garden dyes.', activity: 'weaving colored cloth at the wind loom', effect: 'Dyed cloth hangs above the roofs in dry weather and comes down before rain.' },
  },
  {
    id: 'bell-steps', title: 'Bell Steps', mark: '♢',
    description: 'A lantern stair leads into the plaza and turns the route into a place for town ceremonies.',
    hint: 'Bring a lantern stair close to a harbor plaza.',
    mysteryTitle: 'Steps waiting for a signal',
    rumor: 'At dusk, people pause on the highest lit step as though the square below is waiting to answer.',
    influence: 'Nearby restaurants, cafes, flower shops, inns, and tea houses open with fewer residents and produce larger batches.',
    trace: 'Bronze step plaques, tied ribbons, and small pools of amber light spread toward the square.',
    businesses: ['restaurant', 'cafe', 'flower-shop', 'inn', 'tea-house'],
    requirements: ['lantern stair', 'harbor plaza'], range: 3, influenceRadius: 5,
    landmark: { kind: 'tide-bell', title: 'Tide Bell', description: 'A town bell rises where the lantern stair reaches the plaza.', activity: 'meeting below the tide bell', effect: 'It rings at dawn and dusk, and nearby residents stop to listen.' },
  },
  {
    id: 'messengers-row', title: 'Messenger\'s Row', mark: '✉',
    description: 'A covered street below a lookout gives couriers a route from arriving boats to every door.',
    hint: 'Bring an arcade row close to a lookout tower.',
    mysteryTitle: 'A lane of small messages',
    rumor: 'The lookout can see arrivals long before the arcade hears of them. Someone ought to carry the news between.',
    influence: 'Nearby bookstores, inns, workshops, and cafes open with fewer residents and produce larger batches.',
    trace: 'Painted house numbers, letter boxes, route arrows, and tied message ribbons mark the nearby doors.',
    businesses: ['bookstore', 'inn', 'workshop', 'cafe'],
    requirements: ['arcade row', 'lookout tower'], range: 3, influenceRadius: 4,
    landmark: { kind: 'post-house', title: 'Post House', description: 'A sorting loft sits above the arcade where the lookout passes news down to the street.', activity: 'sorting letters in the post house', effect: 'Visiting couriers leave letters for residents to carry through town.' },
  },
  {
    id: 'star-garden', title: 'Star Garden', mark: '✦',
    description: 'A high roof garden beside a lookout gives stargazers a clear view of the night sky.',
    hint: 'Bring a hanging roof garden close to a lookout tower.',
    mysteryTitle: 'A garden after dark',
    rumor: 'Blue flowers on the highest roofs seem to turn toward points of light that are not the moon.',
    influence: 'Nearby bookstores, tea houses, flower shops, and inns open with fewer residents and produce larger batches.',
    trace: 'Blue lanterns, constellation tiles, brass pointers, and wind chimes appear across neighboring roofs.',
    businesses: ['bookstore', 'tea-house', 'flower-shop', 'inn'],
    requirements: ['hanging roof garden', 'lookout tower'], range: 3, influenceRadius: 5,
    landmark: { kind: 'star-dial', title: 'Star Dial', description: 'A brass sky dial stands above the garden on the lookout roof.', activity: 'reading the night sky at the star dial', effect: 'Cartographers and stargazers use it on clear nights to predict tomorrow\'s weather.' },
  },
  {
    id: 'kite-steps', title: 'Kite Steps', mark: '◁',
    description: 'A stepped terrace gives children an easy route to a broad roof court.',
    hint: 'Bring a stepped terrace close to a rooftop court.',
    mysteryTitle: 'A playground in the wind',
    rumor: 'Children carry paper and string up every stair, searching for one roof broad enough to catch the breeze.',
    influence: 'Nearby cafes, bookstores, weavers, and flower shops open with fewer residents and produce larger batches.',
    trace: 'Windsocks, chalk games, ribbon tails, and bright paper diamonds spread across the nearby roofs.',
    businesses: ['cafe', 'bookstore', 'weaver', 'flower-shop'],
    requirements: ['stepped terrace', 'rooftop court'], range: 2, influenceRadius: 4,
    landmark: { kind: 'kite-loft', title: 'Kite Loft', description: 'An open workshop stands on the shared roof at the top of the stepped route.', activity: 'flying kites from the kite loft', effect: 'Children fly kites from the court on dry afternoons. The kites come down before rain.' },
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
  const hasIds = (left: FormationId, right: FormationId) => (first.id === left && second.id === right) || (first.id === right && second.id === left);
  if (id === 'canal-market') return hasFamilies('water', 'street');
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
  if (id === 'ferry-quarter') return (a === 'water' && second.id === 'harbor-plaza') || (b === 'water' && first.id === 'harbor-plaza');
  if (id === 'tidepool-cloister') return hasIds('sea-arch', 'cloister-garden');
  if (id === 'story-court') return hasIds('arcade-row', 'courtyard-garden');
  if (id === 'windloom-quarter') return hasIds('terraced-garden', 'rooftop-pavilion');
  if (id === 'bell-steps') return hasIds('lantern-stair', 'harbor-plaza');
  if (id === 'messengers-row') return hasIds('arcade-row', 'lookout-tower');
  if (id === 'star-garden') return hasIds('hanging-roof-garden', 'lookout-tower');
  if (id === 'kite-steps') return hasIds('stepped-terrace', 'rooftop-court');
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
  if (id === 'lantern-square') return role === 0
    ? formation.id === 'harbor-plaza'
    : (formationFamily === 'courtyard' || formationFamily === 'rooftop') && tier(formation) >= 2;
  if (id === 'ferry-quarter') return role === 0 ? formationFamily === 'water' : formation.id === 'harbor-plaza';
  const exactRoles: Readonly<Record<Exclude<PlaceIdentityId,
    'canal-market' | 'garden-commons' | 'makers-walk' | 'roof-village' | 'high-harbor' | 'lantern-square' | 'ferry-quarter'>,
    readonly [FormationId, FormationId]>> = {
    'tidepool-cloister': ['sea-arch', 'cloister-garden'],
    'story-court': ['arcade-row', 'courtyard-garden'],
    'windloom-quarter': ['terraced-garden', 'rooftop-pavilion'],
    'bell-steps': ['lantern-stair', 'harbor-plaza'],
    'messengers-row': ['arcade-row', 'lookout-tower'],
    'star-garden': ['hanging-roof-garden', 'lookout-tower'],
    'kite-steps': ['stepped-terrace', 'rooftop-court'],
  };
  return formation.id === exactRoles[id][role];
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
    hint: `${definition.landmark.title} stands here.`,
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
    if (occurrence.id === 'lantern-square') return member.id === 'harbor-plaza';
    if (occurrence.id === 'ferry-quarter') return memberFamily === 'water';
    if (occurrence.id === 'tidepool-cloister' || occurrence.id === 'story-court') return memberFamily === 'courtyard';
    if (occurrence.id === 'windloom-quarter' || occurrence.id === 'star-garden' || occurrence.id === 'kite-steps') return memberFamily === 'rooftop';
    if (occurrence.id === 'bell-steps') return memberFamily === 'terrace';
    if (occurrence.id === 'messengers-row') return memberFamily === 'street';
    return member.id === 'lookout-tower';
  }) ?? occurrence.members[0];
  return Object.freeze({
    identityId: occurrence.id,
    ...definition.landmark,
    x: preferred.x,
    z: preferred.z,
  });
}

export type PlaceAffinity = FormationAffinity & Readonly<{ identity?: PlaceIdentityDefinition }>;

export type PlaceInfluence = Readonly<{
  definition: PlaceIdentityDefinition;
  occurrence: PlaceIdentityOccurrence;
  distance: number;
  strength: number;
}>;

/**
 * Returns the strongest living-place influence at a location. The nearest
 * landmark wins, so overlapping places form legible neighborhood edges rather
 * than stacking every decorative and economic effect on the same building.
 */
export function placeInfluenceAt(
  location: Readonly<{ x: number; z: number }>,
  formations: readonly FormationOccurrence[],
): PlaceInfluence | undefined {
  return detectPlaceIdentities(formations)
    .map((occurrence) => {
      const definition = PLACE_IDENTITY_BY_ID.get(occurrence.id)!;
      const socket = placeLandmarkSocket(occurrence);
      const distance = Math.abs(location.x - socket.x) + Math.abs(location.z - socket.z);
      return { definition, occurrence, distance, strength: Math.max(0, 1 - distance / (definition.influenceRadius + 1)) };
    })
    .filter((influence) => influence.distance <= influence.definition.influenceRadius)
    .sort((a, b) => b.strength - a.strength || a.definition.id.localeCompare(b.definition.id))[0];
}

export function placeBusinessAffinity(
  type: BusinessType,
  location: Pick<Cell, 'x' | 'z'>,
  formations: readonly FormationOccurrence[],
): PlaceAffinity {
  const base = formationBusinessAffinity(type, location, formations);
  const influence = placeInfluenceAt(location, formations);
  if (!influence?.definition.businesses.includes(type)) return base;
  const score = Math.max(0, 10 - influence.distance * 1.5);
  return score > base.score ? { score, identity: influence.definition } : base;
}

export function placeOpeningPopulation(type: BusinessType, basePopulation: number, formations: readonly FormationOccurrence[]) {
  const identitySupports = detectPlaceIdentities(formations)
    .some((occurrence) => PLACE_IDENTITY_BY_ID.get(occurrence.id)?.businesses.includes(type));
  return identitySupports ? Math.max(2, basePopulation - 3) : formationOpeningPopulation(type, basePopulation, formations);
}

export function placeIdentityActivity(id: PlaceIdentityId, ageGroup?: string, occupation?: string) {
  if (id === 'canal-market') return occupation === 'Fisher' ? 'bringing news from the boats to the canal market' : 'browsing baskets along the canal market';
  if (id === 'garden-commons') return occupation === 'Gardener' ? 'tending the layered garden commons' : 'sharing a quiet bench in the garden commons';
  if (id === 'makers-walk') return ageGroup === 'child' ? 'watching the makers at work along the makers\' walk' : 'carrying small errands along the makers\' walk';
  if (id === 'roof-village') return 'visiting neighbors across the roof village';
  if (id === 'high-harbor') return 'watching sails cross beneath the high harbor';
  if (id === 'lantern-square') return 'meeting neighbors as the lanterns light the square';
  if (id === 'ferry-quarter') return occupation === 'Caretaker' ? 'helping travelers at the ferry quarter' : 'waiting for the next ferry in the square';
  if (id === 'tidepool-cloister') return occupation === 'Gardener' ? 'tending moss beside the tide cistern' : 'looking for shells in the tidepool cloister';
  if (id === 'story-court') return ageGroup === 'child' ? 'listening to a story in the story court' : occupation === 'Teacher' ? 'sharing a lesson in the story court' : 'reading beneath the story court arcade';
  if (id === 'windloom-quarter') return occupation === 'Artisan' || occupation === 'Weaver' ? 'working bright cloth in the windloom quarter' : 'watching dyed cloth move above the roofs';
  if (id === 'bell-steps') return 'climbing the bell steps as the square gathers';
  if (id === 'messengers-row') return occupation === 'Cartographer' ? 'sorting harbor routes along messenger\'s row' : 'carrying a letter along messenger\'s row';
  if (id === 'star-garden') return occupation === 'Cartographer' ? 'charting the sky from the star garden' : 'watching the stars above the high garden';
  return ageGroup === 'child' ? 'flying a kite from the kite steps' : 'watching kites wheel above the roof court';
}
