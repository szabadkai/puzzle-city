import { CARDINALS, type BusinessSave, type BusinessType, type Cell, type CitizenSave, keyOf } from './types';
import { hash, pick } from './random';
import {
  detectFormations,
  FORMATION_OPENING_ADVANCE,
  type FormationOccurrence,
} from './formations.ts';
import { placeBusinessAffinity, placeOpeningPopulation } from './place-identities.ts';

type BusinessRecipe = {
  type: BusinessType;
  population: number;
  names: readonly string[];
  score: (citizen: CitizenSave, cell: Cell, cells: Map<string, Cell>) => number;
  available?: (citizens: CitizenSave[], businesses: BusinessSave[]) => boolean;
  automatic?: boolean;
};

export type BusinessUpdate = {
  changed: boolean;
  opened: BusinessSave[];
  closed: BusinessSave[];
  hired: Array<{ business: BusinessSave; citizenId: string }>;
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
  {
    type: 'flower-shop',
    population: 8,
    names: ['Courtyard Flowers', 'Silver Stem', 'Petal & Twine', 'The Green Window'],
    score: (citizen, cell, cells) => traitScore(citizen, ['artistic', 'patient', 'dreamy']) + occupationScore(citizen, ['Gardener']) + nearbyCourtyardScore(cell, cells),
  },
  {
    type: 'bookstore',
    population: 9,
    names: ['Tidebound Books', 'Small Atlas', 'The Paper Gull', 'Blue Shelf'],
    score: (citizen) => traitScore(citizen, ['quiet', 'curious', 'dreamy']) + occupationScore(citizen, ['Teacher', 'Bookbinder', 'Cartographer']),
  },
  {
    type: 'restaurant',
    population: 10,
    names: ['Lantern Supper', 'Red Bowl', 'The Long Table', 'Salt & Steam'],
    score: (citizen, cell, cells) => traitScore(citizen, ['sociable', 'ambitious', 'industrious']) + occupationScore(citizen, ['Cook']) + waterEdges(cell, cells),
    available: (citizens, businesses) => citizens.some((citizen) => citizen.occupation === 'Fisher') && businesses.some((business) => business.type === 'fishmonger'),
    automatic: false,
  },
  {
    type: 'tea-house',
    population: 11,
    names: ['Quiet Kettle', 'Three Leaves', 'Cloud Tea House', 'The Last Cup'],
    score: (citizen, cell) => traitScore(citizen, ['patient', 'quiet', 'artistic']) + occupationScore(citizen, ['Tea keeper', 'Caretaker']) + (cell.height >= 2 ? 2 : 0),
  },
  {
    type: 'pottery',
    population: 12,
    names: ['Harbor Clay', 'Little Kiln', 'Blue Glaze', 'Wheel & Tide'],
    score: (citizen) => traitScore(citizen, ['artistic', 'patient', 'industrious']) + occupationScore(citizen, ['Artisan', 'Gardener']),
  },
  {
    type: 'mill',
    population: 13,
    names: ['Tidewheel Mill', 'White Sail Mill', 'Harbor Flour', 'The Little Millstone'],
    score: (citizen, cell, cells) => traitScore(citizen, ['patient', 'industrious']) + occupationScore(citizen, ['Baker', 'Gardener']) + waterEdges(cell, cells),
  },
  {
    type: 'smokehouse',
    population: 14,
    names: ['Cedar Smokehouse', 'Salt & Ember', 'Red Chimney', 'The Keeping Fire'],
    score: (citizen, cell, cells) => traitScore(citizen, ['patient', 'industrious']) + occupationScore(citizen, ['Fisher', 'Cook', 'Fishmonger']) + waterEdges(cell, cells) * 1.2,
    available: (citizens, businesses) => citizens.some((citizen) => citizen.occupation === 'Fisher') && businesses.some((business) => business.type === 'fishmonger'),
  },
  {
    type: 'weaver',
    population: 15,
    names: ['Blue Thread', 'Harbor Loom', 'The Woven Gull', 'Shuttle & Sail'],
    score: (citizen) => traitScore(citizen, ['artistic', 'patient', 'quiet']) + occupationScore(citizen, ['Bookbinder', 'Caretaker']),
  },
  {
    type: 'shipyard',
    population: 16,
    names: ['Red Keel Yard', 'Little Tides Shipwright', 'Spar & Peg', 'Harbor Bones'],
    score: (citizen, cell, cells) => traitScore(citizen, ['industrious', 'adventurous', 'patient']) + occupationScore(citizen, ['Artisan', 'Cartographer']) + waterEdges(cell, cells) * 1.8,
    available: (_citizens, businesses) => businesses.some((business) => business.type === 'workshop'),
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

function nearbyCourtyardScore(cell: Cell, cells: Map<string, Cell>) {
  let score = 0;
  for (let x = cell.x - 2; x <= cell.x + 2; x++) for (let z = cell.z - 2; z <= cell.z + 2; z++) {
    if (cells.has(keyOf(x, z))) continue;
    const neighbors = CARDINALS.filter(([dx, dz]) => cells.has(keyOf(x + dx, z + dz))).length;
    if (neighbors >= 3) score += 2;
  }
  return score;
}

export function businessOccupation(type: BusinessType) {
  return {
    bakery: 'Baker',
    cafe: 'Tea keeper',
    'flower-shop': 'Florist',
    workshop: 'Artisan',
    bookstore: 'Bookseller',
    fishmonger: 'Fishmonger',
    restaurant: 'Restaurateur',
    'tea-house': 'Tea master',
    inn: 'Innkeeper',
    pottery: 'Potter',
    mill: 'Miller',
    smokehouse: 'Smokehouse keeper',
    weaver: 'Weaver',
    shipyard: 'Shipwright',
  }[type];
}

export function businessLabel(type: BusinessType) {
  if (type === 'cafe') return 'café';
  return type.replace('-', ' ');
}

export function isBusinessOpen(type: BusinessType, hour: number) {
  if (type === 'bakery') return hour >= 5.5 && hour < 15;
  if (type === 'cafe') return hour >= 8 && hour < 21;
  if (type === 'flower-shop') return hour >= 8 && hour < 18;
  if (type === 'workshop') return hour >= 8.5 && hour < 18.5;
  if (type === 'bookstore') return hour >= 9 && hour < 20;
  if (type === 'fishmonger') return hour >= 5 && hour < 14;
  if (type === 'restaurant') return hour >= 11.5 && hour < 23;
  if (type === 'tea-house') return hour >= 10 && hour < 21.5;
  if (type === 'pottery') return hour >= 8 && hour < 18;
  if (type === 'mill') return hour >= 5 && hour < 15;
  if (type === 'smokehouse') return hour >= 7 && hour < 18;
  if (type === 'weaver') return hour >= 8 && hour < 18;
  if (type === 'shipyard') return hour >= 7 && hour < 19;
  return hour >= 6 || hour < 1;
}

export class BusinessSystem {
  private readonly seed: number;
  private readonly businesses: BusinessSave[];
  private nextOpeningAt = 0;

  constructor(seed: number, saved: BusinessSave[]) {
    this.seed = seed;
    this.businesses = saved.map((business) => ({
      ...business,
      employeeIds: [...(business.employeeIds ?? [])],
      visitCount: business.visitCount ?? 0,
    }));
  }

  maintain(citizens: CitizenSave[], cells: Map<string, Cell>): BusinessUpdate {
    const citizenIds = new Set(citizens.map((citizen) => citizen.id));
    const eligibleWorkers = citizens.filter((citizen) => citizen.ageGroup !== 'child' && citizen.residentKind !== 'visitor');
    const closed = this.businesses.filter((business) => {
      const cell = cells.get(business.cellKey);
      return !cell || waterEdges(cell, cells) === 0;
    });
    for (const business of closed) this.businesses.splice(this.businesses.indexOf(business), 1);

    const usedOwners = new Set(this.businesses.filter((business) => citizenIds.has(business.ownerId)).map((business) => business.ownerId));
    let changed = closed.length > 0;
    for (const business of this.businesses) {
      if (citizenIds.has(business.ownerId)) continue;
      const replacement = eligibleWorkers.find((citizen) => citizen.homeKey === business.cellKey && !usedOwners.has(citizen.id))
        ?? eligibleWorkers.find((citizen) => !usedOwners.has(citizen.id));
      if (!replacement) continue;
      business.ownerId = replacement.id;
      usedOwners.add(replacement.id);
      changed = true;
    }
    for (const business of this.businesses) {
      const employees = (business.employeeIds ?? []).filter((id) => citizenIds.has(id) && !usedOwners.has(id));
      if (employees.length !== (business.employeeIds?.length ?? 0)) changed = true;
      business.employeeIds = employees;
    }
    return { changed, opened: [], closed, hired: [] };
  }

  update(citizens: CitizenSave[], cells: Map<string, Cell>, absoluteHours: number): BusinessUpdate {
    const result = this.maintain(citizens, cells);
    if (this.nextOpeningAt === 0) this.nextOpeningAt = absoluteHours + .08;
    if (absoluteHours < this.nextOpeningAt) return result;
    this.nextOpeningAt = absoluteHours + .3;

    const formations = detectFormations(cells);
    const recipes = RECIPES.filter((candidate) =>
      citizens.length >= placeOpeningPopulation(candidate.type, candidate.population, formations)
      && candidate.automatic !== false
      && !this.businesses.some((business) => business.type === candidate.type)
      && (!candidate.available || candidate.available(citizens, this.businesses)),
    );
    if (!recipes.length) return result;

    for (const recipe of recipes) {
      const business = this.tryOpenRecipe(recipe, citizens, cells, absoluteHours, formations);
      if (business) return { changed: true, opened: [business], closed: result.closed, hired: result.hired };
    }
    return result;
  }

  openType(type: BusinessType, citizens: CitizenSave[], cells: Map<string, Cell>, absoluteHours: number): BusinessUpdate {
    const result = this.maintain(citizens, cells);
    if (this.businesses.some((business) => business.type === type)) return result;
    const recipe = RECIPES.find((candidate) => candidate.type === type);
    if (!recipe || (recipe.available && !recipe.available(citizens, this.businesses))) return result;
    const business = this.tryOpenRecipe(recipe, citizens, cells, absoluteHours, detectFormations(cells));
    return business
      ? { changed: true, opened: [business], closed: result.closed, hired: result.hired }
      : result;
  }

  private tryOpenRecipe(
    recipe: BusinessRecipe,
    citizens: CitizenSave[],
    cells: Map<string, Cell>,
    absoluteHours: number,
    formations: readonly FormationOccurrence[],
  ) {
    const occupiedCells = new Set(this.businesses.map((business) => business.cellKey));
    const occupiedOwners = new Set(this.businesses.map((business) => business.ownerId));
    const occupiedEmployees = new Set(this.businesses.flatMap((business) => business.employeeIds ?? []));
    const hasInn = this.businesses.some((business) => business.type === 'inn');
    const candidates = citizens
      .filter((citizen) => citizen.ageGroup !== 'child' && citizen.residentKind !== 'visitor')
      .filter((citizen) => citizen.occupation !== 'Fisher')
      .filter((citizen) => cells.has(citizen.homeKey) && !occupiedCells.has(citizen.homeKey) && !occupiedOwners.has(citizen.id))
      .map((citizen) => ({ citizen, cell: cells.get(citizen.homeKey)! }))
      .filter(({ cell }) => recipe.type !== 'inn' || cell.height >= 2)
      .filter(({ cell }) => {
        if (citizens.length >= recipe.population) return true;
        const affinity = placeBusinessAffinity(recipe.type, cell, formations);
        if (affinity.identity) return citizens.length >= Math.max(2, recipe.population - 3);
        if (affinity.formation) return citizens.length >= Math.max(2, recipe.population - FORMATION_OPENING_ADVANCE);
        return false;
      })
      .sort((a, b) => {
        const reserveA = !hasInn && recipe.type !== 'inn' && a.cell.height >= 2 ? -50 : 0;
        const reserveB = !hasInn && recipe.type !== 'inn' && b.cell.height >= 2 ? -50 : 0;
        const employeeA = occupiedEmployees.has(a.citizen.id) ? -20 : 0;
        const employeeB = occupiedEmployees.has(b.citizen.id) ? -20 : 0;
        const formationA = placeBusinessAffinity(recipe.type, a.cell, formations).score;
        const formationB = placeBusinessAffinity(recipe.type, b.cell, formations).score;
        const difference = recipe.score(b.citizen, b.cell, cells) + formationB + reserveB + employeeB
          - recipe.score(a.citizen, a.cell, cells) - formationA - reserveA - employeeA;
        if (difference !== 0) return difference;
        return hash(this.seed, b.cell.x, b.cell.z, recipe.population * 31) - hash(this.seed, a.cell.x, a.cell.z, recipe.population * 31);
      });
    const chosen = candidates[0];
    if (!chosen) return null;
    const placeAffinity = placeBusinessAffinity(recipe.type, chosen.cell, formations);
    const name = pick(recipe.names, hash(this.seed, chosen.cell.x, chosen.cell.z, 1200 + recipe.population));
    const business: BusinessSave = {
      id: `business-${recipe.type}-${chosen.cell.x}-${chosen.cell.z}`,
      type: recipe.type,
      cellKey: chosen.citizen.homeKey,
      ownerId: chosen.citizen.id,
      name,
      openedAt: absoluteHours,
      employeeIds: [],
      visitCount: 0,
      placeIdentityId: placeAffinity.identity?.id,
    };
    for (const existing of this.businesses) existing.employeeIds = (existing.employeeIds ?? []).filter((id) => id !== chosen.citizen.id);
    this.businesses.push(business);
    return business;
  }

  recordVisits(visits: Array<{ businessId: string; citizenId: string }>, citizens: CitizenSave[]): BusinessUpdate {
    if (!visits.length) return { changed: false, opened: [], closed: [], hired: [] };
    const citizenById = new Map(citizens.map((citizen) => [citizen.id, citizen]));
    const owned = new Set(this.businesses.map((business) => business.ownerId));
    const employed = new Set(this.businesses.flatMap((business) => business.employeeIds ?? []));
    const hired: Array<{ business: BusinessSave; citizenId: string }> = [];
    let changed = false;
    for (const visit of visits) {
      const business = this.businesses.find((candidate) => candidate.id === visit.businessId);
      const citizen = citizenById.get(visit.citizenId);
      if (!business || !citizen) continue;
      business.visitCount = (business.visitCount ?? 0) + 1;
      changed = true;
      if (citizen.residentKind === 'visitor') continue;
      if ((business.employeeIds?.length ?? 0) >= 1 || (business.visitCount ?? 0) < 7) continue;
      if (owned.has(citizen.id) || employed.has(citizen.id) || citizen.ageGroup === 'child') continue;
      const [shopX, shopZ] = business.cellKey.split(',').map(Number);
      const [homeX, homeZ] = citizen.homeKey.split(',').map(Number);
      if (Math.abs(shopX - homeX) + Math.abs(shopZ - homeZ) > 4) continue;
      business.employeeIds = [citizen.id];
      employed.add(citizen.id);
      hired.push({ business, citizenId: citizen.id });
    }
    return { changed, opened: [], closed: [], hired };
  }

  all() { return this.businesses; }

  serialize() {
    return this.businesses.map((business) => ({
      ...business,
      employeeIds: [...(business.employeeIds ?? [])],
    }));
  }
}
