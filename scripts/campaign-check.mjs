import assert from 'node:assert/strict';
import { advanceCampaign, CAMPAIGN_LESSONS, currentLesson, observeCampaign, replayCampaign, restoreCampaign } from '../src/campaign.ts';
import { detectFormations, FORMATION_CATALOG } from '../src/formations.ts';

const fresh = () => ({ ...restoreCampaign(undefined, false), started: true });
const occurrences = (lesson) => {
  const cells = new Map();
  lesson.plan.forEach((row, z) => row.forEach((height, x) => {
    if (height) cells.set(`${x},${z}`, { x, z, height, color: 0, placedAt: 0 });
  }));
  return detectFormations(cells);
};

assert.deepEqual(new Set(CAMPAIGN_LESSONS.map(({ id }) => id)), new Set(FORMATION_CATALOG.filter(({ family }) => family !== 'basin' && family !== 'lane').map(({ id }) => id)), 'Voyage teaches the original forms; basin and lane families extend free discovery');
assert.equal(new Set(CAMPAIGN_LESSONS.map(({ chapter }) => chapter)).size, 6);
let state = fresh();
assert.equal(state.mode, 'campaign');
assert.equal(state.sandboxUnlocked, false);
assert.equal(advanceCampaign(state), state, 'cannot skip an unfinished lesson');
assert.equal(observeCampaign(state, [{ id: 'lantern-gate', x: 0, z: 0 }]), state, 'higher-tier lineage does not skip the first lesson');
assert.equal(observeCampaign(state, []), state, 'waiting does not earn progression');

for (const lesson of CAMPAIGN_LESSONS) {
  assert.equal(currentLesson(state).id, lesson.id);
  const forms = occurrences(lesson);
  assert.ok(forms.some(({ id }) => id === lesson.id), `${lesson.id}: the displayed building plan must produce the actual formation`);
  state = observeCampaign(state, forms);
  assert.equal(state.ready, true);
  assert.equal(state.sandboxUnlocked, false, 'sandbox stays locked until the final explicit completion');
  assert.equal(observeCampaign(state, []), state, 'reshaping a completed objective does not erase its credit');
  state = restoreCampaign(JSON.parse(JSON.stringify(state)), false);
  assert.equal(state.ready, true, 'reload preserves an unclaimed completion');
  state = advanceCampaign(state);
  assert.equal(state.ready, false, 'each lesson needs its own completion');
}
assert.equal(state.completed, 18);
assert.equal(state.sandboxUnlocked, true);
assert.equal(currentLesson(state), undefined);
assert.equal(advanceCampaign(state), state, 'completion is idempotent');
assert.equal(observeCampaign(state, occurrences(CAMPAIGN_LESSONS[0])), state);
assert.equal(restoreCampaign(undefined, state.sandboxUnlocked).mode, 'sandbox', 'new tides retain the permanent reward');
assert.equal(restoreCampaign(state, false).sandboxUnlocked, true, 'postcards carry campaign completion');

assert.equal(restoreCampaign(undefined, false).mode, 'campaign', 'missing Voyage state starts fresh');
for (const invalid of [null, 'bad', {}, { version: 1, completed: -1 }, { version: 1, completed: 100 }, { version: 1, completed: 1.5 }]) {
  assert.equal(restoreCampaign(invalid, false).completed, 0);
}
assert.equal(restoreCampaign({ version: 1, mode: 'sandbox', completed: 0 }, false).mode, 'campaign', 'a locked save cannot switch into sandbox');
console.log('Campaign checks passed: 18 buildable lessons, sequential progress, persistence, replay, and sandbox unlock.');

const earlyShape = { id: 'sea-arch', x: 2, z: 0 };
let early = advanceCampaign({ ...fresh(), ready: true }, [earlyShape]);
assert.equal(observeCampaign(early, [earlyShape]).ready, false, 'existing future discovery cannot auto-advance');
early = observeCampaign(early, []);
assert.equal(observeCampaign(early, [earlyShape]).ready, true, 'rebuilding a future discovery earns the lesson');
const replay = replayCampaign(state);
assert.equal(replay.completed, 0);
assert.equal(replay.earned, 18, 'replay keeps previously earned stamps');
assert.equal(replay.sandboxUnlocked, true, 'replay never revokes sandbox');
assert.equal(restoreCampaign({ ...replay, expanded: false, planExpanded: false }, true).expanded, false);
assert.equal(observeCampaign(restoreCampaign(undefined, false), occurrences(CAMPAIGN_LESSONS[0])).ready, false, 'welcome does not award a lesson before starting');
