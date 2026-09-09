import assert from 'node:assert/strict';
import { campaignGuidance, findCampaignWater } from '../src/campaign-guidance.ts';
import { CAMPAIGN_LESSONS, restoreCampaign } from '../src/campaign.ts';
import { detectFormations } from '../src/formations.ts';

const cell = (x, z, height) => ({ x, z, height, color: 0, placedAt: 0 });
const state = (completed) => ({ ...restoreCampaign(undefined, false), completed, started: true });
const buildable = (x, z) => Math.hypot(x, z) <= 8.8;
let checks = 0;
// Every suggested route must reach the real detector, even after a rotated, overbuilt start.
for (let index = 0; index < 18; index++) {
  for (const overbuilt of [false, true]) {
    const cells = new Map();
    let anchor = { x: -2, z: -2 };
    if (overbuilt) {
      CAMPAIGN_LESSONS[index].plan.forEach((row, z) => row.forEach((height, x) => {
        if (height) cells.set(`${-z + 2},${x - 2}`, cell(-z + 2, x - 2, Math.min(5, height + 1)));
      }));
    }
    let edits = 0;
    while (!detectFormations(cells).some(({ id }) => id === CAMPAIGN_LESSONS[index].id) && edits < 80) {
      const guide = campaignGuidance(state(index), cells, buildable, anchor);
      assert.ok(guide, 'every lesson has guidance');
      assert.ok(guide.markers.length <= 4, 'suggest no more than four actions');
      const next = guide.markers.find(({ action }) => action !== 'preserve');
      assert.ok(next, `${index}: incomplete shape needs an actionable correction`);
      assert.ok(buildable(next.x, next.z), 'never suggest deep water');
      const key = `${next.x},${next.z}`;
      const height = (cells.get(key)?.height ?? 0) + (next.action === 'lower' ? -1 : 1);
      if (!height) cells.delete(key);
      else cells.set(key, cell(next.x, next.z, height));
      anchor = guide.anchor;
      edits++;
    }
    assert.ok(edits < 80, `${CAMPAIGN_LESSONS[index].id}: guidance converges`);
    checks++;
  }
}
const one = new Map([['0,0', cell(0, 0, 1)]]);
const canal = campaignGuidance(state(0), one, buildable);
assert.equal(canal.markers.length, 4, 'first home offers four opposite positions');
assert.ok(canal.markers.every(({ x, z }) => Math.abs(x) + Math.abs(z) === 2));
assert.match(canal.correction, /one space of open water/);
const banks = new Map([['-1,0', cell(-1, 0, 2)], ['1,0', cell(1, 0, 1)]]);
const arch = campaignGuidance(state(1), banks, buildable);
assert.ok(arch.checklist.some((line) => line.includes('2 / 2')));
assert.ok(arch.checklist.some((line) => line.includes('1 / 2')));
assert.ok(arch.markers.some(({ x, z, action }) => x === 1 && z === 0 && action === 'raise'));
const crowded = new Map();
for (let z = -9; z <= 9; z++) for (let x = -9; x <= 9; x++) if (buildable(x, z)) crowded.set(`${x},${z}`, cell(x, z, 1));
assert.equal(findCampaignWater(crowded, buildable, { x: 0, z: 0 }), undefined, 'a full harbor has an honest recovery state');
assert.ok(findCampaignWater(one, buildable, { x: 0, z: 0 }), 'find open water without placing a home');
console.log(`Voyage guidance checks passed: ${checks} complete construction/recovery routes, markers, live banks, and crowded harbor.`);

// Walk the whole voyage in one harbor, preserving previous buildings between chapters.
const harbor = new Map();
let near = { x: 0, z: 0 };
for (let index = 0; index < 18; index++) {
  let fresh = [0, 5, 7, 10, 13, 16, 17].includes(index);
  let edits = 0;
  while (!detectFormations(harbor).some(({ id }) => id === CAMPAIGN_LESSONS[index].id) && edits < 100) {
    const guide = campaignGuidance(state(index), harbor, buildable, near, fresh);
    const next = guide.markers.find(({ action }) => action !== 'preserve');
    assert.ok(next, `${index}: persistent harbor has room for next lesson`);
    const key = `${next.x},${next.z}`;
    const height = (harbor.get(key)?.height ?? 0) + (next.action === 'lower' ? -1 : 1);
    if (height) harbor.set(key, cell(next.x, next.z, height)); else harbor.delete(key);
    near = guide.anchor;
    fresh = false;
    edits++;
  }
  assert.ok(edits < 100, `${CAMPAIGN_LESSONS[index].id}: persistent harbor converges`);
}
console.log(`All 18 lessons also fit in one persistent harbor (${harbor.size} homes).`);
