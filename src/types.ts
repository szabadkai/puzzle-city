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
  version: 10;
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
  /** Rare three-form places the town has discovered, even if later reshaped. */
  confluences?: ConfluenceId[];
  /** Lanterns the player deliberately kindled at their matching Confluences. */
  harborLanterns?: HarborLanternId[];
  /** Optional living-place clue currently followed in the shared tide tracker. */
  followedPlaceIdentityId?: PlaceIdentityId;
  /** Optional three-form clue currently followed in the shared tide tracker. */
  followedConfluenceId?: ConfluenceId;
  /** Whether the player has seen or dismissed the optional Second Tide introduction. */
  placeIntroductionSeen?: boolean;
  /** Existing towns and players who skip the guide should not see it again. */
  onboardingDismissed?: boolean;
};

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
  | 'lantern-square'
  | 'ferry-quarter'
  | 'tidepool-cloister'
  | 'story-court'
  | 'windloom-quarter'
  | 'bell-steps'
  | 'messengers-row'
  | 'star-garden'
  | 'kite-steps';

export type ConfluenceId =
  | 'grand-exchange'
  | 'tide-sanctuary'
  | 'house-of-hands'
  | 'festival-crown'
  | 'celestial-beacon'
  | 'banner-guild'
  | 'archive-tower';

export type HarborLanternId = 'blossom' | 'table' | 'chorus' | 'clock' | 'welcome';

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
  /** The living place that first drew this trade here. Kept as neighborhood history. */
  placeIdentityId?: PlaceIdentityId;
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
