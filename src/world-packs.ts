import { CLASSIC_HARBOR_PACK } from './world-packs/classic-harbor.ts';
import { TRADE_WIND_ISLES_PACK } from './world-packs/trade-wind-isles.ts';
import type { BusinessType, ExpeditionRouteId, WorldPackId } from './types.ts';

export type WorldPackDefinition = Readonly<{
  id: WorldPackId;
  title: string;
  description: string;
  placementNote: string;
  shoalColor: number;
  currentColor: number;
  rockColor: number;
  reefColor: number;
  stiltedShoals: boolean;
  prevailingWind: Readonly<{ x: number; z: number }>;
  vesselScheduleOffset: number;
  businessPresentation: Partial<Record<BusinessType, string>>;
  expeditionRewards: Partial<Record<ExpeditionRouteId, string>>;
}>;

export const WORLD_PACKS: readonly WorldPackDefinition[] = [CLASSIC_HARBOR_PACK, TRADE_WIND_ISLES_PACK];
export const WORLD_PACK_BY_ID = new Map(WORLD_PACKS.map((pack) => [pack.id, pack]));

export function worldPack(id: WorldPackId | undefined) {
  return WORLD_PACK_BY_ID.get(id ?? 'classic-harbor') ?? CLASSIC_HARBOR_PACK;
}

