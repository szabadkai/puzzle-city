export type Cell = {
  x: number;
  z: number;
  height: number;
  color: number;
  placedAt: number;
  /** Simulated hour when this foundation first rose from the water. */
  foundedAt?: number;
  /** Simulated hour of the most recent height change. */
  renovatedAt?: number;
};

export type SavedTown = {
  version: 1 | 2 | 3 | 4 | 5 | 6;
  seed: number;
  cells: Cell[];
  timeOfDay?: number;
  day?: number;
  citizens?: CitizenSave[];
  businesses?: BusinessSave[];
  discoveries?: string[];
  journal?: JournalEntry[];
  eventLastTriggeredAt?: Record<string, number>;
  followedDiscoveryId?: string;
  catColonyFoundedAt?: number;
};

export type JournalIllustration =
  | 'foundation' | 'garden' | 'arch' | 'bridge' | 'tower'
  | 'neighbors' | 'street' | 'friendship'
  | 'bread' | 'tea' | 'tools' | 'fish' | 'inn'
  | 'market' | 'town' | 'pots' | 'gulls' | 'blossom'
  | 'chorus' | 'supper' | 'festival' | 'blossom-night' | 'lanterns';

export type JournalEntry = {
  id: string;
  eventId: string;
  title: string;
  note: string;
  illustration: JournalIllustration;
  day: number;
  timeOfDay: number;
};

export type BusinessType =
  | 'bakery' | 'cafe' | 'flower-shop' | 'workshop' | 'bookstore'
  | 'fishmonger' | 'restaurant' | 'tea-house' | 'inn' | 'pottery';

export type BusinessSave = {
  id: string;
  type: BusinessType;
  cellKey: string;
  ownerId: string;
  name: string;
  openedAt: number;
  employeeIds?: string[];
  visitCount?: number;
};

export type CitizenAgeGroup = 'child' | 'adult' | 'elder';
export type CitizenKind = 'resident' | 'visitor';

export type CitizenSave = {
  id: string;
  name: string;
  homeKey: string;
  position: [number, number];
  elevation?: number;
  occupation: string;
  traits: string[];
  relationships: string[];
  color: number;
  ageGroup?: CitizenAgeGroup;
  householdId?: string;
  favoriteBusinessId?: string;
  businessVisits?: Record<string, number>;
  residentKind?: CitizenKind;
};

export const keyOf = (x: number, z: number) => `${x},${z}`;

export const CARDINALS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export const DIAGONALS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
