import { CARDINALS, type BusinessSave, type BusinessType, type Cell, type CitizenAgeGroup, type CitizenKind, type CitizenSave, type JournalEntry, type JournalIllustration, keyOf } from './types';
import { analyzeWaterTopology } from './water';
import { findPlazaAnchors } from './topology';

export type TopologyFeature = 'courtyard' | 'arch' | 'bridge' | 'tower' | 'plaza';
export type GridPoint = Readonly<{ x: number; z: number }>;

export type WorldSnapshot = Readonly<{
  cells: readonly Readonly<Cell>[];
  citizens: readonly Readonly<CitizenSave>[];
  topology: Readonly<Record<TopologyFeature, readonly GridPoint[]>>;
  population: number;
  day: number;
  timeOfDay: number;
  businesses: readonly Readonly<BusinessSave>[];
  businessCounts: Readonly<Record<BusinessType, number>>;
  relationshipCount: number;
  water: Readonly<{ dockCount: number; canalCount: number; shelteredCount: number }>;
  priorDiscoveries: readonly string[];
}>;

export type DiscoveryCondition =
  | { kind: 'all'; conditions: readonly DiscoveryCondition[] }
  | { kind: 'any'; conditions: readonly DiscoveryCondition[] }
  | { kind: 'not'; condition: DiscoveryCondition }
  | { kind: 'cells'; atLeast: number }
  | { kind: 'height'; atLeast: number; cellsAtLeast: number }
  | { kind: 'population'; atLeast: number }
  | { kind: 'relationships'; atLeast: number }
  | { kind: 'day'; atLeast: number }
  | { kind: 'time'; after: number; before: number }
  | { kind: 'topology'; feature: TopologyFeature; atLeast: number }
  | { kind: 'business'; businessType?: BusinessType; visitsAtLeast?: number; atLeast: number }
  | { kind: 'regular-at'; businessType: BusinessType; atLeast: number }
  | { kind: 'business-site'; businessType: BusinessType }
  | { kind: 'adjacency'; businessType: BusinessType; feature: TopologyFeature; within?: number }
  | { kind: 'citizen'; occupation?: string; trait?: string; ageGroup?: CitizenAgeGroup; residentKind?: CitizenKind; atLeast: number }
  | { kind: 'water'; feature: 'dock' | 'canal' | 'sheltered'; atLeast: number }
  | { kind: 'discovered'; eventId: string };

export type DiscoveryFocus =
  | { kind: 'topology'; feature: TopologyFeature }
  | { kind: 'business'; businessType: BusinessType }
  | { kind: 'town' };

export type DiscoveryEffect =
  | { kind: 'city'; action: 'glimmer' | 'decorate' }
  | { kind: 'business'; action: 'open'; businessType: BusinessType }
  | { kind: 'citizens'; action: 'notice'; activity: string }
  | { kind: 'citizens'; action: 'assign-occupation'; occupation: string; additional?: boolean }
  | { kind: 'citizens'; action: 'spawn-visitor'; name: string; occupation: string }
  | { kind: 'citizens'; action: 'gather'; activity: string }
  | { kind: 'citizens'; action: 'moment'; activity: string; occupation?: string; ageGroup?: CitizenAgeGroup; favoriteBusinessType?: BusinessType }
  | { kind: 'ambience'; action: 'refresh' | 'celebrate' }
  | { kind: 'presentation'; action: 'reveal'; caption: string; tone: 'stone' | 'green' | 'water' | 'warm' | 'people' };

export type DiscoveryEvent = Readonly<{
  id: string;
  repeatable: boolean;
  cooldownHours?: number;
  title: string;
  note: string;
  illustration: JournalIllustration;
  condition: DiscoveryCondition;
  focus: DiscoveryFocus;
  effects: readonly DiscoveryEffect[];
}>;

export type TriggeredDiscovery = Readonly<{
  event: DiscoveryEvent;
  entry: JournalEntry;
  snapshot: WorldSnapshot;
}>;

type SnapshotInput = {
  cells: Iterable<Cell>;
  citizens: CitizenSave[];
  businesses: BusinessSave[];
  seed: number;
  day: number;
  timeOfDay: number;
  priorDiscoveries: string[];
};

const BUSINESS_TYPES: readonly BusinessType[] = [
  'bakery', 'cafe', 'flower-shop', 'workshop', 'bookstore',
  'fishmonger', 'restaurant', 'tea-house', 'inn', 'pottery',
];

export function createWorldSnapshot(input: SnapshotInput): WorldSnapshot {
  const cells = [...input.cells].map((cell) => Object.freeze({ ...cell, placedAt: 0 }));
  const cellMap = new Map(cells.map((cell) => [keyOf(cell.x, cell.z), cell]));
  const topology: Record<TopologyFeature, GridPoint[]> = { courtyard: [], arch: [], bridge: [], tower: [], plaza: [] };
  const plazaAnchors = findPlazaAnchors(cellMap);
  const plazaCells = new Set<string>();
  for (const anchor of plazaAnchors) {
    topology.plaza.push(Object.freeze({ x: anchor.x, z: anchor.z }));
    plazaCells.add(keyOf(anchor.x, anchor.z));
    plazaCells.add(keyOf(anchor.x + 1, anchor.z));
    plazaCells.add(keyOf(anchor.x, anchor.z + 1));
    plazaCells.add(keyOf(anchor.x + 1, anchor.z + 1));
  }

  for (const cell of cells) {
    const neighborCount = CARDINALS.filter(([dx, dz]) => cellMap.has(keyOf(cell.x + dx, cell.z + dz))).length;
    if (cell.height >= 3 && neighborCount <= 1) topology.tower.push(Object.freeze({ x: cell.x, z: cell.z }));
  }
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
    if (cellMap.has(keyOf(x, z))) continue;
    if (plazaCells.has(keyOf(x, z))) continue;
    const heights = CARDINALS.map(([dx, dz]) => cellMap.get(keyOf(x + dx, z + dz))?.height ?? 0);
    const count = heights.filter((height) => height > 0).length;
    const point = Object.freeze({ x, z });
    if (count >= 3) topology.courtyard.push(point);
    else if ((heights[0] >= 3 && heights[2] >= 3) || (heights[1] >= 3 && heights[3] >= 3)) topology.bridge.push(point);
    else if ((heights[0] >= 2 && heights[2] >= 2) || (heights[1] >= 2 && heights[3] >= 2)) topology.arch.push(point);
  }

  const businesses = input.businesses.map((business) => Object.freeze({ ...business }));
  const citizens = input.citizens.map((citizen) => Object.freeze({
    ...citizen,
    traits: [...citizen.traits],
    relationships: [...citizen.relationships],
  }));
  const businessCounts = Object.fromEntries(BUSINESS_TYPES.map((type) => [type, businesses.filter((business) => business.type === type).length])) as Record<BusinessType, number>;
  const relationshipPairs = new Set<string>();
  for (const citizen of citizens) for (const friendId of citizen.relationships) {
    relationshipPairs.add([citizen.id, friendId].sort().join('|'));
  }
  const waterTopology = analyzeWaterTopology(cells, input.seed);

  return Object.freeze({
    cells: Object.freeze(cells),
    citizens: Object.freeze(citizens),
    topology: Object.freeze({
      courtyard: Object.freeze(topology.courtyard),
      arch: Object.freeze(topology.arch),
      bridge: Object.freeze(topology.bridge),
      tower: Object.freeze(topology.tower),
      plaza: Object.freeze(topology.plaza),
    }),
    population: input.citizens.length,
    day: input.day,
    timeOfDay: input.timeOfDay,
    businesses: Object.freeze(businesses),
    businessCounts: Object.freeze(businessCounts),
    relationshipCount: relationshipPairs.size,
    water: Object.freeze({
      dockCount: waterTopology.docks.length,
      canalCount: waterTopology.canals.length,
      shelteredCount: waterTopology.sheltered.length,
    }),
    priorDiscoveries: Object.freeze([...input.priorDiscoveries]),
  });
}

export function evaluateCondition(condition: DiscoveryCondition, snapshot: WorldSnapshot): boolean {
  switch (condition.kind) {
    case 'all': return condition.conditions.every((candidate) => evaluateCondition(candidate, snapshot));
    case 'any': return condition.conditions.some((candidate) => evaluateCondition(candidate, snapshot));
    case 'not': return !evaluateCondition(condition.condition, snapshot);
    case 'cells': return snapshot.cells.length >= condition.atLeast;
    case 'height': return snapshot.cells.filter((cell) => cell.height >= condition.atLeast).length >= condition.cellsAtLeast;
    case 'population': return snapshot.population >= condition.atLeast;
    case 'relationships': return snapshot.relationshipCount >= condition.atLeast;
    case 'day': return snapshot.day >= condition.atLeast;
    case 'topology': return snapshot.topology[condition.feature].length >= condition.atLeast;
    case 'business': return snapshot.businesses.filter((business) =>
      (!condition.businessType || business.type === condition.businessType)
      && (!condition.visitsAtLeast || (business.visitCount ?? 0) >= condition.visitsAtLeast),
    ).length >= condition.atLeast;
    case 'regular-at': {
      const matchingBusinesses = new Set(snapshot.businesses
        .filter((business) => business.type === condition.businessType)
        .map((business) => business.id));
      return snapshot.citizens.filter((citizen) => citizen.favoriteBusinessId && matchingBusinesses.has(citizen.favoriteBusinessId)).length >= condition.atLeast;
    }
    case 'business-site': {
      const occupiedCells = new Set(snapshot.businesses.map((business) => business.cellKey));
      const occupiedOwners = new Set(snapshot.businesses.map((business) => business.ownerId));
      const cellMap = new Map(snapshot.cells.map((cell) => [keyOf(cell.x, cell.z), cell]));
      return snapshot.citizens.some((citizen) => {
        if (citizen.ageGroup === 'child' || citizen.residentKind === 'visitor' || occupiedOwners.has(citizen.id) || occupiedCells.has(citizen.homeKey)) return false;
        const cell = cellMap.get(citizen.homeKey);
        if (!cell || (condition.businessType === 'inn' && cell.height < 2)) return false;
        return CARDINALS.some(([dx, dz]) => !cellMap.has(keyOf(cell.x + dx, cell.z + dz)));
      });
    }
    case 'adjacency': return snapshot.businesses.some((business) => {
      if (business.type !== condition.businessType) return false;
      const [x, z] = business.cellKey.split(',').map(Number);
      const within = condition.within ?? 1;
      return snapshot.topology[condition.feature].some((point) => Math.abs(point.x - x) + Math.abs(point.z - z) <= within);
    });
    case 'citizen': return snapshot.citizens.filter((citizen) =>
      (!condition.occupation || citizen.occupation === condition.occupation)
      && (!condition.trait || citizen.traits.includes(condition.trait))
      && (!condition.ageGroup || citizen.ageGroup === condition.ageGroup)
      && (!condition.residentKind || citizen.residentKind === condition.residentKind),
    ).length >= condition.atLeast;
    case 'water': {
      const count = condition.feature === 'dock'
        ? snapshot.water.dockCount
        : condition.feature === 'canal'
          ? snapshot.water.canalCount
          : snapshot.water.shelteredCount;
      return count >= condition.atLeast;
    }
    case 'discovered': return snapshot.priorDiscoveries.includes(condition.eventId);
    case 'time': {
      const { after, before } = condition;
      return after <= before
        ? snapshot.timeOfDay >= after && snapshot.timeOfDay < before
        : snapshot.timeOfDay >= after || snapshot.timeOfDay < before;
    }
  }
}

export class GrowSystem {
  private readonly discovered: Set<string>;
  private readonly journal: JournalEntry[];
  private readonly lastTriggeredAt = new Map<string, number>();

  constructor(
    private readonly events: readonly DiscoveryEvent[],
    discovered: string[],
    journal: JournalEntry[],
    private readonly commitEffect: (effect: DiscoveryEffect, discovery: TriggeredDiscovery) => void,
  ) {
    this.discovered = new Set(discovered);
    this.journal = journal.map((entry) => ({ ...entry }));
    for (const entry of this.journal) {
      const absoluteHours = entry.day * 24 + entry.timeOfDay;
      this.lastTriggeredAt.set(entry.eventId, Math.max(this.lastTriggeredAt.get(entry.eventId) ?? -Infinity, absoluteHours));
    }
  }

  private isCoolingDown(event: DiscoveryEvent, snapshot: WorldSnapshot) {
    if (!event.repeatable) return false;
    const lastTriggered = this.lastTriggeredAt.get(event.id);
    return lastTriggered !== undefined && snapshot.day * 24 + snapshot.timeOfDay - lastTriggered < (event.cooldownHours ?? 24);
  }

  evaluate(snapshot: WorldSnapshot, limit = 1) {
    const triggered: TriggeredDiscovery[] = [];
    for (const event of this.events) {
      if (triggered.length >= limit) break;
      if (!event.repeatable && this.discovered.has(event.id)) continue;
      if (this.isCoolingDown(event, snapshot)) continue;
      if (!evaluateCondition(event.condition, snapshot)) continue;
      triggered.push(this.trigger(event, snapshot));
    }
    return triggered;
  }

  force(eventId: string, snapshot: WorldSnapshot) {
    const event = this.events.find((candidate) => candidate.id === eventId);
    return event ? this.trigger(event, snapshot) : null;
  }

  private trigger(event: DiscoveryEvent, snapshot: WorldSnapshot) {
    const entry: JournalEntry = {
      id: event.repeatable ? `${event.id}-${snapshot.day}-${snapshot.timeOfDay.toFixed(2)}` : event.id,
      eventId: event.id,
      title: event.title,
      note: event.note,
      illustration: event.illustration,
      day: snapshot.day,
      timeOfDay: snapshot.timeOfDay,
    };
    if (!event.repeatable) this.discovered.add(event.id);
    else this.lastTriggeredAt.set(event.id, snapshot.day * 24 + snapshot.timeOfDay);
    if (!this.journal.some((existing) => existing.id === entry.id)) this.journal.push(entry);
    const discovery = Object.freeze({ event, entry: Object.freeze({ ...entry }), snapshot });
    for (const effect of event.effects) this.commitEffect(effect, discovery);
    return discovery;
  }

  discoveredIds() { return [...this.discovered]; }

  entries() { return this.journal.map((entry) => ({ ...entry })); }

  inspect(snapshot: WorldSnapshot) {
    return this.events.map((event) => ({
      id: event.id,
      title: event.title,
      repeatable: event.repeatable,
      discovered: this.discovered.has(event.id),
      coolingDown: this.isCoolingDown(event, snapshot),
      eligible: evaluateCondition(event.condition, snapshot) && !this.isCoolingDown(event, snapshot),
    }));
  }
}

const all = (...conditions: DiscoveryCondition[]): DiscoveryCondition => ({ kind: 'all', conditions });
const discovered = (eventId: string): DiscoveryCondition => ({ kind: 'discovered', eventId });
const reveal = (caption: string, tone: Extract<DiscoveryEffect, { kind: 'presentation' }>['tone']): DiscoveryEffect => ({ kind: 'presentation', action: 'reveal', caption, tone });
const standardEffects = (caption: string, tone: Extract<DiscoveryEffect, { kind: 'presentation' }>['tone'], activity: string): readonly DiscoveryEffect[] => [
  { kind: 'city', action: 'glimmer' },
  { kind: 'citizens', action: 'notice', activity },
  reveal(caption, tone),
];
const natureEffects = (caption: string, tone: Extract<DiscoveryEffect, { kind: 'presentation' }>['tone'], activity: string): readonly DiscoveryEffect[] => [
  { kind: 'city', action: 'decorate' },
  { kind: 'ambience', action: 'refresh' },
  { kind: 'citizens', action: 'notice', activity },
  reveal(caption, tone),
];

export const DISCOVERY_EVENTS: readonly DiscoveryEvent[] = [
  {
    id: 'first-foundation', repeatable: false, title: 'The First Stone', illustration: 'foundation',
    note: 'One dry stone is enough for a town to begin imagining itself.',
    condition: { kind: 'cells', atLeast: 1 }, focus: { kind: 'town' },
    effects: standardEffects('The first stone rises above the tide.', 'stone', 'watching the first walls settle'),
  },
  {
    id: 'first-dock', repeatable: false, title: 'A Place to Tie Up', illustration: 'fish',
    note: 'A few timbers reached beyond the quay. The water suddenly felt less like an edge and more like a road.',
    condition: all(discovered('first-foundation'), { kind: 'water', feature: 'dock', atLeast: 1 }), focus: { kind: 'town' },
    effects: standardEffects('A little dock reaches into the tide.', 'water', 'watching the first boat tie up'),
  },
  {
    id: 'canal-waters', repeatable: false, title: 'Between Two Banks', illustration: 'arch',
    note: 'Two rows of houses left a blue lane between them. Even the tide seemed to know where to go.',
    condition: all(discovered('first-foundation'), { kind: 'water', feature: 'canal', atLeast: 1 }), focus: { kind: 'town' },
    effects: standardEffects('The water has become a narrow canal.', 'water', 'leaning over the canal wall'),
  },
  {
    id: 'fishing-boat', repeatable: false, title: 'Before the Harbor Wakes', illustration: 'fish',
    note: 'Before sunrise, a small red sail slipped away from the dock. Someone had decided to follow the fish.',
    condition: all(discovered('first-dock'), { kind: 'population', atLeast: 2 }), focus: { kind: 'town' },
    effects: [
      { kind: 'city', action: 'glimmer' },
      { kind: 'citizens', action: 'assign-occupation', occupation: 'Fisher' },
      { kind: 'ambience', action: 'refresh' },
      reveal('A fishing boat puts out with the morning tide.', 'water'),
    ],
  },
  {
    id: 'fishing-crew', repeatable: false, title: 'Two Lamps Before Dawn', illustration: 'fish',
    note: 'A second lamp began moving along the quay before sunrise. The first fisher no longer checked the nets alone.',
    condition: all(discovered('fishing-boat'), { kind: 'population', atLeast: 6 }, { kind: 'day', atLeast: 2 }), focus: { kind: 'town' },
    effects: [
      { kind: 'citizens', action: 'assign-occupation', occupation: 'Fisher', additional: true },
      { kind: 'citizens', action: 'notice', activity: 'gathering with the fishing crew before dawn' },
      reveal('Two harbor lamps are moving before dawn.', 'water'),
    ],
  },
  {
    id: 'sheltered-courtyard', repeatable: false, title: 'A Sheltered Green', illustration: 'garden',
    note: 'Walls gathered close and made a calm pocket. By morning, something green had taken root.',
    condition: all(discovered('first-foundation'), { kind: 'topology', feature: 'courtyard', atLeast: 1 }), focus: { kind: 'topology', feature: 'courtyard' },
    effects: [
      { kind: 'city', action: 'glimmer' },
      { kind: 'citizens', action: 'gather', activity: 'gathering around the newly planted courtyard tree' },
      reveal('A sheltered garden has taken root.', 'green'),
    ],
  },
  {
    id: 'harbor-plaza', repeatable: false, title: 'Room to Linger', illustration: 'street',
    note: 'The houses stepped back just far enough to leave a little square. By noon, nobody hurried across it.',
    condition: all(discovered('first-foundation'), { kind: 'topology', feature: 'plaza', atLeast: 1 }), focus: { kind: 'topology', feature: 'plaza' },
    effects: standardEffects('A harbor plaza opens between the houses.', 'stone', 'sitting together in the new plaza'),
  },
  {
    id: 'sea-arch', repeatable: false, title: 'Room for the Tide', illustration: 'arch',
    note: 'Two tall neighbors left the water a doorway between them.',
    condition: all(discovered('first-foundation'), { kind: 'topology', feature: 'arch', atLeast: 1 }), focus: { kind: 'topology', feature: 'arch' },
    effects: standardEffects('An arch makes room for the tide.', 'water', 'pausing beneath the sea arch'),
  },
  {
    id: 'high-bridge', repeatable: false, title: 'Above the Blue', illustration: 'bridge',
    note: 'The old arch climbed higher until footsteps could cross above the narrow water.',
    condition: all(discovered('sea-arch'), { kind: 'topology', feature: 'bridge', atLeast: 1 }), focus: { kind: 'topology', feature: 'bridge' },
    effects: standardEffects('A high bridge joins the rooftops.', 'water', 'trying the view from the high bridge'),
  },
  {
    id: 'lookout-tower', repeatable: false, title: 'A Longer Horizon', illustration: 'tower',
    note: 'From the highest little roof, the horizon seems to belong to everyone.',
    condition: all(discovered('first-foundation'), { kind: 'topology', feature: 'tower', atLeast: 1 }), focus: { kind: 'topology', feature: 'tower' },
    effects: standardEffects('A lookout rises over the harbor.', 'stone', 'looking out from the tower'),
  },
  {
    id: 'first-neighbors', repeatable: false, title: 'Doors Across the Way', illustration: 'neighbors',
    note: 'A second light appeared across the quay. The town had neighbors now.',
    condition: all(discovered('first-foundation'), { kind: 'population', atLeast: 2 }), focus: { kind: 'town' },
    effects: standardEffects('There are neighbors across the way.', 'people', 'welcoming a new neighbor'),
  },
  {
    id: 'family-upstairs', repeatable: false, title: 'A Light Upstairs', illustration: 'neighbors',
    note: 'A taller house found room for another small bed. Soon two generations were learning the same front step.',
    condition: all(discovered('first-neighbors'), { kind: 'height', atLeast: 3, cellsAtLeast: 1 }, { kind: 'citizen', ageGroup: 'child', residentKind: 'resident', atLeast: 1 }, { kind: 'day', atLeast: 2 }), focus: { kind: 'town' },
    effects: standardEffects('A family has made room upstairs.', 'people', 'helping a family settle into the taller house'),
  },
  {
    id: 'village-street', repeatable: false, title: 'A Street of Names', illustration: 'street',
    note: 'Five doorways, five names, and a path worn familiar between them.',
    condition: all(discovered('first-neighbors'), { kind: 'population', atLeast: 5 }), focus: { kind: 'town' },
    effects: standardEffects('The quay has become a neighborhood.', 'people', 'learning every name on the street'),
  },
  {
    id: 'familiar-faces', repeatable: false, title: 'Familiar Faces', illustration: 'friendship',
    note: 'Two neighbors stopped being strangers somewhere between one walk and the next.',
    condition: all(discovered('first-neighbors'), { kind: 'relationships', atLeast: 1 }), focus: { kind: 'town' },
    effects: standardEffects('A friendship has found its footing.', 'people', 'sharing news with a friend'),
  },
  {
    id: 'morning-bread', repeatable: false, title: 'Bread Before Sunrise', illustration: 'bread',
    note: 'Warm buns appeared beneath an awning while the harbor was still blue with morning.',
    condition: all(discovered('first-neighbors'), { kind: 'business', businessType: 'bakery', atLeast: 1 }, { kind: 'time', after: 5, before: 10 }), focus: { kind: 'business', businessType: 'bakery' },
    effects: standardEffects('Warm bread reaches the quay before sunrise.', 'warm', 'following the smell of warm bread'),
  },
  {
    id: 'tea-table', repeatable: false, title: 'The Table by the Window', illustration: 'tea',
    note: 'A few cups turned an ordinary doorway into a place where nobody hurried away.',
    condition: all(discovered('village-street'), { kind: 'business', businessType: 'cafe', atLeast: 1 }, { kind: 'time', after: 10, before: 21 }), focus: { kind: 'business', businessType: 'cafe' },
    effects: standardEffects('Tea is being poured by the window.', 'warm', 'lingering over a cup of tea'),
  },
  {
    id: 'makers-door', repeatable: false, title: 'The Maker’s Door', illustration: 'tools',
    note: 'The tap of patient tools began to travel across the afternoon water.',
    condition: all(discovered('village-street'), { kind: 'business', businessType: 'workshop', atLeast: 1 }, { kind: 'time', after: 9, before: 19 }), focus: { kind: 'business', businessType: 'workshop' },
    effects: standardEffects('Small tools are singing behind an open door.', 'stone', 'watching the artisan work'),
  },
  {
    id: 'morning-catch', repeatable: false, title: 'Silver Morning', illustration: 'fish',
    note: 'The catch no longer traveled far. Neighbors gathered while the scales still shone.',
    condition: all(discovered('village-street'), { kind: 'business', businessType: 'fishmonger', atLeast: 1 }, { kind: 'time', after: 5, before: 12 }), focus: { kind: 'business', businessType: 'fishmonger' },
    effects: standardEffects('The morning catch gleams beside the water.', 'water', 'choosing fish for supper'),
  },
  {
    id: 'last-lantern', repeatable: false, title: 'The Last Lantern', illustration: 'inn',
    note: 'One lantern stayed lit for the last ferry, and one more story found a listener.',
    condition: all(discovered('village-street'), { kind: 'business', businessType: 'inn', atLeast: 1 }, { kind: 'time', after: 18, before: 1 }), focus: { kind: 'business', businessType: 'inn' },
    effects: standardEffects('A lantern waits for the last ferry.', 'warm', 'listening to stories at the inn'),
  },
  {
    id: 'courtyard-market', repeatable: false, title: 'Stems Beside the Bread', illustration: 'market',
    note: 'The florist set green buckets beside the baker’s baskets, and the courtyard became a morning market without anyone naming it.',
    condition: all(discovered('morning-bread'), { kind: 'business', businessType: 'flower-shop', atLeast: 1 }, { kind: 'adjacency', businessType: 'bakery', feature: 'courtyard' }, { kind: 'time', after: 7, before: 11 }), focus: { kind: 'topology', feature: 'courtyard' },
    effects: [
      { kind: 'city', action: 'decorate' },
      { kind: 'citizens', action: 'gather', activity: 'gathering for the courtyard morning market' },
      reveal('Flowers and warm bread fill the courtyard.', 'green'),
    ],
  },
  {
    id: 'reading-hour', repeatable: false, title: 'The Shelf by the Window', illustration: 'town',
    note: 'The bookseller began leaving one low shelf for small hands. After lessons, the quietest corner filled first.',
    condition: all({ kind: 'business', businessType: 'bookstore', atLeast: 1 }, { kind: 'citizen', ageGroup: 'child', atLeast: 1 }, { kind: 'time', after: 14, before: 19 }), focus: { kind: 'business', businessType: 'bookstore' },
    effects: standardEffects('The bookstore has found its after-school readers.', 'people', 'reading together by the bookstore window'),
  },
  {
    id: 'potters-kiln', repeatable: false, title: 'Blue Glaze', illustration: 'pots',
    note: 'Tools from the workshop found their way to a pottery wheel. By afternoon, blue cups were cooling beside the quay.',
    condition: all(discovered('makers-door'), { kind: 'business', businessType: 'pottery', atLeast: 1 }, { kind: 'time', after: 12, before: 19 }), focus: { kind: 'business', businessType: 'pottery' },
    effects: standardEffects('Fresh blue cups are cooling outside the pottery.', 'stone', 'admiring the new blue glaze'),
  },
  {
    id: 'quiet-tea', repeatable: false, title: 'The Patient Kettle', illustration: 'tea',
    note: 'Every afternoon the same kettle warmed, and the elders discovered that nobody minded how long one cup lasted.',
    condition: all({ kind: 'business', businessType: 'tea-house', atLeast: 1 }, { kind: 'citizen', ageGroup: 'elder', atLeast: 1 }, { kind: 'time', after: 14, before: 19 }), focus: { kind: 'business', businessType: 'tea-house' },
    effects: standardEffects('The tea house keeps an unhurried afternoon table.', 'warm', 'sharing the patient afternoon kettle'),
  },
  {
    id: 'dockside-kitchen', repeatable: false, title: 'Salt and Steam', illustration: 'supper',
    note: 'The fishmonger saved the best of the morning catch. A cook opened another door, and by dusk its windows were clouded with steam.',
    condition: all(
      discovered('fishing-boat'), discovered('morning-catch'),
      { kind: 'population', atLeast: 10 },
      { kind: 'business-site', businessType: 'restaurant' },
      { kind: 'not', condition: { kind: 'business', businessType: 'restaurant', atLeast: 1 } },
    ), focus: { kind: 'business', businessType: 'fishmonger' },
    effects: [
      { kind: 'business', action: 'open', businessType: 'restaurant' },
      { kind: 'citizens', action: 'notice', activity: 'following the first supper steam along the quay' },
      reveal('The morning catch has found an evening kitchen.', 'warm'),
    ],
  },
  {
    id: 'harbor-supper', repeatable: false, title: 'Fish for the Long Table', illustration: 'supper',
    note: 'The morning catch returned at dusk in steaming bowls. Fishermen and neighbors pulled their chairs to one long table.',
    condition: all(discovered('dockside-kitchen'), { kind: 'business', businessType: 'restaurant', atLeast: 1 }, { kind: 'time', after: 18, before: 23 }), focus: { kind: 'business', businessType: 'restaurant' },
    effects: [
      { kind: 'citizens', action: 'gather', activity: 'gathering for fish supper at the long table' },
      { kind: 'ambience', action: 'refresh' },
      reveal('The waterfront gathers around a long supper table.', 'warm'),
    ],
  },
  {
    id: 'favorite-table', repeatable: false, title: 'The Usual Table', illustration: 'supper',
    note: 'The restaurant no longer asked where to seat everyone. The regulars already knew which chairs were theirs.',
    condition: all(discovered('harbor-supper'), { kind: 'business', businessType: 'restaurant', visitsAtLeast: 8, atLeast: 1 }, { kind: 'time', after: 18, before: 23 }), focus: { kind: 'business', businessType: 'restaurant' },
    effects: standardEffects('The evening restaurant has found its regulars.', 'people', 'settling into the usual supper table'),
  },
  {
    id: 'ferry-route', repeatable: false, title: 'The Last Ferry', illustration: 'inn',
    note: 'The inn kept one lamp burning by the dock. Soon a small ferry learned to look for it in the dark.',
    condition: all(discovered('last-lantern'), { kind: 'water', feature: 'dock', atLeast: 1 }, { kind: 'business', businessType: 'inn', atLeast: 1 }), focus: { kind: 'business', businessType: 'inn' },
    effects: [
      { kind: 'ambience', action: 'refresh' },
      { kind: 'citizens', action: 'notice', activity: 'waiting for the last ferry' },
      reveal('A ferry answers the inn’s last lantern.', 'warm'),
    ],
  },
  {
    id: 'harbor-market', repeatable: false, title: 'A Harbor Market', illustration: 'market',
    note: 'Bread, tea, tools, silver fish, and a bed for travelers: the quay had learned to provide.',
    condition: all(discovered('morning-bread'), discovered('tea-table'), discovered('makers-door'), discovered('morning-catch'), discovered('last-lantern')), focus: { kind: 'town' },
    effects: standardEffects('The whole harbor hums with trade.', 'people', 'making a slow round of the harbor market'),
  },
  {
    id: 'merchant-arrival', repeatable: false, title: 'Cargo on the Tide', illustration: 'market',
    note: 'A broad little boat found the sheltered water and unloaded bright crates beside the market.',
    condition: all(discovered('harbor-market'), { kind: 'water', feature: 'dock', atLeast: 1 }, { kind: 'water', feature: 'sheltered', atLeast: 1 }), focus: { kind: 'town' },
    effects: [
      { kind: 'ambience', action: 'refresh' },
      { kind: 'citizens', action: 'notice', activity: 'helping unload the merchant boat' },
      reveal('A merchant boat has found the sheltered quay.', 'water'),
    ],
  },
  {
    id: 'tower-bell', repeatable: false, title: 'The Bell Above the Quay', illustration: 'tower',
    note: 'The merchant left a bronze bell behind. The lookout raised it where both plaza and harbor could hear.',
    condition: all(discovered('merchant-arrival'), discovered('lookout-tower')), focus: { kind: 'topology', feature: 'tower' },
    effects: natureEffects('A bell rises above the harbor.', 'warm', 'listening for the new tower bell'),
  },
  {
    id: 'mysterious-traveler', repeatable: false, title: 'A Coat Full of Roads', illustration: 'inn',
    note: 'The last ferry left one passenger behind: a traveler with salt on her coat and a seed wrapped in blue paper.',
    condition: all(discovered('festival-ribbons'), { kind: 'business', businessType: 'inn', atLeast: 1 }), focus: { kind: 'business', businessType: 'inn' },
    effects: [
      { kind: 'citizens', action: 'spawn-visitor', name: 'Mara', occupation: 'Traveler' },
      { kind: 'citizens', action: 'notice', activity: 'welcoming a traveler from the last ferry' },
      reveal('A traveler steps ashore carrying a blue-paper parcel.', 'people'),
    ],
  },
  {
    id: 'rare-tree', repeatable: false, title: 'The Blue-Paper Seed', illustration: 'garden',
    note: 'Mara planted her seed in the most sheltered earth. Its silver-green leaves opened before anyone thought to doubt it.',
    condition: all(discovered('mysterious-traveler'), discovered('sheltered-courtyard'), { kind: 'day', atLeast: 3 }), focus: { kind: 'topology', feature: 'courtyard' },
    effects: natureEffects('A rare silver tree takes root in the courtyard.', 'green', 'visiting the traveler’s rare tree'),
  },
  {
    id: 'birds-nest', repeatable: false, title: 'A Nest Above the Bell', illustration: 'gulls',
    note: 'The rare tree offered one bright twig after another. By evening, a small nest had appeared above the bell.',
    condition: all(discovered('rare-tree'), discovered('gulls-return'), { kind: 'citizen', ageGroup: 'child', atLeast: 1 }, { kind: 'day', atLeast: 4 }), focus: { kind: 'topology', feature: 'tower' },
    effects: natureEffects('Harbor birds have built a nest above the bell.', 'green', 'looking up at the new nest'),
  },
  {
    id: 'clock-tower', repeatable: false, title: 'The Harbor Keeps Time', illustration: 'tower',
    note: 'The workshop fitted a patient clock beneath the nest. Its hands kept ferry time, bread time, and the hour when friends came home.',
    condition: all(discovered('birds-nest'), discovered('tower-bell'), discovered('makers-door')), focus: { kind: 'topology', feature: 'tower' },
    effects: [
      { kind: 'city', action: 'decorate' },
      { kind: 'ambience', action: 'celebrate' },
      { kind: 'citizens', action: 'gather', activity: 'gathering below the clock for its first chime' },
      reveal('A clock face begins keeping the harbor’s many hours.', 'warm'),
    ],
  },
  {
    id: 'town-remembers', repeatable: false, title: 'The Town Remembers', illustration: 'town',
    note: 'Stone, garden, bridge, work, and friendship now hold one another together. The town has a memory of its own.',
    condition: all(discovered('sheltered-courtyard'), discovered('high-bridge'), discovered('lookout-tower'), discovered('familiar-faces'), discovered('harbor-market'), { kind: 'population', atLeast: 7 }), focus: { kind: 'town' },
    effects: standardEffects('For a moment, the whole town seems to remember.', 'warm', 'remembering how the town began'),
  },
  {
    id: 'rooftop-gardens', repeatable: false, title: 'Gardens Above the Quay', illustration: 'pots',
    note: 'Cuttings from the sheltered garden climbed the stairs and found sun on the crowded roofs.',
    condition: all(discovered('sheltered-courtyard'), { kind: 'cells', atLeast: 9 }), focus: { kind: 'topology', feature: 'courtyard' },
    effects: natureEffects('Little gardens are climbing onto the roofs.', 'green', 'carrying seedlings up the stairs'),
  },
  {
    id: 'gulls-return', repeatable: false, title: 'The Gulls Return', illustration: 'gulls',
    note: 'The lookout gave the circling gulls a landmark. Their pale wings came home to the harbor.',
    condition: all(discovered('lookout-tower'), { kind: 'population', atLeast: 5 }), focus: { kind: 'topology', feature: 'tower' },
    effects: natureEffects('Gulls circle the lookout tower.', 'water', 'watching the gulls return'),
  },
  {
    id: 'blossom-tide', repeatable: false, title: 'A Tide of Blossom', illustration: 'blossom',
    note: 'The oldest courtyard tree flowered, and the wind carried its color from roof to roof.',
    condition: all(discovered('rooftop-gardens'), { kind: 'day', atLeast: 2 }), focus: { kind: 'topology', feature: 'courtyard' },
    effects: natureEffects('Blossom drifts through the sheltered streets.', 'green', 'following petals through the town'),
  },
  {
    id: 'evening-chorus', repeatable: false, title: 'The Evening Chorus', illustration: 'chorus',
    note: 'Gulls settled, insects kindled above the gardens, and every small night sound found its place.',
    condition: all(discovered('gulls-return'), discovered('familiar-faces'), { kind: 'time', after: 17.5, before: 22 }), focus: { kind: 'town' },
    effects: natureEffects('The harbor gathers its evening chorus.', 'water', 'listening to the evening chorus'),
  },
  {
    id: 'shared-supper', repeatable: false, title: 'A Shared Supper', illustration: 'supper',
    note: 'Friends pulled their chairs together. For once, no doorway marked where one household ended.',
    condition: all(discovered('familiar-faces'), { kind: 'relationships', atLeast: 3 }, { kind: 'any', conditions: [{ kind: 'business', businessType: 'cafe', atLeast: 1 }, { kind: 'business', businessType: 'inn', atLeast: 1 }] }, { kind: 'time', after: 18, before: 22.5 }), focus: { kind: 'town' },
    effects: natureEffects('Friends have drawn their tables together.', 'people', 'sharing supper with old friends'),
  },
  {
    id: 'festival-ribbons', repeatable: false, title: 'Ribbons Across the Street', illustration: 'festival',
    note: 'Nobody announced a festival. Bright scraps simply crossed the street until celebration became inevitable.',
    condition: all(discovered('town-remembers'), discovered('tower-bell'), discovered('harbor-plaza'), { kind: 'relationships', atLeast: 3 }), focus: { kind: 'topology', feature: 'plaza' },
    effects: natureEffects('Festival ribbons appear between the eaves.', 'warm', 'hanging bright ribbons over the quay'),
  },
  {
    id: 'blossom-evening', repeatable: false, title: 'Blossom Evening', illustration: 'blossom-night',
    note: 'Petals caught in the festival ribbons while the first lamps warmed the blue hour.',
    condition: all(discovered('festival-ribbons'), discovered('blossom-tide'), { kind: 'time', after: 18.5, before: 22.5 }), focus: { kind: 'topology', feature: 'courtyard' },
    effects: natureEffects('Petals catch in the ribbons at blue hour.', 'warm', 'walking beneath blossom and ribbons'),
  },
  {
    id: 'lantern-finale', repeatable: false, title: 'All the Lanterns', illustration: 'lanterns',
    note: 'Every window answered another. Seen from the water, the town was a constellation that had chosen to stay.',
    condition: all(discovered('blossom-evening'), discovered('shared-supper'), discovered('evening-chorus'), discovered('clock-tower'), discovered('ferry-route'), { kind: 'time', after: 19, before: 23 }), focus: { kind: 'town' },
    effects: [
      { kind: 'city', action: 'decorate' },
      { kind: 'ambience', action: 'celebrate' },
      { kind: 'citizens', action: 'gather', activity: 'gathering along the quay for all the lanterns' },
      reveal('The town seems happy.', 'warm'),
    ],
  },
  {
    id: 'daily-morning-regulars', repeatable: true, cooldownHours: 22, title: 'The Familiar Order', illustration: 'bread',
    note: 'The door opened before the order was spoken. Some rituals belong as much to a town as its streets do.',
    condition: all(discovered('morning-bread'), { kind: 'regular-at', businessType: 'bakery', atLeast: 1 }, { kind: 'time', after: 6, before: 9.5 }), focus: { kind: 'business', businessType: 'bakery' },
    effects: [{ kind: 'citizens', action: 'moment', activity: 'collecting the familiar morning order', favoriteBusinessType: 'bakery' }],
  },
  {
    id: 'daily-fishing-crew', repeatable: true, cooldownHours: 22, title: 'Lamps Before Dawn', illustration: 'fish',
    note: 'Two small lamps moved toward the water while the rest of the windows were still dark.',
    condition: all(discovered('fishing-crew'), { kind: 'citizen', occupation: 'Fisher', atLeast: 2 }, { kind: 'time', after: 4.5, before: 6.25 }), focus: { kind: 'town' },
    effects: [{ kind: 'citizens', action: 'moment', activity: 'walking down to the boats before dawn', occupation: 'Fisher' }],
  },
  {
    id: 'daily-bird-feeding', repeatable: true, cooldownHours: 22, title: 'Crumbs in the Square', illustration: 'gulls',
    note: 'After lessons, the smallest hands scattered crumbs and the boldest birds came down first.',
    condition: all(discovered('birds-nest'), { kind: 'citizen', ageGroup: 'child', atLeast: 1 }, { kind: 'topology', feature: 'plaza', atLeast: 1 }, { kind: 'time', after: 14, before: 18 }), focus: { kind: 'topology', feature: 'plaza' },
    effects: [{ kind: 'citizens', action: 'moment', activity: 'feeding the birds in the plaza', ageGroup: 'child' }],
  },
  {
    id: 'daily-waterfront-greetings', repeatable: true, cooldownHours: 22, title: 'The Waterfront Bench', illustration: 'neighbors',
    note: 'The same bench gathered a different conversation every afternoon.',
    condition: all({ kind: 'citizen', ageGroup: 'elder', atLeast: 1 }, { kind: 'water', feature: 'dock', atLeast: 1 }, { kind: 'time', after: 14, before: 18 }), focus: { kind: 'town' },
    effects: [{ kind: 'citizens', action: 'moment', activity: 'greeting passersby beside the water', ageGroup: 'elder' }],
  },
  {
    id: 'daily-usual-table', repeatable: true, cooldownHours: 22, title: 'The Usual Table', illustration: 'supper',
    note: 'A chair was already turned toward the door. The kitchen knew who would arrive next.',
    condition: all(discovered('favorite-table'), { kind: 'regular-at', businessType: 'restaurant', atLeast: 1 }, { kind: 'business', businessType: 'restaurant', visitsAtLeast: 8, atLeast: 1 }, { kind: 'time', after: 18, before: 22 }), focus: { kind: 'business', businessType: 'restaurant' },
    effects: [{ kind: 'citizens', action: 'moment', activity: 'returning to the usual table', favoriteBusinessType: 'restaurant' }],
  },
] as const;

export function resolveFocus(focus: DiscoveryFocus, snapshot: WorldSnapshot): GridPoint | null {
  if (focus.kind === 'topology') return snapshot.topology[focus.feature][0] ?? null;
  if (focus.kind === 'business') {
    const business = snapshot.businesses.find((candidate) => candidate.type === focus.businessType);
    if (!business) return null;
    const [x, z] = business.cellKey.split(',').map(Number);
    return { x, z };
  }
  const cell = snapshot.cells[0];
  return cell ? { x: cell.x, z: cell.z } : null;
}
