import assert from 'node:assert/strict';
import {
  HARBOR_LANTERNS,
  harborLanternStates,
  litHarborLanterns,
} from '../src/lanterns.ts';

assert.equal(HARBOR_LANTERNS.length, 5, 'the harbor promise has exactly five lanterns');
assert.equal(new Set(HARBOR_LANTERNS.map((lantern) => lantern.id)).size, 5, 'lantern ids are unique');
assert.equal(new Set(HARBOR_LANTERNS.map((lantern) => lantern.eventId)).size, 5, 'each lantern has its own milestone');
const lanternConfluences = new Set(HARBOR_LANTERNS.flatMap((lantern) => lantern.confluenceIds));
assert.deepEqual(
  [...lanternConfluences].sort(),
  ['archive-tower', 'banner-guild', 'celestial-beacon', 'grand-exchange', 'house-of-hands', 'tide-sanctuary'],
  'the five lanterns deliberately use every non-finale Confluence',
);

const waiting = harborLanternStates({ discoveries: [] });
assert.ok(waiting.every((lantern) => lantern.state === 'waiting'), 'a new town begins with five waiting lanterns');

const stirring = harborLanternStates({ discoveries: ['familiar-faces'] });
assert.equal(stirring.find((lantern) => lantern.id === 'table')?.state, 'stirring', 'a friendship stirs the table lantern');
assert.equal(stirring.find((lantern) => lantern.id === 'blossom')?.state, 'waiting', 'unrelated lanterns remain waiting');

const discoveries = HARBOR_LANTERNS.map((lantern) => lantern.eventId);
const unattended = harborLanternStates({
  discoveries,
  knownConfluences: lanternConfluences,
  activeConfluences: lanternConfluences,
});
assert.ok(unattended.every((lantern) => lantern.state === 'ready'), 'elapsed simulation and completed stories cannot light a lantern without the player');
assert.equal(litHarborLanterns({ discoveries, activeConfluences: lanternConfluences }).length, 0, 'no lantern is lit before it is deliberately kindled');

const litIds = HARBOR_LANTERNS.map((lantern) => lantern.id);
assert.ok(harborLanternStates({
  discoveries,
  knownConfluences: lanternConfluences,
  activeConfluences: lanternConfluences,
  litLanterns: litIds,
}).every((lantern) => lantern.state === 'lit'), 'claimed lanterns retain their light');
assert.equal(litHarborLanterns({ discoveries, litLanterns: litIds }).length, 5, 'lit-lantern count comes from deliberate claims');

console.log('Harbor-lantern checks passed.');
