import type { WorldPackDefinition } from '../world-packs.ts';

export const CLASSIC_HARBOR_PACK: WorldPackDefinition = Object.freeze({
  id: 'classic-harbor',
  title: 'Classic Harbor',
  description: 'The familiar Little Tides harbor: stone quays, sheltered crossings, and foundations that settle directly in ordinary water.',
  placementNote: 'Shoals are pale but accept familiar foundations; deep currents remain open.',
  shoalColor: 0x83c9b7,
  currentColor: 0x286d78,
  rockColor: 0x8a8174,
  reefColor: 0x6fae94,
  stiltedShoals: false,
  prevailingWind: Object.freeze({ x: .35, z: .12 }),
  vesselScheduleOffset: 0,
  businessPresentation: {},
  expeditionRewards: {},
});

