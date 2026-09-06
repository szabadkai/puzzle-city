import { FORMATION_BY_ID, type FormationOccurrence } from './formations.ts';
import type { ConfluenceId, FormationId, PlaceIdentityId } from './types.ts';
import type { PlaceIdentityOccurrence } from './place-identities.ts';

export type ConfluenceLandmarkKind =
  | 'exchange-pier'
  | 'rain-temple'
  | 'commons-hall'
  | 'festival-pavilion'
  | 'observatory-beacon'
  | 'banner-house'
  | 'harbor-archive';

export type ConfluenceDefinition = Readonly<{
  id: ConfluenceId;
  title: string;
  mark: string;
  description: string;
  hint: string;
  mysteryTitle: string;
  rumor: string;
  requirements: readonly [string, string, string];
  range: number;
  places: readonly PlaceIdentityId[];
  landmark: Readonly<{
    kind: ConfluenceLandmarkKind;
    title: string;
    description: string;
    activity: string;
    effect: string;
  }>;
}>;

export type ConfluenceOccurrence = Readonly<{
  id: ConfluenceId;
  x: number;
  z: number;
  formations: readonly [FormationId, FormationId, FormationId];
  members: readonly [FormationOccurrence, FormationOccurrence, FormationOccurrence];
}>;

export type ConfluenceProgress = Readonly<{
  value: number;
  state: 'missing' | 'partial' | 'distant' | 'active';
  requirements: readonly [string, string, string];
  found: readonly [boolean, boolean, boolean];
  hint: string;
  focus: Readonly<{ x: number; z: number }> | null;
}>;

export type ConfluenceLandmarkSocket = Readonly<{
  confluenceId: ConfluenceId;
  kind: ConfluenceLandmarkKind;
  title: string;
  description: string;
  activity: string;
  effect: string;
  x: number;
  z: number;
}>;

export const CONFLUENCE_CATALOG: readonly ConfluenceDefinition[] = [
  {
    id: 'grand-exchange', title: 'Grand Exchange', mark: '◈',
    description: 'A ferry stop, market street, and plaza meet at one pier for passengers and cargo.',
    hint: 'Bring a water crossing, arcade row, and harbor plaza into one close cluster.',
    mysteryTitle: 'Three routes, one arrival',
    rumor: 'Boat crews, shopkeepers, and people waiting in the square all seem to be describing the same missing place.',
    requirements: ['water crossing', 'arcade row', 'harbor plaza'], range: 3,
    places: ['canal-market', 'ferry-quarter'],
    landmark: { kind: 'exchange-pier', title: 'Exchange Pier', description: 'A broad roof covers the passenger steps and cargo tables beside the square.', activity: 'meeting boats beneath the exchange pier', effect: 'Merchant and passenger boats use the same timetable and sometimes bring goods that the regular route does not carry.' },
  },
  {
    id: 'tide-sanctuary', title: 'Tide Sanctuary', mark: '❈',
    description: 'Rain from a terraced garden drains through a cloister and meets salt water below the sea arch.',
    hint: 'Bring a sea arch, cloister garden, and terraced garden close together.',
    mysteryTitle: 'A garden held by three waters',
    rumor: 'The cloister keeps finding shells below and petals above, as though two gardens are trying to meet there.',
    requirements: ['sea arch', 'cloister garden', 'terraced garden'], range: 3,
    places: ['tidepool-cloister', 'garden-commons'],
    landmark: { kind: 'rain-temple', title: 'Rain Temple', description: 'A tiered shrine channels rain into planted shell basins in the cloister.', activity: 'tending the rain temple basins', effect: 'A rare tide flower opens after rain, drawing gardeners, butterflies, and crabs.' },
  },
  {
    id: 'house-of-hands', title: 'House of Hands', mark: '✥',
    description: 'The workshops in an arcade share lessons and tools with a courtyard and stepped garden.',
    hint: 'Bring an arcade row, courtyard garden, and stepped terrace close together.',
    mysteryTitle: 'A house the whole town builds',
    rumor: 'Lessons leave the garden as sketches, then return from the workshops as useful things.',
    requirements: ['arcade row', 'courtyard garden', 'stepped terrace'], range: 3,
    places: ['story-court', 'garden-commons', 'makers-walk'],
    landmark: { kind: 'commons-hall', title: 'Commons Hall', description: 'An open hall puts worktables beside the shelves and planters used by the three neighborhoods.', activity: 'learning and making in the commons hall', effect: 'Teachers, children, gardeners, and artisans use the hall for lessons and shared projects.' },
  },
  {
    id: 'festival-crown', title: 'Festival Crown', mark: '✺',
    description: 'A lantern stair links the plaza stage to a rooftop pavilion, giving processions a route through town.',
    hint: 'Bring a lantern stair, harbor plaza, and rooftop pavilion close together.',
    mysteryTitle: 'An evening waiting to begin',
    rumor: 'The square has a stage and the stair has lights, but the rooftops still seem to be waiting for a signal.',
    requirements: ['lantern stair', 'harbor plaza', 'rooftop pavilion'], range: 3,
    places: ['bell-steps', 'lantern-square'],
    landmark: { kind: 'festival-pavilion', title: 'Festival Pavilion', description: 'A tall canopy joins the stage and town bell below a rooftop viewing gallery.', activity: 'preparing the festival pavilion', effect: 'On festival evenings, residents carry ribbons down the stair to a performance in the square.' },
  },
  {
    id: 'celestial-beacon', title: 'Celestial Beacon', mark: '✹',
    description: 'A lookout above a high crossing tracks boats by day and weather above the hanging garden at night.',
    hint: 'Bring a high water crossing, lookout tower, and hanging roof garden close together.',
    mysteryTitle: 'A signal beyond the horizon',
    rumor: 'The beacon watches ships by day, while the highest flowers appear to watch something else after dark.',
    requirements: ['high water crossing', 'lookout tower', 'hanging roof garden'], range: 3,
    places: ['high-harbor', 'star-garden'],
    landmark: { kind: 'observatory-beacon', title: 'Observatory Beacon', description: 'Brass sky rings surround a harbor lamp on the lookout above the garden.', activity: 'reading sea and sky from the observatory beacon', effect: 'The lamp guides the survey boat after dark. The rings give the town an early forecast for tomorrow.' },
  },
  {
    id: 'banner-guild', title: 'Banner Guild', mark: '≋',
    description: 'An arcade connects its workshops to garden dyes and a roof pavilion where cloth can dry.',
    hint: 'Bring an arcade row, terraced garden, and rooftop pavilion close together.',
    mysteryTitle: 'A pattern climbing the roofs',
    rumor: 'Workshop sketches keep reappearing as colored threads in the upper garden, each time a little larger.',
    requirements: ['arcade row', 'terraced garden', 'rooftop pavilion'], range: 3,
    places: ['makers-walk', 'windloom-quarter'],
    landmark: { kind: 'banner-house', title: 'Banner House', description: 'A dye loft and roof loom hang ceremonial cloth above the working lane.', activity: 'raising new cloth at the banner house', effect: 'Finished banners appear along the busiest routes before festivals.' },
  },
  {
    id: 'archive-tower', title: 'Archive Tower', mark: '⌘',
    description: 'A lookout sends letters and weather notes down to an arcade and the storytellers in its garden court.',
    hint: 'Bring an arcade row, courtyard garden, and lookout tower close together.',
    mysteryTitle: 'A tower full of remembered roads',
    rumor: 'Letters pass through the arcade and stories gather in the court, but neither yet has a place to stay.',
    requirements: ['arcade row', 'courtyard garden', 'lookout tower'], range: 3,
    places: ['story-court', 'messengers-row'],
    landmark: { kind: 'harbor-archive', title: 'Harbor Archive', description: 'A record room above the lookout stores letters, maps, and town stories.', activity: 'reading the harbor archive', effect: 'Couriers and teachers add new records to the town journal.' },
  },
] as const;

export const CONFLUENCE_BY_ID = new Map(CONFLUENCE_CATALOG.map((definition) => [definition.id, definition]));

function family(formation: FormationOccurrence) {
  return FORMATION_BY_ID.get(formation.id)?.family;
}

function tier(formation: FormationOccurrence) {
  return FORMATION_BY_ID.get(formation.id)?.tier ?? 0;
}

function roleMatches(id: ConfluenceId, role: 0 | 1 | 2, formation: FormationOccurrence) {
  if (id === 'grand-exchange') return role === 0 ? family(formation) === 'water' : formation.id === (role === 1 ? 'arcade-row' : 'harbor-plaza');
  if (id === 'celestial-beacon') return role === 0
    ? family(formation) === 'water' && tier(formation) >= 3
    : formation.id === (role === 1 ? 'lookout-tower' : 'hanging-roof-garden');
  const roles: Readonly<Record<Exclude<ConfluenceId, 'grand-exchange' | 'celestial-beacon'>, readonly [FormationId, FormationId, FormationId]>> = {
    'tide-sanctuary': ['sea-arch', 'cloister-garden', 'terraced-garden'],
    'house-of-hands': ['arcade-row', 'courtyard-garden', 'stepped-terrace'],
    'festival-crown': ['lantern-stair', 'harbor-plaza', 'rooftop-pavilion'],
    'banner-guild': ['arcade-row', 'terraced-garden', 'rooftop-pavilion'],
    'archive-tower': ['arcade-row', 'courtyard-garden', 'lookout-tower'],
  };
  return formation.id === roles[id][role];
}

function distance(a: FormationOccurrence, b: FormationOccurrence) {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

export function detectConfluences(formations: readonly FormationOccurrence[]): readonly ConfluenceOccurrence[] {
  const found: ConfluenceOccurrence[] = [];
  for (const definition of CONFLUENCE_CATALOG) {
    const candidates = ([0, 1, 2] as const).map((role) => formations.filter((formation) => roleMatches(definition.id, role, formation)));
    for (const first of candidates[0]) for (const second of candidates[1]) for (const third of candidates[2]) {
      if (new Set([first, second, third]).size < 3) continue;
      const members = [first, second, third] as const;
      if (distance(first, second) > definition.range || distance(first, third) > definition.range || distance(second, third) > definition.range) continue;
      const x = Math.round((first.x + second.x + third.x) / 3);
      const z = Math.round((first.z + second.z + third.z) / 3);
      if (found.some((occurrence) => occurrence.id === definition.id && Math.abs(occurrence.x - x) + Math.abs(occurrence.z - z) <= 2)) continue;
      found.push(Object.freeze({ id: definition.id, x, z, formations: members.map((member) => member.id) as [FormationId, FormationId, FormationId], members }));
    }
  }
  return Object.freeze(found);
}

export function confluenceProgress(id: ConfluenceId, formations: readonly FormationOccurrence[]): ConfluenceProgress {
  const definition = CONFLUENCE_BY_ID.get(id)!;
  const active = detectConfluences(formations).find((occurrence) => occurrence.id === id);
  if (active) return Object.freeze({ value: 1, state: 'active', requirements: definition.requirements, found: [true, true, true] as const, hint: `${definition.landmark.title} stands here.`, focus: { x: active.x, z: active.z } });
  const roles = ([0, 1, 2] as const).map((role) => formations.filter((formation) => roleMatches(id, role, formation)));
  const found = roles.map((matches) => matches.length > 0) as [boolean, boolean, boolean];
  const foundCount = found.filter(Boolean).length;
  if (foundCount === 3) {
    const closest = roles[0].flatMap((first) => roles[1].flatMap((second) => roles[2].map((third) => ({
      members: [first, second, third] as const,
      span: Math.max(distance(first, second), distance(first, third), distance(second, third)),
    })))).sort((a, b) => a.span - b.span)[0];
    return Object.freeze({ value: .82, state: 'distant', requirements: definition.requirements, found, hint: `All three forms exist. Bring every pair within ${definition.range} tiles.`, focus: closest ? { x: closest.members[0].x, z: closest.members[0].z } : null });
  }
  const firstMissing = found.findIndex((value) => !value);
  const focusFormation = roles.flat()[0];
  return Object.freeze({
    value: foundCount * .24,
    state: foundCount ? 'partial' : 'missing',
    requirements: definition.requirements,
    found,
    hint: foundCount ? `Shape ${definition.requirements[firstMissing]} near the forms already here.` : definition.hint,
    focus: focusFormation ? { x: focusFormation.x, z: focusFormation.z } : null,
  });
}

export function confluenceLandmarkSocket(occurrence: ConfluenceOccurrence): ConfluenceLandmarkSocket {
  const definition = CONFLUENCE_BY_ID.get(occurrence.id)!;
  const preferred = occurrence.members.find((member) => {
    if (occurrence.id === 'grand-exchange') return family(member) === 'water';
    if (occurrence.id === 'tide-sanctuary' || occurrence.id === 'house-of-hands') return family(member) === 'courtyard';
    if (occurrence.id === 'festival-crown') return member.id === 'harbor-plaza';
    if (occurrence.id === 'banner-guild') return member.id === 'rooftop-pavilion';
    return member.id === 'lookout-tower';
  }) ?? occurrence.members[0];
  return Object.freeze({ confluenceId: occurrence.id, ...definition.landmark, x: preferred.x, z: preferred.z });
}

export function confluenceSupersedesPlace(confluence: ConfluenceOccurrence, place: PlaceIdentityOccurrence) {
  const definition = CONFLUENCE_BY_ID.get(confluence.id);
  return Boolean(definition?.places.includes(place.id) && place.members.every((member) =>
    confluence.members.some((source) => source.id === member.id && source.x === member.x && source.z === member.z)));
}

export function confluenceActivity(id: ConfluenceId, ageGroup?: string, occupation?: string) {
  if (id === 'grand-exchange') return 'watching passengers and cargo meet at the grand exchange';
  if (id === 'tide-sanctuary') return occupation === 'Gardener' ? 'tending the tide sanctuary after rain' : 'visiting the rain temple basins';
  if (id === 'house-of-hands') return ageGroup === 'child' ? 'learning a small craft in the house of hands' : 'helping with a commons hall project';
  if (id === 'festival-crown') return 'preparing the evening procession at the festival crown';
  if (id === 'celestial-beacon') return occupation === 'Cartographer' ? 'charting sea and sky at the celestial beacon' : 'watching the observatory signals';
  if (id === 'banner-guild') return 'raising ceremonial cloth at the banner guild';
  return occupation === 'Teacher' || occupation === 'Cartographer' ? 'adding a record to the archive tower' : 'reading a remembered harbor story';
}
