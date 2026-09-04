import { CARDINALS, type BusinessSave, type BusinessType, type Cell, type CitizenSave, type JournalEntry, type JournalIllustration, keyOf } from './types';

export type TopologyFeature = 'courtyard' | 'arch' | 'bridge' | 'tower';
export type GridPoint = Readonly<{ x: number; z: number }>;

export type WorldSnapshot = Readonly<{
  cells: readonly Readonly<Cell>[];
  topology: Readonly<Record<TopologyFeature, readonly GridPoint[]>>;
  population: number;
  day: number;
  timeOfDay: number;
  businesses: readonly Readonly<BusinessSave>[];
  businessCounts: Readonly<Record<BusinessType, number>>;
  relationshipCount: number;
  priorDiscoveries: readonly string[];
}>;

export type DiscoveryCondition =
  | { kind: 'all'; conditions: readonly DiscoveryCondition[] }
  | { kind: 'any'; conditions: readonly DiscoveryCondition[] }
  | { kind: 'not'; condition: DiscoveryCondition }
  | { kind: 'cells'; atLeast: number }
  | { kind: 'population'; atLeast: number }
  | { kind: 'relationships'; atLeast: number }
  | { kind: 'day'; atLeast: number }
  | { kind: 'time'; after: number; before: number }
  | { kind: 'topology'; feature: TopologyFeature; atLeast: number }
  | { kind: 'business'; businessType?: BusinessType; atLeast: number }
  | { kind: 'discovered'; eventId: string };

export type DiscoveryFocus =
  | { kind: 'topology'; feature: TopologyFeature }
  | { kind: 'business'; businessType: BusinessType }
  | { kind: 'town' };

export type DiscoveryEffect =
  | { kind: 'city'; action: 'glimmer' }
  | { kind: 'citizens'; action: 'notice'; activity: string }
  | { kind: 'presentation'; action: 'reveal'; caption: string; tone: 'stone' | 'green' | 'water' | 'warm' | 'people' };

export type DiscoveryEvent = Readonly<{
  id: string;
  repeatable: boolean;
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
  day: number;
  timeOfDay: number;
  priorDiscoveries: string[];
};

const BUSINESS_TYPES: readonly BusinessType[] = ['bakery', 'cafe', 'workshop', 'fishmonger', 'inn'];

export function createWorldSnapshot(input: SnapshotInput): WorldSnapshot {
  const cells = [...input.cells].map((cell) => Object.freeze({ ...cell, placedAt: 0 }));
  const cellMap = new Map(cells.map((cell) => [keyOf(cell.x, cell.z), cell]));
  const topology: Record<TopologyFeature, GridPoint[]> = { courtyard: [], arch: [], bridge: [], tower: [] };

  for (const cell of cells) {
    const neighborCount = CARDINALS.filter(([dx, dz]) => cellMap.has(keyOf(cell.x + dx, cell.z + dz))).length;
    if (cell.height >= 3 && neighborCount <= 1) topology.tower.push(Object.freeze({ x: cell.x, z: cell.z }));
  }
  for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
    if (cellMap.has(keyOf(x, z))) continue;
    const heights = CARDINALS.map(([dx, dz]) => cellMap.get(keyOf(x + dx, z + dz))?.height ?? 0);
    const count = heights.filter((height) => height > 0).length;
    const point = Object.freeze({ x, z });
    if (count >= 3) topology.courtyard.push(point);
    else if ((heights[0] >= 3 && heights[2] >= 3) || (heights[1] >= 3 && heights[3] >= 3)) topology.bridge.push(point);
    else if ((heights[0] >= 2 && heights[2] >= 2) || (heights[1] >= 2 && heights[3] >= 2)) topology.arch.push(point);
  }

  const businesses = input.businesses.map((business) => Object.freeze({ ...business }));
  const businessCounts = Object.fromEntries(BUSINESS_TYPES.map((type) => [type, businesses.filter((business) => business.type === type).length])) as Record<BusinessType, number>;
  const relationshipPairs = new Set<string>();
  for (const citizen of input.citizens) for (const friendId of citizen.relationships) {
    relationshipPairs.add([citizen.id, friendId].sort().join('|'));
  }

  return Object.freeze({
    cells: Object.freeze(cells),
    topology: Object.freeze({
      courtyard: Object.freeze(topology.courtyard),
      arch: Object.freeze(topology.arch),
      bridge: Object.freeze(topology.bridge),
      tower: Object.freeze(topology.tower),
    }),
    population: input.citizens.length,
    day: input.day,
    timeOfDay: input.timeOfDay,
    businesses: Object.freeze(businesses),
    businessCounts: Object.freeze(businessCounts),
    relationshipCount: relationshipPairs.size,
    priorDiscoveries: Object.freeze([...input.priorDiscoveries]),
  });
}

export function evaluateCondition(condition: DiscoveryCondition, snapshot: WorldSnapshot): boolean {
  switch (condition.kind) {
    case 'all': return condition.conditions.every((candidate) => evaluateCondition(candidate, snapshot));
    case 'any': return condition.conditions.some((candidate) => evaluateCondition(candidate, snapshot));
    case 'not': return !evaluateCondition(condition.condition, snapshot);
    case 'cells': return snapshot.cells.length >= condition.atLeast;
    case 'population': return snapshot.population >= condition.atLeast;
    case 'relationships': return snapshot.relationshipCount >= condition.atLeast;
    case 'day': return snapshot.day >= condition.atLeast;
    case 'topology': return snapshot.topology[condition.feature].length >= condition.atLeast;
    case 'business': return (condition.businessType ? snapshot.businessCounts[condition.businessType] : snapshot.businesses.length) >= condition.atLeast;
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

  constructor(
    private readonly events: readonly DiscoveryEvent[],
    discovered: string[],
    journal: JournalEntry[],
    private readonly commitEffect: (effect: DiscoveryEffect, discovery: TriggeredDiscovery) => void,
  ) {
    this.discovered = new Set(discovered);
    this.journal = journal.map((entry) => ({ ...entry }));
  }

  evaluate(snapshot: WorldSnapshot, limit = 1) {
    const triggered: TriggeredDiscovery[] = [];
    for (const event of this.events) {
      if (triggered.length >= limit) break;
      if (!event.repeatable && this.discovered.has(event.id)) continue;
      if (!evaluateCondition(event.condition, snapshot)) continue;
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
      if (!this.journal.some((existing) => existing.id === entry.id)) this.journal.push(entry);
      const discovery = Object.freeze({ event, entry: Object.freeze({ ...entry }), snapshot });
      for (const effect of event.effects) this.commitEffect(effect, discovery);
      triggered.push(discovery);
    }
    return triggered;
  }

  discoveredIds() { return [...this.discovered]; }

  entries() { return this.journal.map((entry) => ({ ...entry })); }
}

const all = (...conditions: DiscoveryCondition[]): DiscoveryCondition => ({ kind: 'all', conditions });
const discovered = (eventId: string): DiscoveryCondition => ({ kind: 'discovered', eventId });
const reveal = (caption: string, tone: Extract<DiscoveryEffect, { kind: 'presentation' }>['tone']): DiscoveryEffect => ({ kind: 'presentation', action: 'reveal', caption, tone });
const standardEffects = (caption: string, tone: Extract<DiscoveryEffect, { kind: 'presentation' }>['tone'], activity: string): readonly DiscoveryEffect[] => [
  { kind: 'city', action: 'glimmer' },
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
    id: 'sheltered-courtyard', repeatable: false, title: 'A Sheltered Green', illustration: 'garden',
    note: 'Walls gathered close and made a calm pocket. By morning, something green had taken root.',
    condition: all(discovered('first-foundation'), { kind: 'topology', feature: 'courtyard', atLeast: 1 }), focus: { kind: 'topology', feature: 'courtyard' },
    effects: standardEffects('A sheltered garden has taken root.', 'green', 'resting in the new courtyard'),
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
    id: 'harbor-market', repeatable: false, title: 'A Harbor Market', illustration: 'market',
    note: 'Bread, tea, tools, silver fish, and a bed for travelers: the quay had learned to provide.',
    condition: all(discovered('morning-bread'), discovered('tea-table'), discovered('makers-door'), discovered('morning-catch'), discovered('last-lantern')), focus: { kind: 'town' },
    effects: standardEffects('The whole harbor hums with trade.', 'people', 'making a slow round of the harbor market'),
  },
  {
    id: 'town-remembers', repeatable: false, title: 'The Town Remembers', illustration: 'town',
    note: 'Stone, garden, bridge, work, and friendship now hold one another together. The town has a memory of its own.',
    condition: all(discovered('sheltered-courtyard'), discovered('high-bridge'), discovered('lookout-tower'), discovered('familiar-faces'), discovered('harbor-market'), { kind: 'population', atLeast: 7 }), focus: { kind: 'town' },
    effects: standardEffects('For a moment, the whole town seems to remember.', 'warm', 'remembering how the town began'),
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
