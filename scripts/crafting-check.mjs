import assert from 'node:assert/strict';
import { CraftingSystem } from '../src/crafting.ts';

const types = [
  'bakery', 'cafe', 'flower-shop', 'workshop', 'bookstore',
  'fishmonger', 'restaurant', 'tea-house', 'inn', 'pottery',
  'mill', 'smokehouse', 'weaver', 'shipyard',
];
const businesses = types.map((type, index) => ({
  id: `business-${type}`,
  type,
  cellKey: `${index},0`,
  ownerId: `owner-${index}`,
  name: type,
  openedAt: 0,
  employeeIds: [],
  visitCount: 0,
}));
const citizens = [
  {
    id: 'fisher', name: 'Fisher', homeKey: '20,0', position: [20, 0], occupation: 'Fisher',
    traits: ['patient'], relationships: [], color: 0, ageGroup: 'adult',
  },
  {
    id: 'gardener', name: 'Gardener', homeKey: '21,0', position: [21, 0], occupation: 'Gardener',
    traits: ['patient'], relationships: [], color: 1, ageGroup: 'adult',
  },
];
const discoveries = ['fishing-boat', 'merchant-arrival'];
const crafting = new CraftingSystem();

let deliveries = 0;
for (let hours = 0; hours < 24 * 40; hours += .34) {
  const update = crafting.update(businesses, citizens, discoveries, hours);
  if (update.delivery) deliveries += 1;
}

assert.equal(crafting.completedCount(), crafting.recipeCount(), 'every connected recipe eventually completes');
assert.ok(deliveries > 20, 'production creates a visible stream of deliveries');
assert.match(crafting.summary(), /harbor goods/, 'the final export good is produced');

const restored = new CraftingSystem(crafting.serialize());
assert.equal(restored.completedCount(), crafting.completedCount(), 'crafting milestones survive save/load');
assert.equal(restored.summary(), crafting.summary(), 'goods survive save/load');

console.log('Crafting-chain checks passed.');
