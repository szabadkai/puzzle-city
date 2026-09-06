import type { WorldPackDefinition } from '../world-packs.ts';

export const TRADE_WIND_ISLES_PACK: WorldPackDefinition = Object.freeze({
  id: 'trade-wind-isles',
  title: 'Trade-Wind Isles',
  description: 'A reef-edged pilot shaped by shallow shelves, narrow blue passages, raised foundations, rain-catching courts, and a steady easterly breeze.',
  placementNote: 'Reef shoals accept stilted foundations. Deep passages must remain open for vessels, so crossings matter early.',
  shoalColor: 0x58cbbd,
  currentColor: 0x17658a,
  rockColor: 0x8d806b,
  reefColor: 0xd7ba79,
  stiltedShoals: true,
  prevailingWind: Object.freeze({ x: -.86, z: .28 }),
  vesselScheduleOffset: -.75,
  businessPresentation: {
    cafe: 'breeze-side café',
    'flower-shop': 'courtyard nursery',
    fishmonger: 'reef fish stall',
    inn: 'veranda guesthouse',
    restaurant: 'courtyard kitchen',
    shipyard: 'shallow-draft boatyard',
    'tea-house': 'herbal refreshment room',
    weaver: 'awning and sail loft',
  },
  expeditionRewards: {
    'market-exchange': 'painted visiting sloop',
    'seed-voyage': 'salt-tolerant flowering vine',
    'kiln-commission': 'pierced clay breeze screen',
    'beacon-survey': 'reef-passage chart',
    'theatre-visit': 'traveling courtyard players',
    'roof-messenger': 'bright rooftop kite-message',
  },
});
