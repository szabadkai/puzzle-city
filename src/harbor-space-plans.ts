import type { FormationId } from './types.ts';

/** H = one-storey home, ~ = keep water, = = keep passage, g = dry court.
 * Empty spaces are derived from homes; there is no new placement tool. */
export const HARBOR_SPACE_PLANS: Partial<Record<FormationId, readonly string[]>> = {
  'sheltered-basin': ['HHHH', 'H~~H', 'H~~H', 'H~~H', ' ~~ '],
  'working-basin': ['HHHHH', 'H~~~H', 'H~~~H', 'H~~~H', ' ~~~ '],
  'boat-haven': ['HHHHH', 'H~~~H', 'H~~~H', 'H~~~H', 'HH~HH', '  ~  '],
  'pocket-lane': [' H ', 'HgH', 'H=H', 'H=H', 'HgH', ' H '],
  'through-lane': [' H ', 'HgH', 'H=H', 'H=H', 'H=H', 'H=H', 'HgH', ' H '],
  'market-lanes': ['   H   ', '  HgH  ', ' HH=HH ', 'Hg===gH', ' HH=HH ', '  HgH  ', '   H   '],
};

export function harborSpacePlanSketch(id: FormationId) {
  const rows = HARBOR_SPACE_PLANS[id];
  if (!rows) return '';
  const size = Math.min(10, 62 / rows.length), left = (108 - rows[0].length * size) / 2;
  return rows.flatMap((row, z) => [...row].map((kind, x) => {
    const px = left + x * size, pz = 5 + z * size;
    if (kind === ' ') return '';
    if (kind === 'H') return `<rect fill="rgba(148,119,78,.09)" x="${px}" y="${pz}" width="${size - 1}" height="${size - 1}" rx="1"/><path d="M${px + 2} ${pz + size * .55}l${size * .25} -2l${size * .25} 2"/>`;
    if (kind === 'g') return `<circle class="wash botanical" cx="${px + size / 2}" cy="${pz + size / 2}" r="${size * .32}"/>`;
    if (kind === '~') return `<rect class="wash water" x="${px}" y="${pz}" width="${size}" height="${size}"/><path class="faint" d="M${px + 1} ${pz + size / 2}q2 -2 4 0t4 0"/>`;
    return `<rect class="wash warm" x="${px}" y="${pz}" width="${size}" height="${size}"/><circle cx="${px + size / 2}" cy="${pz + size / 2}" r=".6"/>`;
  })).join('');
}
