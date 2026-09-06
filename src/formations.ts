import {
  arcadeFeature,
  courtyardFeature,
  emptyCrossingFeature,
  roofCourtFeature,
  walkableSteppedTerrace,
} from './architecture.ts';
import { findPlazaAnchors } from './topology.ts';
import { CARDINALS, type BusinessType, type Cell, type FormationId, keyOf } from './types.ts';

export type FormationFamily = 'water' | 'street' | 'terrace' | 'rooftop' | 'courtyard' | 'landmark';

export type FormationDefinition = Readonly<{
  id: FormationId;
  title: string;
  family: FormationFamily;
  tier: number;
  mark: string;
  description: string;
  socialEffect: string;
  hint: string;
}>;

export type FormationOccurrence = Readonly<{
  id: FormationId;
  x: number;
  z: number;
}>;

export const FORMATION_CATALOG: readonly FormationDefinition[] = [
  { id: 'narrow-canal', title: 'Narrow Canal', family: 'water', tier: 1, mark: '≈', description: 'Two homes face each other across a one-tile water lane.', socialEffect: 'Neighbors stop at the walls to watch boats squeeze through.', hint: 'Leave one water tile between two opposing homes.' },
  { id: 'sea-arch', title: 'Sea Arch', family: 'water', tier: 2, mark: '∩', description: 'The two banks join above the water, leaving room for boats below.', socialEffect: 'Fishers check the current while neighbors wait under the arch.', hint: 'Raise both banks of a narrow canal to two storeys.' },
  { id: 'high-bridge', title: 'High Bridge', family: 'water', tier: 3, mark: '⌒', description: 'A walkable bridge crosses above the canal.', socialEffect: 'Walkers stop halfway across to wave at the boats below.', hint: 'Raise both sides of a sea arch to three storeys.' },
  { id: 'covered-skybridge', title: 'Covered Skybridge', family: 'water', tier: 4, mark: '▱', description: 'A roof covers the high bridge and keeps out the rain.', socialEffect: 'Neighbors use the covered bridge as a meeting spot in any weather.', hint: 'Raise both sides of a high bridge to four storeys.' },
  { id: 'lantern-gate', title: 'Lantern Gate', family: 'water', tier: 5, mark: '◇', description: 'Lanterns turn the tallest crossing into a gate over the canal.', socialEffect: 'Residents wait beneath the lights when boats arrive after dusk.', hint: 'Raise both sides of a covered skybridge to five storeys.' },
  { id: 'arcade-row', title: 'Arcade Row', family: 'street', tier: 1, mark: '⋂', description: 'Three buildings share a covered ground-floor walkway.', socialEffect: 'Shopgoers stop to talk in the shade between doorways.', hint: 'Make a straight run of three two-storey buildings.' },
  { id: 'roof-promenade', title: 'Roof Promenade', family: 'street', tier: 2, mark: '═', description: 'A lantern-lined path runs across the roofs of an arcade.', socialEffect: 'Neighbors walk the rooftop route after sunset.', hint: 'Raise all three buildings of an arcade row to three storeys.' },
  { id: 'stepped-terrace', title: 'Stepped Terrace', family: 'terrace', tier: 1, mark: '⌁', description: 'Three roofs at different heights make an outdoor stair.', socialEffect: 'Residents use the roofs as a shortcut between levels.', hint: 'Arrange three connected roofs in a 1, 2, 3 height progression beside a usable lower roof.' },
  { id: 'terraced-garden', title: 'Terraced Garden', family: 'terrace', tier: 2, mark: '⌁', description: 'Planters line the landings of a higher stepped route.', socialEffect: 'Gardeners tend the planters while neighbors climb past.', hint: 'Lift a stepped terrace into a 2, 3, 4 progression.' },
  { id: 'lantern-stair', title: 'Lantern Stair', family: 'terrace', tier: 3, mark: '⌁', description: 'Lanterns light the highest run of roof gardens.', socialEffect: 'Residents climb the lit stair for the view after sunset.', hint: 'Lift a terraced garden into a 3, 4, 5 progression.' },
  { id: 'rooftop-court', title: 'Rooftop Court', family: 'rooftop', tier: 1, mark: '□', description: 'Four equal roofs connect around an open court.', socialEffect: 'Neighbors bring chairs upstairs and share the open air.', hint: 'Make a two-by-two block of equal two-storey buildings.' },
  { id: 'rooftop-pavilion', title: 'Rooftop Pavilion', family: 'rooftop', tier: 2, mark: '▣', description: 'A pavilion covers part of the shared roof court.', socialEffect: 'Small groups meet in the pavilion\'s shade.', hint: 'Raise all four buildings of a rooftop court to three storeys.' },
  { id: 'hanging-roof-garden', title: 'Hanging Roof Garden', family: 'rooftop', tier: 3, mark: '❖', description: 'Planters and vines fill the highest shared court.', socialEffect: 'Gardeners work among the vines while visitors take in the view.', hint: 'Raise all four sides of a rooftop pavilion to four storeys.' },
  { id: 'courtyard-garden', title: 'Courtyard Garden', family: 'courtyard', tier: 1, mark: '✣', description: 'Three homes shelter a garden on the empty tile between them.', socialEffect: 'Neighbors sit around the tree at the center.', hint: 'Shelter one empty tile with homes on three sides.' },
  { id: 'cloister-garden', title: 'Cloister Garden', family: 'courtyard', tier: 2, mark: '✤', description: 'A covered walk runs around the sheltered garden.', socialEffect: 'Residents circle the garden or stop under the roof.', hint: 'Raise the surrounding walls of a courtyard garden to two storeys.' },
  { id: 'courtyard-pavilion', title: 'Courtyard Pavilion', family: 'courtyard', tier: 3, mark: '✥', description: 'A pavilion rises over the enclosed garden.', socialEffect: 'Neighbors meet below the pavilion at the center of the block.', hint: 'Raise the surrounding walls of a cloister garden to three storeys.' },
  { id: 'harbor-plaza', title: 'Harbor Plaza', family: 'landmark', tier: 1, mark: '⊞', description: 'Six or more homes enclose a square with a fountain and shade trees.', socialEffect: 'Residents cross paths by the fountain and sit under the trees.', hint: 'Leave a two-by-two opening inside a ring of at least six homes.' },
  { id: 'lookout-tower', title: 'Lookout Tower', family: 'landmark', tier: 1, mark: '△', description: 'A tall home with few neighbors has a clear view of the horizon.', socialEffect: 'Residents climb the tower to watch boats arrive.', hint: 'Raise an isolated or lightly connected home to three storeys.' },
] as const;

export const FORMATION_BY_ID = new Map(FORMATION_CATALOG.map((formation) => [formation.id, formation]));

const BUSINESS_FAMILIES: Record<FormationFamily, readonly BusinessType[]> = {
  water: ['fishmonger', 'mill', 'smokehouse', 'shipyard', 'inn'],
  street: ['cafe', 'workshop', 'bookstore', 'weaver'],
  terrace: ['flower-shop', 'cafe', 'tea-house', 'bookstore'],
  rooftop: ['flower-shop', 'tea-house', 'bookstore', 'cafe'],
  courtyard: ['flower-shop', 'tea-house', 'cafe', 'restaurant'],
  landmark: ['inn', 'restaurant', 'bookstore', 'cafe'],
};

export const FORMATION_OPENING_ADVANCE = 2;
export const FORMATION_BATCH_BONUS = 1;

export type FormationAffinity = Readonly<{
  score: number;
  formation?: FormationDefinition;
}>;

export function formationBusinessAffinity(
  type: BusinessType,
  location: Pick<Cell, 'x' | 'z'>,
  occurrences: readonly FormationOccurrence[],
): FormationAffinity {
  let best: FormationAffinity = { score: 0 };
  for (const occurrence of occurrences) {
    const formation = FORMATION_BY_ID.get(occurrence.id);
    if (!formation || !BUSINESS_FAMILIES[formation.family].includes(type)) continue;
    const distance = Math.abs(location.x - occurrence.x) + Math.abs(location.z - occurrence.z);
    if (distance > 3) continue;
    const score = Math.max(0, 6 - distance * 1.5 + (formation.tier - 1) * .6);
    if (score > best.score) best = { score, formation };
  }
  return best;
}

export function formationSupportsBusiness(type: BusinessType, occurrences: readonly FormationOccurrence[]) {
  return occurrences.some((occurrence) => {
    const formation = FORMATION_BY_ID.get(occurrence.id);
    return formation ? BUSINESS_FAMILIES[formation.family].includes(type) : false;
  });
}

export function formationOpeningPopulation(type: BusinessType, basePopulation: number, occurrences: readonly FormationOccurrence[]) {
  return Math.max(2, basePopulation - (formationSupportsBusiness(type, occurrences) ? FORMATION_OPENING_ADVANCE : 0));
}

function joinWithAnd(items: readonly string[]) {
  if (items.length < 2) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items.at(-1)}`;
}

function businessPlural(type: BusinessType) {
  return type === 'cafe' ? 'cafés' : `${type.replace('-', ' ')}s`;
}

export function formationInfluenceDetails(formation: FormationDefinition) {
  const businesses = BUSINESS_FAMILIES[formation.family]
    .map(businessPlural);
  return Object.freeze({
    socialEffect: formation.socialEffect,
    businesses: joinWithAnd(businesses),
  });
}

export function formationInfluenceSummary(formation: FormationDefinition) {
  const effect = formationInfluenceDetails(formation);
  return `${effect.socialEffect} Nearby ${effect.businesses} can open ${FORMATION_OPENING_ADVANCE} residents earlier and produce +${FORMATION_BATCH_BONUS} item per batch.`;
}

export function formationGatheringActivity(id: FormationId, ageGroup?: string, occupation?: string) {
  const formation = FORMATION_BY_ID.get(id);
  if (!formation) return 'spending time in a familiar place';
  if (id === 'narrow-canal') return occupation === 'Fisher' ? 'checking the current in the narrow canal' : 'watching boats thread the narrow canal';
  if (id === 'sea-arch') return occupation === 'Fisher' ? 'reading the tide beneath the sea arch' : 'lingering beneath the sea arch';
  if (id === 'high-bridge') return ageGroup === 'child' ? 'waving to boats from the high bridge' : 'crossing the high bridge for the open view';
  if (id === 'covered-skybridge') return 'meeting neighbors beneath the covered skybridge';
  if (id === 'lantern-gate') return 'watching arrivals beneath the lantern gate';
  if (id === 'arcade-row') return ageGroup === 'child' ? 'playing beneath the arcade row' : 'strolling through the shaded arcade row';
  if (id === 'roof-promenade') return 'following the lanterns along the roof promenade';
  if (id === 'stepped-terrace') return 'taking the stepped terrace shortcut';
  if (id === 'terraced-garden') return occupation === 'Gardener' ? 'tending the terraced garden landings' : 'climbing past the terraced garden planters';
  if (id === 'lantern-stair') return 'climbing the lantern stair for the harbor view';
  if (id === 'rooftop-court') return ageGroup === 'child' ? 'playing in the rooftop court' : 'sharing the open air in the rooftop court';
  if (id === 'rooftop-pavilion') return 'meeting beneath the rooftop pavilion';
  if (id === 'hanging-roof-garden') return occupation === 'Gardener' ? 'tending the hanging roof garden' : 'resting among the high greenery';
  if (id === 'courtyard-garden') return occupation === 'Gardener' ? 'tending the courtyard garden' : 'resting in the sheltered courtyard green';
  if (id === 'cloister-garden') return 'taking a quiet turn around the cloister garden';
  if (id === 'courtyard-pavilion') return 'meeting beneath the courtyard pavilion';
  if (id === 'lookout-tower') return 'scanning the horizon below the lookout tower';
  return 'crossing paths with neighbors in the harbor plaza';
}

const CROSSING_IDS: Record<NonNullable<ReturnType<typeof emptyCrossingFeature>>, FormationId> = {
  'narrow canal': 'narrow-canal',
  'sea arch': 'sea-arch',
  'high bridge': 'high-bridge',
  'covered skybridge': 'covered-skybridge',
  'lantern gate': 'lantern-gate',
};

const ARCADE_IDS: Record<NonNullable<ReturnType<typeof arcadeFeature>>, FormationId> = {
  'arcade row': 'arcade-row',
  'roof promenade': 'roof-promenade',
};

const TERRACE_IDS: Record<NonNullable<ReturnType<typeof walkableSteppedTerrace>>['feature'], FormationId> = {
  'stepped terrace': 'stepped-terrace',
  'terraced garden': 'terraced-garden',
  'lantern stair': 'lantern-stair',
};

const ROOF_COURT_IDS: Record<NonNullable<ReturnType<typeof roofCourtFeature>>, FormationId> = {
  'rooftop court': 'rooftop-court',
  'rooftop pavilion': 'rooftop-pavilion',
  'hanging roof garden': 'hanging-roof-garden',
};

const COURTYARD_IDS: Record<NonNullable<ReturnType<typeof courtyardFeature>>, FormationId> = {
  'courtyard garden': 'courtyard-garden',
  'cloister garden': 'cloister-garden',
  'courtyard pavilion': 'courtyard-pavilion',
};

const LINEAGE: Partial<Record<FormationId, readonly FormationId[]>> = {
  'sea-arch': ['narrow-canal'],
  'high-bridge': ['narrow-canal', 'sea-arch'],
  'covered-skybridge': ['narrow-canal', 'sea-arch', 'high-bridge'],
  'lantern-gate': ['narrow-canal', 'sea-arch', 'high-bridge', 'covered-skybridge'],
  'roof-promenade': ['arcade-row'],
  'terraced-garden': ['stepped-terrace'],
  'lantern-stair': ['stepped-terrace', 'terraced-garden'],
  'rooftop-pavilion': ['rooftop-court'],
  'hanging-roof-garden': ['rooftop-court', 'rooftop-pavilion'],
  'cloister-garden': ['courtyard-garden'],
  'courtyard-pavilion': ['courtyard-garden', 'cloister-garden'],
};

export function formationLineage(ids: Iterable<FormationId>) {
  const expanded = new Set<FormationId>();
  for (const id of ids) {
    expanded.add(id);
    for (const earlier of LINEAGE[id] ?? []) expanded.add(earlier);
  }
  return expanded;
}

export function hasAdjacentHomes(cells: ReadonlyMap<string, Cell>) {
  for (const cell of cells.values()) {
    if (CARDINALS.some(([dx, dz]) => cells.has(keyOf(cell.x + dx, cell.z + dz)))) return true;
  }
  return false;
}

export function detectFormations(cells: ReadonlyMap<string, Cell>): readonly FormationOccurrence[] {
  if (!cells.size) return [];
  const occurrences = new Map<string, FormationOccurrence>();
  const emptyCandidates = new Set<string>();
  const plazaInterior = new Set<string>();
  const add = (id: FormationId, x: number, z: number) => {
    occurrences.set(`${id}:${x},${z}`, Object.freeze({ id, x, z }));
  };

  for (const anchor of findPlazaAnchors(cells)) {
    add('harbor-plaza', anchor.x, anchor.z);
    plazaInterior.add(keyOf(anchor.x, anchor.z));
    plazaInterior.add(keyOf(anchor.x + 1, anchor.z));
    plazaInterior.add(keyOf(anchor.x, anchor.z + 1));
    plazaInterior.add(keyOf(anchor.x + 1, anchor.z + 1));
  }

  for (const cell of cells.values()) {
    for (const [dx, dz] of CARDINALS) {
      const neighbor = keyOf(cell.x + dx, cell.z + dz);
      if (!cells.has(neighbor)) emptyCandidates.add(neighbor);
    }

    const arcade = arcadeFeature(cell, cells);
    if (arcade) add(ARCADE_IDS[arcade], cell.x, cell.z);

    const terrace = walkableSteppedTerrace(cell, cells);
    if (terrace) add(TERRACE_IDS[terrace.feature], cell.x, cell.z);

    const roofCourt = roofCourtFeature(cell, cells);
    if (roofCourt) {
      // roofCourtFeature is true for each member. The north-west anchor keeps
      // one atlas occurrence for the shared four-cell place.
      const matchingAnchors = [
        [cell.x - 1, cell.z - 1], [cell.x, cell.z - 1],
        [cell.x - 1, cell.z], [cell.x, cell.z],
      ].filter(([x, z]) => [keyOf(x, z), keyOf(x + 1, z), keyOf(x, z + 1), keyOf(x + 1, z + 1)]
        .every((key) => cells.get(key)?.height === cell.height));
      matchingAnchors.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
      const anchor = matchingAnchors[0] ?? [cell.x, cell.z];
      add(ROOF_COURT_IDS[roofCourt], anchor[0], anchor[1]);
    }

    const neighborCount = CARDINALS.filter(([dx, dz]) => cells.has(keyOf(cell.x + dx, cell.z + dz))).length;
    if (cell.height >= 3 && neighborCount <= 1) add('lookout-tower', cell.x, cell.z);
  }

  for (const key of emptyCandidates) {
    if (plazaInterior.has(key)) continue;
    const [x, z] = key.split(',').map(Number);
    const crossing = emptyCrossingFeature(x, z, cells);
    if (crossing) add(CROSSING_IDS[crossing], x, z);
    const courtyard = courtyardFeature(x, z, cells);
    if (courtyard) add(COURTYARD_IDS[courtyard], x, z);
  }

  return Object.freeze([...occurrences.values()].sort((a, b) => a.id.localeCompare(b.id) || a.z - b.z || a.x - b.x));
}
