import { craftGoodLabel } from './crafting.ts';
import type { PlaceLandmarkKind } from './place-identities.ts';
import type {
  CraftGood,
  ExpeditionRouteId,
  ExpeditionsSave,
  ActiveVoyageSave,
  WorldPackId,
} from './types.ts';
import { worldPack } from './world-packs.ts';

export type CargoBundle = Readonly<Partial<Record<CraftGood, number>>>;
export type ExpeditionRouteKind = 'sheltered-water' | 'working-dock' | 'deep-passage' | 'roof-route';

export type ExpeditionDefinition = Readonly<{
  id: ExpeditionRouteId;
  landmark: PlaceLandmarkKind;
  title: string;
  cargo: CargoBundle;
  routeKind: ExpeditionRouteKind;
  durationHours: number;
  vessel: string;
  result: string;
}>;

export const EXPEDITION_CATALOG: readonly ExpeditionDefinition[] = [
  {
    id: 'market-exchange', landmark: 'market-barge', title: 'Exchange Beyond the Breakwater',
    cargo: { 'harbor-goods': 1, hospitality: 1 }, routeKind: 'sheltered-water', durationHours: 12,
    vessel: 'market sail', result: 'visiting sail and painted market decoration',
  },
  {
    id: 'seed-voyage', landmark: 'seed-house', title: 'Seeds Across the Water',
    cargo: { herbs: 2, cloth: 1 }, routeKind: 'working-dock', durationHours: 9,
    vessel: 'garden skiff', result: 'rare flowering plant',
  },
  {
    id: 'kiln-commission', landmark: 'guild-kiln', title: 'The Distant Kiln Mark',
    cargo: { tools: 2, tableware: 2 }, routeKind: 'working-dock', durationHours: 15,
    vessel: 'commission boat', result: 'fired architectural ornament',
  },
  {
    id: 'beacon-survey', landmark: 'signal-beacon', title: 'Survey Beyond the Beacon',
    cargo: { 'fishing-gear': 1, hospitality: 1 }, routeKind: 'deep-passage', durationHours: 18,
    vessel: 'survey cutter', result: 'charted route and survey keepsake',
  },
  {
    id: 'theatre-visit', landmark: 'lantern-theatre', title: 'A Stage Across the Tide',
    cargo: { tea: 1, cloth: 1, tableware: 1 }, routeKind: 'working-dock', durationHours: 14,
    vessel: 'performers’ boat', result: 'traveling performer and stage decoration',
  },
  {
    id: 'roof-messenger', landmark: 'roof-hall', title: 'Messages Above the Roofs',
    cargo: { hospitality: 1, cloth: 1 }, routeKind: 'roof-route', durationHours: 7,
    vessel: 'rooftop messenger', result: 'visiting household and rooftop message pennant',
  },
] as const;

export const EXPEDITION_BY_ID = new Map(EXPEDITION_CATALOG.map((route) => [route.id, route]));
export const EXPEDITION_BY_LANDMARK = new Map(EXPEDITION_CATALOG.map((route) => [route.landmark, route]));

export type ExpeditionRouteContext = Readonly<{
  docks: number;
  shelteredWater: number;
  deepPassages: number;
}>;

export type ExpeditionReadiness = Readonly<{
  route: ExpeditionDefinition;
  ready: boolean;
  active: boolean;
  completedBefore: boolean;
  missingCargo: readonly string[];
  routeReady: boolean;
  explanation: string;
}>;

export type ExpeditionReturn = Readonly<{
  route: ExpeditionDefinition;
  reward: string;
  keepsake: string;
}>;

function routeAvailable(kind: ExpeditionRouteKind, context: ExpeditionRouteContext) {
  if (kind === 'roof-route') return true;
  if (kind === 'sheltered-water') return context.shelteredWater > 0 || context.docks > 0;
  if (kind === 'deep-passage') return context.deepPassages > 0 || context.docks > 0;
  return context.docks > 0;
}

function routeNeed(kind: ExpeditionRouteKind) {
  if (kind === 'sheltered-water') return 'a sheltered water route or working dock';
  if (kind === 'deep-passage') return 'an open deep-water passage or working dock';
  if (kind === 'roof-route') return 'the connected roofs around the hall';
  return 'a working dock for the vessel';
}

function cargoShortages(bundle: CargoBundle, goods: Readonly<Partial<Record<CraftGood, number>>>) {
  return Object.entries(bundle).flatMap(([good, required]) => {
    const have = goods[good as CraftGood] ?? 0;
    const missing = (required ?? 0) - have;
    return missing > 0 ? [`${craftGoodLabel(good as CraftGood)} ${missing}`] : [];
  });
}

export class ExpeditionSystem {
  private readonly packId: WorldPackId;
  private activeVoyage?: ActiveVoyageSave;
  private readonly completedRoutes: Set<ExpeditionRouteId>;
  private readonly earnedKeepsakes: Set<string>;

  constructor(packId: WorldPackId, saved?: ExpeditionsSave) {
    this.packId = packId;
    this.activeVoyage = saved?.activeVoyage ? Object.freeze({ ...saved.activeVoyage }) : undefined;
    this.completedRoutes = new Set(saved?.completedRoutes ?? []);
    this.earnedKeepsakes = new Set(saved?.earnedKeepsakes ?? []);
  }

  readiness(
    landmark: PlaceLandmarkKind,
    activeLandmarks: ReadonlySet<PlaceLandmarkKind>,
    goods: Readonly<Partial<Record<CraftGood, number>>>,
    context: ExpeditionRouteContext,
  ): ExpeditionReadiness | null {
    const route = EXPEDITION_BY_LANDMARK.get(landmark);
    if (!route) return null;
    const missingCargo = cargoShortages(route.cargo, goods);
    const routeReady = routeAvailable(route.routeKind, context);
    const landmarkReady = activeLandmarks.has(landmark);
    const active = this.activeVoyage?.routeId === route.id;
    const busy = Boolean(this.activeVoyage) && !active;
    const ready = landmarkReady && !missingCargo.length && routeReady && !this.activeVoyage;
    const explanation = active
      ? `${route.vessel} is away and will return with ${this.rewardFor(route)}.`
      : busy
        ? 'Another confirmed voyage is already away; this opportunity will wait.'
        : !landmarkReady
          ? `The ${landmark.replaceAll('-', ' ')} must be active.`
          : missingCargo.length
            ? `Still needed: ${missingCargo.join(' and ')}.`
            : !routeReady
              ? `Still needed: ${routeNeed(route.routeKind)}.`
              : `Ready: confirm once to send ${this.cargoLabel(route.cargo)} aboard the ${route.vessel}.`;
    return Object.freeze({
      route,
      ready,
      active,
      completedBefore: this.completedRoutes.has(route.id),
      missingCargo: Object.freeze(missingCargo),
      routeReady,
      explanation,
    });
  }

  confirmDeparture(
    landmark: PlaceLandmarkKind,
    absoluteHours: number,
    activeLandmarks: ReadonlySet<PlaceLandmarkKind>,
    goods: Readonly<Partial<Record<CraftGood, number>>>,
    context: ExpeditionRouteContext,
  ) {
    const readiness = this.readiness(landmark, activeLandmarks, goods, context);
    if (!readiness?.ready) return null;
    this.activeVoyage = Object.freeze({
      routeId: readiness.route.id,
      departedAt: absoluteHours,
      returnsAt: absoluteHours + readiness.route.durationHours,
    });
    return Object.freeze({ route: readiness.route, cargo: readiness.route.cargo, voyage: this.activeVoyage });
  }

  update(absoluteHours: number): ExpeditionReturn | null {
    if (!this.activeVoyage || absoluteHours < this.activeVoyage.returnsAt) return null;
    const route = EXPEDITION_BY_ID.get(this.activeVoyage.routeId);
    this.activeVoyage = undefined;
    if (!route) return null;
    this.completedRoutes.add(route.id);
    const keepsake = `expedition:${route.id}`;
    this.earnedKeepsakes.add(keepsake);
    return Object.freeze({ route, reward: this.rewardFor(route), keepsake });
  }

  rememberKeepsake(id: string) { this.earnedKeepsakes.add(id); }

  voyage() { return this.activeVoyage ? Object.freeze({ ...this.activeVoyage }) : undefined; }

  voyageProgress(absoluteHours: number) {
    if (!this.activeVoyage) return 0;
    return Math.max(0, Math.min(1, (absoluteHours - this.activeVoyage.departedAt) / (this.activeVoyage.returnsAt - this.activeVoyage.departedAt)));
  }

  keepsakes() { return Object.freeze([...this.earnedKeepsakes].sort()); }

  completed() { return Object.freeze([...this.completedRoutes].sort()); }

  serialize(): ExpeditionsSave {
    return {
      activeVoyage: this.activeVoyage ? { ...this.activeVoyage } : undefined,
      completedRoutes: [...this.completedRoutes],
      earnedKeepsakes: [...this.earnedKeepsakes],
    };
  }

  private rewardFor(route: ExpeditionDefinition) {
    return worldPack(this.packId).expeditionRewards[route.id] ?? route.result;
  }

  private cargoLabel(bundle: CargoBundle) {
    return Object.entries(bundle)
      .map(([good, amount]) => `${craftGoodLabel(good as CraftGood)} ${amount}`)
      .join(' and ');
  }
}
