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
  const update = crafting.update(businesses, citizens, discoveries, hours, [], '-2,0');
  if (update.delivery) deliveries += 1;
}

assert.equal(crafting.completedCount(), crafting.recipeCount(), 'every connected recipe eventually completes');
assert.ok(deliveries > 20, 'production creates a visible stream of deliveries');
assert.match(crafting.summary(), /harbor goods/, 'the final export good is produced');

const restored = new CraftingSystem(crafting.serialize());
assert.equal(restored.completedCount(), crafting.completedCount(), 'crafting milestones survive save/load');
assert.equal(restored.summary(), crafting.summary(), 'goods survive save/load');
const exportStock = restored.goodsSnapshot()['harbor-goods'] ?? 0;
const shipped = restored.shipHarborGoods(4);
assert.equal(shipped, Math.min(4, exportStock), 'a departing merchant takes only the export cargo it can carry');
assert.equal(restored.goodsSnapshot()['harbor-goods'], exportStock - shipped, 'shipped harbor goods leave the town stock');

const docklessImports = new CraftingSystem();
const docklessUpdate = docklessImports.update(businesses, [], ['merchant-arrival'], 8, []);
assert.equal(docklessUpdate.changed, false, 'merchant materials cannot appear without a working import dock');
assert.equal(docklessImports.serialize().goods.grain, undefined, 'dockless towns do not conjure imported grain at an inn');

const docksideImports = new CraftingSystem();
const docksideUpdate = docksideImports.update(businesses, [], ['merchant-arrival'], 8, [], '-2,0');
assert.equal(docksideUpdate.arrival?.good, 'grain', 'a working dock receives the first merchant material');
assert.equal(docksideUpdate.arrival?.atCellKey, '-2,0', 'the arrival records its real shoreline storage cell');
assert.equal(docksideUpdate.delivery?.fromCellKey, '-2,0', 'the onward carrier starts at dockside storage');

const fishmonger = [{
  id: 'business-fishmonger', type: 'fishmonger', cellKey: '-1,0', ownerId: 'fishmonger-owner',
  name: 'Morning Catch', openedAt: 0, employeeIds: [], visitCount: 0,
}];
const fisher = [{
  id: 'formation-fisher', name: 'Fisher', homeKey: '-1,0', position: [-1, 0], occupation: 'Fisher',
  traits: ['patient'], relationships: [], color: 0, ageGroup: 'adult',
}];
const ordinaryCatch = new CraftingSystem();
ordinaryCatch.update(fishmonger, fisher, ['fishing-boat'], 30);
const canalCatch = new CraftingSystem();
canalCatch.update(fishmonger, fisher, ['fishing-boat'], 30, [{ id: 'narrow-canal', x: 0, z: 0 }]);
const marketCatch = new CraftingSystem();
const canalMarket = [{ id: 'narrow-canal', x: 0, z: 0 }, { id: 'arcade-row', x: 2, z: 0 }];
marketCatch.update(fishmonger, fisher, ['fishing-boat'], 30, canalMarket);
assert.equal(ordinaryCatch.serialize().goods.fish, 2, 'an ordinary morning catch keeps its base yield');
assert.equal(canalCatch.serialize().goods.fish, 3, 'a well-placed fishmonger gains a fuller formation-supported batch');
assert.equal(marketCatch.serialize().goods.fish, 4, 'a fishmonger in a canal market gains a generous living-place batch');
assert.match(
  canalCatch.businessStatus('fishmonger', '-1,0', [{ id: 'narrow-canal', x: 0, z: 0 }]),
  /adds one extra item/,
  'Observe mode explains a formation-supported workplace bonus',
);
assert.match(
  marketCatch.businessStatus('fishmonger', '-1,0', canalMarket),
  /adds two extra items/,
  'Observe mode explains a living-place workplace bonus',
);

console.log('Crafting-chain checks passed.');
