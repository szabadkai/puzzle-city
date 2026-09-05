import { hash } from './random.ts';

export type MemoryMetric = 'patinaCells' | 'matureTrees' | 'catPopulation' | 'oldestBuildingHours' | 'rainIntensity';

export type TownMemorySnapshot = Readonly<{
  patinaCells: number;
  growingTrees: number;
  matureTrees: number;
  oldestTreeHours: number;
  oldestBuildingHours: number;
  catPopulation: number;
  catCapacity: number;
  kittenCount: number;
  migratingCats: number;
  rainIntensity: number;
  raining: boolean;
}>;

export type WeatherState = Readonly<{
  raining: boolean;
  intensity: number;
  dayIndex: number;
  startsAt: number;
  endsAt: number;
}>;

export type CatColonyState = Readonly<{
  population: number;
  kittens: number;
  capacity: number;
}>;

export const TREE_MATURE_HOURS = 72;
export const KITTEN_INTERVAL_HOURS = 48;
export const KITTEN_GROWTH_HOURS = 48;

export function ageInHours(bornAt: number | undefined, absoluteHours: number) {
  return bornAt === undefined ? 0 : Math.max(0, absoluteHours - bornAt);
}

export function treeGrowthAt(bornAt: number | undefined, absoluteHours: number) {
  const age = ageInHours(bornAt, absoluteHours);
  const linear = Math.min(1, age / TREE_MATURE_HOURS);
  return linear * linear * (3 - 2 * linear);
}

export function catColonyAt(foundedAt: number | undefined, absoluteHours: number, capacity: number): CatColonyState {
  const boundedCapacity = Math.max(0, Math.floor(capacity));
  if (foundedAt === undefined || boundedCapacity === 0) return { population: 0, kittens: 0, capacity: boundedCapacity };
  const age = ageInHours(foundedAt, absoluteHours);
  const population = Math.min(boundedCapacity, 3 + Math.floor(age / KITTEN_INTERVAL_HOURS));
  let kittens = 0;
  for (let index = 3; index < population; index++) {
    const bornAt = (index - 2) * KITTEN_INTERVAL_HOURS;
    if (age - bornAt < KITTEN_GROWTH_HOURS) kittens += 1;
  }
  return { population, kittens, capacity: boundedCapacity };
}

export function weatherAt(seed: number, absoluteHours: number): WeatherState {
  const dayIndex = Math.floor(absoluteHours / 24);
  const localHour = ((absoluteHours % 24) + 24) % 24;
  const hasRain = hash(seed, dayIndex, 0, 8800) > .56;
  const startsAt = 7 + hash(seed, dayIndex, 1, 8801) * 10;
  const duration = 2.5 + hash(seed, dayIndex, 2, 8802) * 3.5;
  const endsAt = Math.min(23, startsAt + duration);
  if (!hasRain || localHour < startsAt || localHour >= endsAt) return { raining: false, intensity: 0, dayIndex, startsAt, endsAt };
  const phase = (localHour - startsAt) / Math.max(.01, endsAt - startsAt);
  const intensity = Math.sin(phase * Math.PI) * (.55 + hash(seed, dayIndex, 3, 8803) * .45);
  return { raining: intensity > .03, intensity, dayIndex, startsAt, endsAt };
}

export function describeAge(hours: number) {
  if (hours < 1) return 'newly made';
  if (hours < 24) return `${Math.max(1, Math.floor(hours))} simulated hours old`;
  const days = Math.floor(hours / 24);
  return `${days} simulated ${days === 1 ? 'day' : 'days'} old`;
}
