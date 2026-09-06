import assert from 'node:assert/strict';
import {
  HARBOR_LANTERNS,
  harborLanternStates,
  harborLanternsCompletedByEdit,
  litHarborLanterns,
} from '../src/lanterns.ts';

assert.equal(HARBOR_LANTERNS.length, 5, 'the harbor promise has exactly five lanterns');
assert.equal(new Set(HARBOR_LANTERNS.map((lantern) => lantern.id)).size, 5, 'lantern ids are unique');
const lanternConfluences = new Set(HARBOR_LANTERNS.flatMap((lantern) => lantern.confluenceIds));
assert.deepEqual(
  [...lanternConfluences].sort(),
  ['archive-tower', 'banner-guild', 'celestial-beacon', 'grand-exchange', 'house-of-hands', 'tide-sanctuary'],
  'the five lanterns deliberately use every non-finale Confluence',
);

const waiting = harborLanternStates({});
assert.ok(waiting.every((lantern) => lantern.state === 'waiting'), 'a new town begins with five waiting lanterns');

const stirring = harborLanternStates({ knownConfluences: ['house-of-hands'] });
assert.equal(stirring.find((lantern) => lantern.id === 'table')?.state, 'stirring', 'a remembered Confluence stirs its lantern');
assert.equal(stirring.find((lantern) => lantern.id === 'blossom')?.state, 'waiting', 'unrelated lanterns remain waiting');

const achieved = harborLanternStates({
  knownConfluences: lanternConfluences,
  activeConfluences: lanternConfluences,
});
assert.ok(achieved.every((lantern) => lantern.state === 'ready'), 'completing the six Confluence builds makes all five lanterns ready');
assert.equal(litHarborLanterns({ activeConfluences: lanternConfluences }).length, 0, 'readiness alone does not mutate saved lantern progress');

assert.deepEqual(
  harborLanternsCompletedByEdit([], lanternConfluences).map((lantern) => lantern.id),
  HARBOR_LANTERNS.map((lantern) => lantern.id),
  'a player edit that completes the Confluence requirements earns every matching lantern',
);
assert.deepEqual(
  harborLanternsCompletedByEdit(lanternConfluences, lanternConfluences),
  [],
  'an unchanged town cannot earn lanterns while it sits unattended',
);
assert.deepEqual(
  harborLanternsCompletedByEdit(
    ['tide-sanctuary'],
    ['tide-sanctuary', 'banner-guild'],
  ).map((lantern) => lantern.id),
  ['blossom'],
  'the Blossom Lantern lights when the edit completes its two-Confluence achievement',
);

const litIds = HARBOR_LANTERNS.map((lantern) => lantern.id);
assert.ok(harborLanternStates({
  knownConfluences: lanternConfluences,
  activeConfluences: lanternConfluences,
  litLanterns: litIds,
}).every((lantern) => lantern.state === 'lit'), 'claimed lanterns retain their light');
assert.equal(litHarborLanterns({ litLanterns: litIds }).length, 5, 'lit-lantern count comes from earned or claimed achievements');

console.log('Harbor-lantern checks passed.');
