import assert from 'node:assert/strict';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const {
    BusinessSystem,
    businessProsperityTier,
    townProsperityLevel,
  } = await server.ssrLoadModule('/src/businesses.ts');

const shop = {
  id: 'bakery-0',
  type: 'bakery',
  cellKey: '0,0',
  ownerId: 'citizen-0',
  name: 'Morning Crumb',
  openedAt: 1,
  employeeIds: [],
  visitCount: 0,
};
const owner = {
  id: 'citizen-0',
  name: 'Mei',
  homeKey: '0,0',
  position: [0, 0],
  occupation: 'Baker',
  traits: ['industrious'],
  relationships: [],
  color: 0,
  ageGroup: 'adult',
};
const cells = new Map([['0,0', {
  x: 0, z: 0, height: 1, color: 0, placedAt: 0, foundedAt: 0, renovatedAt: 0,
}]]);

const system = new BusinessSystem(42, [shop]);
system.recordVisits(Array.from({ length: 3 }, () => ({ businessId: shop.id, citizenId: owner.id })), [owner], 24);
assert.equal(businessProsperityTier(system.all()[0]), 1, 'three recent customers make a shop comfortable');

for (let index = 0; index < 3; index++) system.recordProduction(shop.id, 24 + index * .1);
assert.equal(businessProsperityTier(system.all()[0]), 2, 'customers and repeated production make a shop flourish');

const flourishingTown = [
  { ...shop, prosperityTier: 2 },
  { ...shop, id: 'cafe-1', type: 'cafe', prosperityTier: 2 },
  { ...shop, id: 'books-2', type: 'bookstore', prosperityTier: 1 },
  { ...shop, id: 'flowers-3', type: 'flower-shop', prosperityTier: 1 },
];
assert.equal(townProsperityLevel(flourishingTown), 2, 'several successful shops make market day eligible');

system.update([owner], cells, 264);
assert.equal(businessProsperityTier(system.all()[0]), 0, 'prosperity fades after several quiet days');

  console.log('Prosperity checks passed.');
} finally {
  await server.close();
}
