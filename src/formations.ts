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
  hint: string;
}>;

export type FormationOccurrence = Readonly<{
  id: FormationId;
  x: number;
  z: number;
}>;

export const FORMATION_CATALOG: readonly FormationDefinition[] = [
  { id: 'narrow-canal', title: 'Narrow Canal', family: 'water', tier: 1, mark: '≈', description: 'Two homes turn a strip of open water into a sheltered street for boats.', hint: 'Leave one water tile between two opposing homes.' },
  { id: 'sea-arch', title: 'Sea Arch', family: 'water', tier: 2, mark: '∩', description: 'Two-storey banks meet above the tide while keeping the passage open.', hint: 'Raise both banks of a narrow canal to two storeys.' },
  { id: 'high-bridge', title: 'High Bridge', family: 'water', tier: 3, mark: '⌒', description: 'The crossing rises into a walkable bridge above the blue lane.', hint: 'Raise both sides of a sea arch to three storeys.' },
  { id: 'covered-skybridge', title: 'Covered Skybridge', family: 'water', tier: 4, mark: '▱', description: 'A roof gathers over the elevated crossing and shelters its footsteps.', hint: 'Let both sides of a high bridge reach four storeys.' },
  { id: 'lantern-gate', title: 'Lantern Gate', family: 'water', tier: 5, mark: '◇', description: 'The tallest crossing becomes a lantern-lit threshold over the canal.', hint: 'Let both sides of a covered skybridge reach five storeys.' },
  { id: 'arcade-row', title: 'Arcade Row', family: 'street', tier: 1, mark: '⋂', description: 'Three aligned buildings shelter a continuous ground-floor walk.', hint: 'Make a straight run of three two-storey buildings.' },
  { id: 'roof-promenade', title: 'Roof Promenade', family: 'street', tier: 2, mark: '═', description: 'An arcade gains a lantern-lined route across its connected roofs.', hint: 'Raise all three buildings of an arcade row to three storeys.' },
  { id: 'stepped-terrace', title: 'Stepped Terrace', family: 'terrace', tier: 1, mark: '⌁', description: 'A rising sequence of roofs becomes an outdoor stair through the town.', hint: 'Arrange three connected roofs in a one–two–three height progression beside a usable lower roof.' },
  { id: 'terraced-garden', title: 'Terraced Garden', family: 'terrace', tier: 2, mark: '⌁', description: 'A higher stepped route gathers planters along its landings.', hint: 'Lift a stepped terrace into a two–three–four progression.' },
  { id: 'lantern-stair', title: 'Lantern Stair', family: 'terrace', tier: 3, mark: '⌁', description: 'The highest terrace becomes a warm stair of gardens and lanterns.', hint: 'Lift a terraced garden into a three–four–five progression.' },
  { id: 'rooftop-court', title: 'Rooftop Court', family: 'rooftop', tier: 1, mark: '□', description: 'Four equal roofs share one open room beneath the sky.', hint: 'Make a two-by-two block of equal two-storey buildings.' },
  { id: 'rooftop-pavilion', title: 'Rooftop Pavilion', family: 'rooftop', tier: 2, mark: '▣', description: 'A roofed gathering place grows above a shared court.', hint: 'Raise all four buildings of a rooftop court to three storeys.' },
  { id: 'hanging-roof-garden', title: 'Hanging Roof Garden', family: 'rooftop', tier: 3, mark: '❖', description: 'Greenery spills from the highest shared court.', hint: 'Raise all four sides of a rooftop pavilion to four storeys.' },
  { id: 'courtyard-garden', title: 'Courtyard Garden', family: 'courtyard', tier: 1, mark: '✣', description: 'Three walls shelter an empty place and invite something green to grow.', hint: 'Shelter one empty tile with homes on three sides.' },
  { id: 'cloister-garden', title: 'Cloister Garden', family: 'courtyard', tier: 2, mark: '✤', description: 'Taller walls wrap the garden in a quiet covered walk.', hint: 'Raise the surrounding walls of a courtyard garden to two storeys.' },
  { id: 'courtyard-pavilion', title: 'Courtyard Pavilion', family: 'courtyard', tier: 3, mark: '✥', description: 'A pavilion crowns the most deeply sheltered garden.', hint: 'Raise the surrounding walls of a cloister garden to three storeys.' },
  { id: 'harbor-plaza', title: 'Harbor Plaza', family: 'landmark', tier: 1, mark: '⊞', description: 'A larger opening becomes a public square with water, shade, and room to linger.', hint: 'Leave a two-by-two opening inside a ring of at least six homes.' },
  { id: 'lookout-tower', title: 'Lookout Tower', family: 'landmark', tier: 1, mark: '△', description: 'A lightly connected tall home keeps a clear view of the horizon.', hint: 'Let an isolated or lightly connected home reach three storeys.' },
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
  return Math.max(2, basePopulation - (formationSupportsBusiness(type, occurrences) ? 2 : 0));
}

export function formationInfluenceSummary(formation: FormationDefinition) {
  const businesses = BUSINESS_FAMILIES[formation.family]
    .slice(0, 3)
    .map((type) => type === 'cafe' ? 'cafés' : `${type.replace('-', ' ')}s`)
    .join(', ');
  return `People gather here. Nearby ${businesses} can open sooner and make fuller batches.`;
}

export function formationGatheringActivity(id: FormationId, ageGroup?: string, occupation?: string) {
  const formation = FORMATION_BY_ID.get(id);
  if (!formation) return 'spending time in a familiar place';
  if (formation.family === 'water') return occupation === 'Fisher' ? `checking the current beside the ${formation.title.toLowerCase()}` : `watching boats pass the ${formation.title.toLowerCase()}`;
  if (formation.family === 'street') return ageGroup === 'child' ? `playing beneath the ${formation.title.toLowerCase()}` : `lingering in the shade of the ${formation.title.toLowerCase()}`;
  if (formation.family === 'terrace') return `climbing through the ${formation.title.toLowerCase()}`;
  if (formation.family === 'rooftop') return `sharing the view from the ${formation.title.toLowerCase()}`;
  if (formation.family === 'courtyard') return occupation === 'Gardener' ? `tending the ${formation.title.toLowerCase()}` : `resting inside the ${formation.title.toLowerCase()}`;
  return id === 'lookout-tower' ? 'watching the horizon below the lookout tower' : 'meeting neighbors in the harbor plaza';
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
