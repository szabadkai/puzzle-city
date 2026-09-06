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
  version: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;
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
  crafting?: CraftingSave;
  /** Architectural forms the player has revealed, even if later reshaped. */
  formations?: FormationId[];
  /** Higher-order places formed by bringing compatible architectural forms together. */
  placeIdentities?: PlaceIdentityId[];
  /** Optional living-place clue currently followed in the shared tide tracker. */
  followedPlaceIdentityId?: PlaceIdentityId;
  /** Whether the player has seen or dismissed the optional Second Tide introduction. */
  placeIntroductionSeen?: boolean;
  /** Existing towns and players who skip the guide should not see it again. */
  onboardingDismissed?: boolean;
  /** Explicit geography keeps a saved shoreline stable across generator changes. */
  harborProfile?: HarborProfileSave;
  /** A town never changes world pack after its first foundation is raised. */
  worldPackId?: WorldPackId;
  /** Undefined means not chosen yet; null remembers that the player declined. */
  townPromiseId?: TownPromiseId | null;
  townPromiseCompleted?: boolean;
  expeditions?: ExpeditionsSave;
};

export type WorldPackId = 'classic-harbor' | 'trade-wind-isles';

export type HarborArchetype =
  | 'classic-harbor'
  | 'split-channel'
  | 'sheltered-lagoon'
  | 'stepping-stones'
  | 'long-shoal';

export type HarborCellType = 'shoal' | 'deep-current' | 'rock-outcrop';

export type HarborConstraintCell = Readonly<{
  x: number;
  z: number;
  type: HarborCellType;
  /** Reefs are a pack-specific expression of a buildable shoal, not a new rule. */
  detail?: 'reef';
}>;

export type HarborProfileSave = Readonly<{
  generatorVersion: number;
  archetype: HarborArchetype;
  title: string;
  firstTide: Readonly<{ x: number; z: number }>;
  constraints: readonly HarborConstraintCell[];
}>;

export type TownPromiseId =
  | 'between-two-waters'
  | 'gardens-above'
  | 'makers-tide'
  | 'returning-light'
  | 'evenings-for-everyone';

export type ExpeditionRouteId =
  | 'market-exchange'
  | 'seed-voyage'
  | 'kiln-commission'
  | 'beacon-survey'
  | 'theatre-visit'
  | 'roof-messenger';

export type ActiveVoyageSave = Readonly<{
  routeId: ExpeditionRouteId;
  departedAt: number;
  returnsAt: number;
}>;

export type ExpeditionsSave = Readonly<{
  activeVoyage?: ActiveVoyageSave;
  completedRoutes: ExpeditionRouteId[];
  earnedKeepsakes: string[];
}>;

export type FormationId =
  | 'narrow-canal' | 'sea-arch' | 'high-bridge' | 'covered-skybridge' | 'lantern-gate'
  | 'arcade-row' | 'roof-promenade'
  | 'stepped-terrace' | 'terraced-garden' | 'lantern-stair'
  | 'rooftop-court' | 'rooftop-pavilion' | 'hanging-roof-garden'
  | 'courtyard-garden' | 'cloister-garden' | 'courtyard-pavilion'
  | 'harbor-plaza' | 'lookout-tower';

export type PlaceIdentityId =
  | 'canal-market'
  | 'garden-commons'
  | 'makers-walk'
  | 'roof-village'
  | 'high-harbor'
  | 'lantern-square';

export type JournalIllustration =
  | 'foundation' | 'rain' | 'garden' | 'arch' | 'bridge' | 'tower'
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
  | 'fishmonger' | 'restaurant' | 'tea-house' | 'inn' | 'pottery'
  | 'mill' | 'smokehouse' | 'weaver' | 'shipyard';

export type CraftGood =
  | 'fish' | 'grain' | 'flour' | 'bread' | 'herbs' | 'tea'
  | 'timber' | 'tools' | 'clay' | 'tableware' | 'fiber' | 'cloth'
  | 'smoked-fish' | 'supper' | 'hospitality' | 'fishing-gear' | 'harbor-goods';

export type CraftingSave = {
  goods: Partial<Record<CraftGood, number>>;
  completedRecipes: string[];
  lastProducedAt: number;
  cursor: number;
};

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
