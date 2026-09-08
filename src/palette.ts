import * as THREE from 'three';

export type PaletteDefinition = Readonly<{
  id: string;
  title: string;
  order: number;
  /** Eight wall colours ordered by intended frequency. `Cell.color` indexes this list. */
  walls: readonly string[];
  roofs: readonly [string, string];
  trim: string;
  stone: string;
  water: string;
  sky: Readonly<{ zenith: string; horizon: string }>;
  shadow: string;
  haze: string;
  night?: boolean;
  rain?: boolean;
}>;

const paletteModules = import.meta.glob<PaletteDefinition>('./palettes/*.json', { eager: true, import: 'default' });

export const PALETTES: readonly PaletteDefinition[] = Object.values(paletteModules).sort((a, b) => a.order - b.order);
export const PALETTE_BY_ID = new Map(PALETTES.map((palette) => [palette.id, palette]));
export const DEFAULT_PALETTE_ID = PALETTES[0].id;

/** Slot layout of the palette lookup texture. Walls occupy slots 0 to 7. */
export const PALETTE_SLOT = {
  wall: 0,
  wallCount: 8,
  roof: 8,
  roofCount: 2,
  trim: 10,
  stone: 11,
  stoneDark: 12,
  water: 13,
  shadow: 14,
  haze: 15,
  skyZenith: 16,
  skyHorizon: 17,
} as const;
export const PALETTE_TEXTURE_WIDTH = 32;
export const PALETTE_BLEND_SECONDS = .8;

export function paletteSlotColors(definition: PaletteDefinition) {
  const colors = Array.from({ length: PALETTE_TEXTURE_WIDTH }, () => new THREE.Color(1, 1, 1));
  for (let index = 0; index < PALETTE_SLOT.wallCount; index++) {
    colors[PALETTE_SLOT.wall + index].set(definition.walls[index % definition.walls.length]);
  }
  colors[PALETTE_SLOT.roof].set(definition.roofs[0]);
  colors[PALETTE_SLOT.roof + 1].set(definition.roofs[1]);
  colors[PALETTE_SLOT.trim].set(definition.trim);
  colors[PALETTE_SLOT.stone].set(definition.stone);
  colors[PALETTE_SLOT.stoneDark].set(definition.stone).multiplyScalar(.62);
  colors[PALETTE_SLOT.water].set(definition.water);
  colors[PALETTE_SLOT.shadow].set(definition.shadow);
  colors[PALETTE_SLOT.haze].set(definition.haze);
  colors[PALETTE_SLOT.skyZenith].set(definition.sky.zenith);
  colors[PALETTE_SLOT.skyHorizon].set(definition.sky.horizon);
  return colors;
}

/**
 * Holds the active palette as a one-row float texture so materials look colours
 * up by slot, and blends every slot when the palette changes.
 */
export class PaletteSystem {
  readonly texture: THREE.DataTexture;
  readonly colors: readonly THREE.Color[];
  private from: readonly THREE.Color[];
  private to: readonly THREE.Color[];
  private blend = 1;
  private activeId: string;

  constructor(initialId = DEFAULT_PALETTE_ID) {
    const definition = PALETTE_BY_ID.get(initialId) ?? PALETTES[0];
    this.activeId = definition.id;
    this.from = paletteSlotColors(definition);
    this.to = this.from;
    this.colors = paletteSlotColors(definition);
    this.texture = new THREE.DataTexture(new Float32Array(PALETTE_TEXTURE_WIDTH * 4), PALETTE_TEXTURE_WIDTH, 1, THREE.RGBAFormat, THREE.FloatType);
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.writeTexture();
  }

  get id() { return this.activeId; }

  get definition() { return PALETTE_BY_ID.get(this.activeId) ?? PALETTES[0]; }

  get transitioning() { return this.blend < 1; }

  color(slot: number) { return this.colors[slot]; }

  set(id: string, immediate = false) {
    const definition = PALETTE_BY_ID.get(id);
    if (!definition || definition.id === this.activeId) return false;
    this.activeId = definition.id;
    this.from = this.colors.map((color) => color.clone());
    this.to = paletteSlotColors(definition);
    this.blend = immediate ? 1 : 0;
    if (immediate) {
      for (const [index, color] of this.colors.entries()) color.copy(this.to[index]);
      this.writeTexture();
    }
    return true;
  }

  next() {
    const index = PALETTES.findIndex((palette) => palette.id === this.activeId);
    const following = PALETTES[(index + 1) % PALETTES.length];
    this.set(following.id);
    return following;
  }

  /** Advances a running blend. Returns true when the colours changed this frame. */
  update(deltaSeconds: number) {
    if (this.blend >= 1) return false;
    this.blend = Math.min(1, this.blend + deltaSeconds / PALETTE_BLEND_SECONDS);
    const eased = this.blend * this.blend * (3 - 2 * this.blend);
    for (const [index, color] of this.colors.entries()) color.copy(this.from[index]).lerp(this.to[index], eased);
    this.writeTexture();
    return true;
  }

  private writeTexture() {
    const data = this.texture.image.data as Float32Array;
    for (const [index, color] of this.colors.entries()) {
      data[index * 4] = color.r;
      data[index * 4 + 1] = color.g;
      data[index * 4 + 2] = color.b;
      data[index * 4 + 3] = 1;
    }
    this.texture.needsUpdate = true;
  }
}
