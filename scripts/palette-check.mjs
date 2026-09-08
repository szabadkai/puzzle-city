import { createServer } from 'vite';

// Palette check: every palette fills its slots, and automatic colouring never
// gives two cardinal neighbours the same wall colour.
globalThis.document = {
  createElement() {
    const gradient = { addColorStop() {} };
    const context = new Proxy({}, { get: (_, key) => key === 'createRadialGradient' ? () => gradient : () => {} , set: () => true });
    return { width: 0, height: 0, getContext() { return context; } };
  },
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { PALETTES, PALETTE_SLOT, paletteSlotColors } = await server.ssrLoadModule('/src/palette.ts');
  const { CityRenderer } = await server.ssrLoadModule('/src/city.ts');
  if (PALETTES.length < 5) throw new Error(`Expected at least 5 palettes, found ${PALETTES.length}.`);
  for (const palette of PALETTES) {
    if (palette.walls.length < 6 || palette.walls.length > 8) throw new Error(`${palette.id} needs 6 to 8 wall colours.`);
    const colors = paletteSlotColors(palette);
    for (const slot of [PALETTE_SLOT.trim, PALETTE_SLOT.stone, PALETTE_SLOT.water, PALETTE_SLOT.shadow, PALETTE_SLOT.haze, PALETTE_SLOT.skyZenith, PALETTE_SLOT.skyHorizon]) {
      if (colors[slot].r === 1 && colors[slot].g === 1 && colors[slot].b === 1) throw new Error(`${palette.id} left slot ${slot} unset.`);
    }
    const shadow = colors[PALETTE_SLOT.shadow];
    const chroma = Math.max(shadow.r, shadow.g, shadow.b) - Math.min(shadow.r, shadow.g, shadow.b);
    if (chroma < .02) throw new Error(`${palette.id} shadow tint is neutral grey.`);
  }
  let conflicts = 0;
  let placed = 0;
  for (const seed of [1, 42, 4242, 20260908]) {
    const city = new CityRenderer(seed);
    for (let x = -6; x <= 6; x++) for (let z = -6; z <= 6; z++) {
      if (Math.hypot(x, z) > 8.8) continue;
      city.place(x, z, 0);
      placed += 1;
    }
    for (const cell of city.cells.values()) {
      for (const [dx, dz] of [[1, 0], [0, 1]]) {
        const neighbour = city.get(cell.x + dx, cell.z + dz);
        if (neighbour && neighbour.color === cell.color) conflicts += 1;
      }
    }
  }
  if (conflicts > 0) throw new Error(`${conflicts} adjacent buildings share a wall colour.`);
  console.log(`Palette check passed: ${PALETTES.length} palettes, ${placed} placements without adjacent colour repeats.`);
} finally {
  await server.close();
}
