import { CARDINALS, type BusinessSave, type BusinessType, type Cell, type CitizenSave, keyOf } from './types';
import { hash, pick } from './random';

type BusinessRecipe = {
  type: BusinessType;
  population: number;
  names: readonly string[];
  score: (citizen: CitizenSave, cell: Cell, cells: Map<string, Cell>) => number;
};

export type BusinessUpdate = {
  changed: boolean;
  opened: BusinessSave[];
  closed: BusinessSave[];
};

const RECIPES: readonly BusinessRecipe[] = [
  {
    type: 'bakery',
    population: 2,
    names: ['Morning Crumb', 'Red Awning Bakery', 'Moon Bun', 'Harbor Loaf'],
    score: (citizen) => traitScore(citizen, ['industrious', 'patient']) + occupationScore(citizen, ['Baker', 'Cook']),
  },
  {
    type: 'cafe',
    population: 3,
    names: ['Blue Cup', 'Three Sparrows', 'Tide & Tea', 'Window Seat'],
    score: (citizen) => traitScore(citizen, ['sociable', 'dreamy']) + occupationScore(citizen, ['Cook', 'Caretaker']),
  },
  {
    type: 'workshop',
    population: 4,
    names: ['Lantern & Plane', 'Little Brass Works', 'Green Door Workshop', 'Juniper Repairs'],
    score: (citizen) => traitScore(citizen, ['artistic', 'curious', 'industrious']) + occupationScore(citizen, ['Bookbinder', 'Cartographer']),
  },
  {
    type: 'fishmonger',
    population: 5,
    names: ['Silver Mackerel', 'Morning Catch', 'Two Nets', 'Salt & Scale'],
    score: (citizen, cell, cells) => traitScore(citizen, ['patient', 'adventurous']) + occupationScore(citizen, ['Fisher', 'Cook']) + waterEdges(cell, cells) * 1.4,
  },
  {
    type: 'inn',
    population: 7,
    names: ['Paper Moon Inn', 'Last Ferry House', 'The Quiet Lantern', 'Harbor Pillow'],
    score: (citizen, cell) => traitScore(citizen, ['sociable', 'patient', 'adventurous']) + occupationScore(citizen, ['Caretaker', 'Teacher']) + (cell.height >= 2 ? 3 : -5),
  },
];

function traitScore(citizen: CitizenSave, traits: string[]) {
  return traits.reduce((score, trait) => score + (citizen.traits.includes(trait) ? 2 : 0), 0);
}

function occupationScore(citizen: CitizenSave, occupations: string[]) {
  return occupations.includes(citizen.occupation) ? 5 : 0;
}

function waterEdges(cell: Cell, cells: Map<string, Cell>) {
  return CARDINALS.filter(([dx, dz]) => !cells.has(keyOf(cell.x + dx, cell.z + dz))).length;
}

export function businessOccupation(type: BusinessType) {
  return {
    bakery: 'Baker',
    cafe: 'Tea keeper',
    workshop: 'Artisan',
    fishmonger: 'Fishmonger',
    inn: 'Innkeeper',
  }[type];
}

export function businessLabel(type: BusinessType) {
  return type === 'cafe' ? 'café' : type;
}

export function isBusinessOpen(type: BusinessType, hour: number) {
  if (type === 'bakery') return hour >= 5.5 && hour < 15;
  if (type === 'cafe') return hour >= 8 && hour < 21;
  if (type === 'workshop') return hour >= 8.5 && hour < 18.5;
  if (type === 'fishmonger') return hour >= 5 && hour < 14;
  return hour >= 6 || hour < 1;
}

export class BusinessSystem {
  private readonly seed: number;
  private readonly businesses: BusinessSave[];
  private nextOpeningAt = 0;

  constructor(seed: number, saved: BusinessSave[]) {
    this.seed = seed;
    this.businesses = saved.map((business) => ({ ...business }));
  }

  maintain(citizens: CitizenSave[], cells: Map<string, Cell>): BusinessUpdate {
    const citizenIds = new Set(citizens.map((citizen) => citizen.id));
    const closed = this.businesses.filter((business) => {
      const cell = cells.get(business.cellKey);
      return !cell || waterEdges(cell, cells) === 0;
    });
    for (const business of closed) this.businesses.splice(this.businesses.indexOf(business), 1);

    const usedOwners = new Set(this.businesses.filter((business) => citizenIds.has(business.ownerId)).map((business) => business.ownerId));
    let changed = closed.length > 0;
    for (const business of this.businesses) {
      if (citizenIds.has(business.ownerId)) continue;
      const replacement = citizens.find((citizen) => citizen.homeKey === business.cellKey && !usedOwners.has(citizen.id))
        ?? citizens.find((citizen) => !usedOwners.has(citizen.id));
      if (!replacement) continue;
      business.ownerId = replacement.id;
      usedOwners.add(replacement.id);
      changed = true;
    }
    return { changed, opened: [], closed };
  }

  update(citizens: CitizenSave[], cells: Map<string, Cell>, absoluteHours: number): BusinessUpdate {
    const result = this.maintain(citizens, cells);
    if (this.nextOpeningAt === 0) this.nextOpeningAt = absoluteHours + .08;
    if (absoluteHours < this.nextOpeningAt) return result;
    this.nextOpeningAt = absoluteHours + .3;

    const recipe = RECIPES.find((candidate) =>
      citizens.length >= candidate.population && !this.businesses.some((business) => business.type === candidate.type),
    );
    if (!recipe) return result;

    const occupiedCells = new Set(this.businesses.map((business) => business.cellKey));
    const occupiedOwners = new Set(this.businesses.map((business) => business.ownerId));
    const candidates = citizens
      .filter((citizen) => cells.has(citizen.homeKey) && !occupiedCells.has(citizen.homeKey) && !occupiedOwners.has(citizen.id))
      .map((citizen) => ({ citizen, cell: cells.get(citizen.homeKey)! }))
      .filter(({ cell }) => recipe.type !== 'inn' || cell.height >= 2)
      .sort((a, b) => {
        const difference = recipe.score(b.citizen, b.cell, cells) - recipe.score(a.citizen, a.cell, cells);
        if (difference !== 0) return difference;
        return hash(this.seed, b.cell.x, b.cell.z, recipe.population * 31) - hash(this.seed, a.cell.x, a.cell.z, recipe.population * 31);
      });
    const chosen = candidates[0];
    if (!chosen) return result;

    const name = pick(recipe.names, hash(this.seed, chosen.cell.x, chosen.cell.z, 1200 + recipe.population));
    const business: BusinessSave = {
      id: `business-${recipe.type}-${chosen.cell.x}-${chosen.cell.z}`,
      type: recipe.type,
      cellKey: chosen.citizen.homeKey,
      ownerId: chosen.citizen.id,
      name,
      openedAt: absoluteHours,
    };
    this.businesses.push(business);
    return { changed: true, opened: [business], closed: result.closed };
  }

  all() { return this.businesses; }

  serialize() { return this.businesses.map((business) => ({ ...business })); }
}
