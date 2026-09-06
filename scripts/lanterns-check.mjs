import assert from 'node:assert/strict';
import {
  HARBOR_LANTERNS,
  harborLanternStates,
  litHarborLanterns,
} from '../src/lanterns.ts';

assert.equal(HARBOR_LANTERNS.length, 5, 'the harbor promise has exactly five lanterns');
assert.equal(new Set(HARBOR_LANTERNS.map((lantern) => lantern.id)).size, 5, 'lantern ids are unique');
assert.equal(new Set(HARBOR_LANTERNS.map((lantern) => lantern.eventId)).size, 5, 'each lantern has its own milestone');

const waiting = harborLanternStates([]);
assert.ok(waiting.every((lantern) => lantern.state === 'waiting'), 'a new town begins with five waiting lanterns');

const stirring = harborLanternStates(['familiar-faces']);
assert.equal(stirring.find((lantern) => lantern.id === 'table')?.state, 'stirring', 'a friendship stirs the table lantern');
assert.equal(stirring.find((lantern) => lantern.id === 'blossom')?.state, 'waiting', 'unrelated lanterns remain waiting');

const discoveries = HARBOR_LANTERNS.map((lantern) => lantern.eventId);
assert.ok(harborLanternStates(discoveries).every((lantern) => lantern.state === 'lit'), 'all five milestone stories light the full set');
assert.equal(litHarborLanterns(discoveries).length, 5, 'lit-lantern count is derived from discoveries');

console.log('Harbor-lantern checks passed.');

