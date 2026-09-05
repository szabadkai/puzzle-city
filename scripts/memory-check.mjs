import assert from 'node:assert/strict';
import {
  KITTEN_INTERVAL_HOURS,
  TREE_MATURE_HOURS,
  ageInHours,
  catColonyAt,
  treeGrowthAt,
  weatherAt,
} from '../src/memory.ts';

assert.equal(ageInHours(20, 10), 0, 'ages never run backward');
assert.equal(treeGrowthAt(10, 10), 0, 'a new tree starts young');
assert.equal(treeGrowthAt(10, 10 + TREE_MATURE_HOURS), 1, 'a tree matures on schedule');

assert.deepEqual(catColonyAt(undefined, 100, 8), { population: 0, kittens: 0, capacity: 8 });
assert.equal(catColonyAt(10, 10, 8).population, 3, 'a colony begins with three founders');
assert.equal(catColonyAt(10, 10 + KITTEN_INTERVAL_HOURS, 8).population, 4, 'the first kitten arrives after two days');
assert.equal(catColonyAt(10, 10 + KITTEN_INTERVAL_HOURS, 8).kittens, 1, 'new arrivals begin as kittens');
assert.equal(catColonyAt(10, 1000, 5).population, 5, 'habitat capacity bounds the family');

let sawRain = false;
let sawDry = false;
for (let day = 0; day < 20; day++) {
  for (let hour = 0; hour < 24; hour += .25) {
    const absoluteHours = day * 24 + hour;
    const first = weatherAt(2048, absoluteHours);
    const second = weatherAt(2048, absoluteHours);
    assert.deepEqual(first, second, 'weather is deterministic');
    assert.ok(first.intensity >= 0 && first.intensity <= 1, 'rain intensity stays normalized');
    sawRain ||= first.raining;
    sawDry ||= !first.raining;
  }
}
assert.ok(sawRain && sawDry, 'the weather schedule contains both rain and clear periods');

console.log('Town-memory checks passed.');
