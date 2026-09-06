import type { BusinessSave, BusinessType, CraftGood, CraftingSave, CitizenSave } from './types';
import { FORMATION_BATCH_BONUS, type FormationOccurrence } from './formations.ts';
import { placeBusinessAffinity } from './place-identities.ts';

type Ingredient = Partial<Record<CraftGood, number>>;

type CraftRecipe = {
  id: string;
  producer?: BusinessType;
  profession?: string;
  /** This raw material can only enter town aboard a merchant vessel. */
  imported?: boolean;
  inputs: Ingredient;
  output: CraftGood;
  amount?: number;
  deliveryTo?: readonly BusinessType[];
  discoveries?: readonly string[];
  activeAt?: (hour: number) => boolean;
  milestone: string;
};

export type CraftDelivery = {
  good: CraftGood;
  amount: number;
  fromCellKey: string;
  toCellKey: string;
};

export type CraftArrival = {
  good: CraftGood;
  amount: number;
  atCellKey: string;
};

export type CraftingUpdate = {
  changed: boolean;
  delivery?: CraftDelivery;
  arrival?: CraftArrival;
  milestone?: string;
};

const CAPACITY = 12;
const PRODUCTION_INTERVAL = .32;

const RECIPES: readonly CraftRecipe[] = [
  {
    id: 'morning-catch', profession: 'Fisher', producer: 'fishmonger', inputs: {}, output: 'fish', amount: 2,
    deliveryTo: ['fishmonger'], discoveries: ['fishing-boat'], activeAt: (hour) => hour >= 5 && hour < 11,
    milestone: 'The first catch has travelled from boat to fishmonger.',
  },
  {
    id: 'garden-herbs', profession: 'Gardener', producer: 'flower-shop', inputs: {}, output: 'herbs',
    deliveryTo: ['tea-house', 'cafe', 'restaurant'], activeAt: (hour) => hour >= 7 && hour < 17,
    milestone: 'Fresh harbor herbs have entered the town’s kitchens.',
  },
  {
    id: 'grain-landing', imported: true, inputs: {}, output: 'grain', amount: 2, deliveryTo: ['mill'],
    discoveries: ['merchant-arrival'], activeAt: (hour) => hour >= 8 && hour < 17,
    milestone: 'The merchant boat has landed its first sacks of grain.',
  },
  {
    id: 'timber-landing', imported: true, inputs: {}, output: 'timber', amount: 2, deliveryTo: ['workshop', 'shipyard'],
    discoveries: ['merchant-arrival'], activeAt: (hour) => hour >= 8 && hour < 17,
    milestone: 'Straight harbor timber has been carried ashore.',
  },
  {
    id: 'clay-landing', imported: true, inputs: {}, output: 'clay', amount: 2, deliveryTo: ['pottery'],
    discoveries: ['merchant-arrival'], activeAt: (hour) => hour >= 8 && hour < 17,
    milestone: 'The pottery has received its first river clay.',
  },
  {
    id: 'fiber-landing', imported: true, inputs: {}, output: 'fiber', amount: 2, deliveryTo: ['weaver'],
    discoveries: ['merchant-arrival'], activeAt: (hour) => hour >= 8 && hour < 17,
    milestone: 'Bundles of fiber have arrived for the loom.',
  },
  {
    id: 'milled-flour', producer: 'mill', inputs: { grain: 2 }, output: 'flour', deliveryTo: ['bakery'],
    activeAt: (hour) => hour >= 5 && hour < 15,
    milestone: 'The mill has ground the harbor’s first flour.',
  },
  {
    id: 'baked-bread', producer: 'bakery', inputs: { flour: 1 }, output: 'bread', amount: 2,
    deliveryTo: ['cafe', 'inn', 'restaurant'], activeAt: (hour) => hour >= 5 && hour < 11,
    milestone: 'A loaf has completed the journey from grain sack to bakery window.',
  },
  {
    id: 'forged-tools', producer: 'workshop', inputs: { timber: 1 }, output: 'tools',
    deliveryTo: ['mill', 'pottery', 'shipyard'], activeAt: (hour) => hour >= 8 && hour < 18,
    milestone: 'The workshop has fitted the first set of working tools.',
  },
  {
    id: 'thrown-tableware', producer: 'pottery', inputs: { clay: 2, tools: 1 }, output: 'tableware', amount: 2,
    deliveryTo: ['tea-house', 'restaurant', 'inn'], activeAt: (hour) => hour >= 8 && hour < 18,
    milestone: 'The first local cups and bowls have left the kiln.',
  },
  {
    id: 'woven-cloth', producer: 'weaver', inputs: { fiber: 2 }, output: 'cloth', amount: 2,
    deliveryTo: ['inn', 'shipyard'], activeAt: (hour) => hour >= 8 && hour < 18,
    milestone: 'The loom has produced the town’s first bolt of cloth.',
  },
  {
    id: 'smoked-catch', producer: 'smokehouse', inputs: { fish: 2, timber: 1 }, output: 'smoked-fish', amount: 2,
    deliveryTo: ['inn', 'shipyard'], activeAt: (hour) => hour >= 7 && hour < 17,
    milestone: 'The morning catch can now keep through a long voyage.',
  },
  {
    id: 'tea-service', producer: 'tea-house', inputs: { herbs: 1, tableware: 1 }, output: 'tea', amount: 2,
    deliveryTo: ['cafe', 'inn'], activeAt: (hour) => hour >= 10 && hour < 20,
    milestone: 'Local herbs and local cups have become a proper tea service.',
  },
  {
    id: 'harbor-supper', producer: 'restaurant', inputs: { fish: 1, bread: 1, tableware: 1 }, output: 'supper', amount: 2,
    deliveryTo: ['inn'], activeAt: (hour) => hour >= 16 && hour < 22,
    milestone: 'Three trades have met at one table for the first harbor supper.',
  },
  {
    id: 'made-welcome', producer: 'inn', inputs: { bread: 1, tea: 1, cloth: 1 }, output: 'hospitality',
    deliveryTo: ['shipyard'], activeAt: (hour) => hour >= 17 || hour < 1,
    milestone: 'Bread, tea, and fresh linen have made the inn ready for distant guests.',
  },
  {
    id: 'fitted-fishing-gear', producer: 'shipyard', inputs: { timber: 2, cloth: 1, tools: 1 }, output: 'fishing-gear',
    deliveryTo: ['fishmonger'], activeAt: (hour) => hour >= 8 && hour < 18,
    milestone: 'The shipyard has fitted stronger spars, nets, and tackle.',
  },
  {
    id: 'harbor-export', producer: 'shipyard', inputs: { 'smoked-fish': 1, tableware: 1, cloth: 1, hospitality: 1 }, output: 'harbor-goods',
    discoveries: ['merchant-arrival'], activeAt: (hour) => hour >= 9 && hour < 18,
    milestone: 'The harbor has completed its first home-made export cargo.',
  },
] as const;

export function craftGoodLabel(good: CraftGood) {
  return good.replace('-', ' ');
}

export class CraftingSystem {
  private readonly goods: Partial<Record<CraftGood, number>>;
  private readonly completedRecipes: Set<string>;
  private lastProducedAt: number;
  private cursor: number;

  constructor(saved?: CraftingSave) {
    this.goods = { ...(saved?.goods ?? {}) };
    this.completedRecipes = new Set(saved?.completedRecipes ?? []);
    this.lastProducedAt = saved?.lastProducedAt ?? 0;
    this.cursor = saved?.cursor ?? 0;
  }

  update(
    businesses: readonly BusinessSave[],
    citizens: readonly CitizenSave[],
    discoveries: readonly string[],
    absoluteHours: number,
    formations: readonly FormationOccurrence[] = [],
    importSourceCellKey?: string,
  ): CraftingUpdate {
    if (absoluteHours - this.lastProducedAt < PRODUCTION_INTERVAL) return { changed: false };
    const hour = ((absoluteHours % 24) + 24) % 24;
    const discovered = new Set(discoveries);
    for (let offset = 0; offset < RECIPES.length; offset++) {
      const index = (this.cursor + offset) % RECIPES.length;
      const recipe = RECIPES[index];
      const producer = recipe.producer ? businesses.find((business) => business.type === recipe.producer) : undefined;
      const worker = recipe.profession ? citizens.find((citizen) => citizen.occupation === recipe.profession) : undefined;
      if (recipe.producer && !producer) continue;
      if (recipe.profession && !worker) continue;
      if (recipe.imported && !importSourceCellKey) continue;
      if (recipe.discoveries?.some((id) => !discovered.has(id))) continue;
      if (recipe.activeAt && !recipe.activeAt(hour)) continue;
      if ((this.goods[recipe.output] ?? 0) >= CAPACITY) continue;
      if (!this.hasIngredients(recipe.inputs)) continue;

      const baseAmount = recipe.amount ?? 1;
      const sourceKey = recipe.imported ? importSourceCellKey : worker?.homeKey ?? producer?.cellKey;
      const [sourceX, sourceZ] = sourceKey?.split(',').map(Number) ?? [];
      const affinity = producer && Number.isFinite(sourceX) && Number.isFinite(sourceZ)
        ? placeBusinessAffinity(producer.type, { x: sourceX!, z: sourceZ! }, formations)
        : { score: 0 };
      const amount = baseAmount + (affinity.identity ? 2 : affinity.score > 0 ? FORMATION_BATCH_BONUS : 0);

      this.consume(recipe.inputs);
      this.goods[recipe.output] = Math.min(CAPACITY, (this.goods[recipe.output] ?? 0) + amount);
      this.lastProducedAt = absoluteHours;
      this.cursor = (index + 1) % RECIPES.length;
      const first = !this.completedRecipes.has(recipe.id);
      this.completedRecipes.add(recipe.id);

      const destination = recipe.deliveryTo?.flatMap((type) => businesses.filter((business) => business.type === type))[0];
      const delivery = sourceKey && destination && sourceKey !== destination.cellKey
        ? { good: recipe.output, amount, fromCellKey: sourceKey, toCellKey: destination.cellKey }
        : undefined;
      const arrival = recipe.imported && sourceKey
        ? { good: recipe.output, amount, atCellKey: sourceKey }
        : undefined;
      const milestone = first
        ? `${recipe.milestone}${affinity.identity
          ? ` The ${affinity.identity.title.toLowerCase()} makes it a generous batch.`
          : affinity.formation ? ` The nearby ${affinity.formation.title.toLowerCase()} makes it a fuller batch.` : ''}`
        : undefined;
      return { changed: true, delivery, arrival, milestone };
    }
    // Do not spin on a blocked economy every frame. A quarter-hour retry keeps
    // newly supplied chains responsive without turning shortages into pressure.
    this.lastProducedAt = absoluteHours - PRODUCTION_INTERVAL + .08;
    return { changed: false };
  }

  private hasIngredients(inputs: Ingredient) {
    return Object.entries(inputs).every(([good, amount]) => (this.goods[good as CraftGood] ?? 0) >= (amount ?? 0));
  }

  private consume(inputs: Ingredient) {
    for (const [good, amount] of Object.entries(inputs)) {
      const typed = good as CraftGood;
      this.goods[typed] = Math.max(0, (this.goods[typed] ?? 0) - (amount ?? 0));
    }
  }

  summary() {
    return Object.entries(this.goods)
      .filter(([, amount]) => (amount ?? 0) > 0)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([good, amount]) => `${craftGoodLabel(good as CraftGood)} ${amount}`)
      .join(' · ');
  }

  businessStatus(type: BusinessType, cellKey?: string, formations: readonly FormationOccurrence[] = []) {
    const recipes = RECIPES.filter((recipe) => recipe.producer === type && Object.keys(recipe.inputs).length > 0);
    const visible = recipes.length ? recipes : RECIPES.filter((recipe) => recipe.producer === type);
    if (!visible.length) return null;
    const status = visible.map((recipe) => {
      const inputs = Object.keys(recipe.inputs).map((good) => craftGoodLabel(good as CraftGood));
      const chain = inputs.length ? `${inputs.join(' + ')} → ${craftGoodLabel(recipe.output)}` : `lands ${craftGoodLabel(recipe.output)}`;
      const waiting = Object.entries(recipe.inputs)
        .filter(([good, amount]) => (this.goods[good as CraftGood] ?? 0) < (amount ?? 0))
        .map(([good]) => craftGoodLabel(good as CraftGood));
      return waiting.length ? `${chain} · waiting for ${waiting.join(' and ')}` : `${chain} · ready`;
    }).join('. ');
    const [x, z] = cellKey?.split(',').map(Number) ?? [];
    const affinity = Number.isFinite(x) && Number.isFinite(z)
      ? placeBusinessAffinity(type, { x: x!, z: z! }, formations)
      : { score: 0 };
    if (affinity.identity) return `${status}. The ${affinity.identity.title.toLowerCase()} adds two extra items to each batch.`;
    if (affinity.formation) return `${status}. The nearby ${affinity.formation.title.toLowerCase()} adds one extra item to each batch.`;
    return status;
  }

  completedCount() { return this.completedRecipes.size; }

  recipeCount() { return RECIPES.length; }

  goodsSnapshot() { return { ...this.goods }; }

  shipHarborGoods(capacity = 4) {
    const shipped = Math.min(Math.max(0, capacity), this.goods['harbor-goods'] ?? 0);
    if (shipped > 0) this.goods['harbor-goods'] = (this.goods['harbor-goods'] ?? 0) - shipped;
    return shipped;
  }

  serialize(): CraftingSave {
    return {
      goods: { ...this.goods },
      completedRecipes: [...this.completedRecipes],
      lastProducedAt: this.lastProducedAt,
      cursor: this.cursor,
    };
  }
}
