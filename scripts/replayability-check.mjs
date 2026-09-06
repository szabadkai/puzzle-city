import assert from 'node:assert/strict';
import {
  checkHarborFeasibility,
  classicHarborProfile,
  generateHarborProfile,
  isFoundationPosition,
} from '../src/harbor-constraints.ts';
import { offeredTownPromises } from '../src/town-promises.ts';
import { ExpeditionSystem } from '../src/expeditions.ts';

const archetypes = new Set();
const serialized = new Set();
for (const packId of ['classic-harbor', 'trade-wind-isles']) {
  for (let seed = 1; seed <= 128; seed++) {
    const profile = generateHarborProfile(seed * 7919, packId);
    const replay = generateHarborProfile(seed * 7919, packId);
    assert.deepEqual(replay, profile, 'same seed, pack, and generator version must replay exactly');
    const feasibility = checkHarborFeasibility(profile);
    assert.equal(feasibility.valid, true, `${packId}/${seed} must be feasible: ${feasibility.reasons.join(', ')}`);
    assert.ok(feasibility.largestConnectedArea >= 12, 'twelve connected foundations must remain');
    assert.ok(feasibility.formationFamilies.length >= 4, 'multiple formation families must remain possible');
    assert.equal(isFoundationPosition(profile, profile.firstTide.x, profile.firstTide.z), true, 'First Tide marker must be buildable');
    assert.ok(profile.constraints.some((cell) => cell.type === 'deep-current'), 'generated harbors must visibly constrain foundations');
    assert.equal(offeredTownPromises(seed, profile).length, 3, 'each harbor must offer three promises');
    archetypes.add(profile.archetype);
    serialized.add(JSON.stringify(profile));
  }
}
assert.equal(archetypes.size, 4, 'all four harbor archetypes should be reachable');
assert.ok(serialized.size > 200, 'different seeds and packs should preserve visibly distinct explicit profiles');

const classic = classicHarborProfile();
assert.equal(classic.constraints.length, 0, 'legacy towns must migrate to the unconstrained Classic Harbor');
assert.equal(isFoundationPosition(classic, 0, 0), true);

const cargo = {
  'harbor-goods': 1, hospitality: 2, herbs: 2, cloth: 2, tools: 2, tableware: 3,
  'fishing-gear': 1, tea: 1,
};
const routes = { docks: 1, shelteredWater: 1, deepPassages: 8 };
const landmarks = new Set(['market-barge', 'seed-house', 'guild-kiln', 'signal-beacon', 'lantern-theatre', 'roof-hall']);
const expeditions = new ExpeditionSystem('classic-harbor');
assert.equal(expeditions.readiness('market-barge', new Set(), cargo, routes)?.ready, false, 'landmark is required');
assert.equal(expeditions.readiness('market-barge', landmarks, {}, routes)?.ready, false, 'crafted cargo is required');
const departure = expeditions.confirmDeparture('market-barge', 24, landmarks, cargo, routes);
assert.ok(departure, 'ready route should depart after confirmation');
assert.equal(expeditions.update(35.9), null, 'voyage must not return before simulated duration');
assert.ok(expeditions.update(36), 'voyage should return deterministically at its saved simulated time');
assert.ok(expeditions.completed().includes('market-exchange'));
assert.ok(expeditions.keepsakes().includes('expedition:market-exchange'));

console.log(`Replayability checks passed: ${serialized.size} explicit profiles across ${archetypes.size} archetypes.`);

