import assert from 'node:assert/strict';
import {
  detectFormations,
  FORMATION_BATCH_BONUS,
  FORMATION_CATALOG,
  FORMATION_OPENING_ADVANCE,
  formationBusinessAffinity,
  formationGatheringActivity,
  formationInfluenceDetails,
  formationInfluenceSummary,
  formationLineage,
  formationOpeningPopulation,
  hasAdjacentHomes,
} from '../src/formations.ts';
import {
  detectPlaceIdentities,
  livingPlaceIntroductionReady,
  PLACE_IDENTITY_CATALOG,
  placeBusinessAffinity,
  placeInfluenceAt,
  placeIdentityProgress,
  placeLandmarkSocket,
  placeOpeningPopulation,
} from '../src/place-identities.ts';
import {
  CONFLUENCE_CATALOG,
  confluenceProgress,
  confluenceSupersedesPlace,
  detectConfluences,
} from '../src/confluences.ts';

const town = (entries) => new Map(entries.map(([x, z, height = 1]) => [
  `${x},${z}`,
  { x, z, height, color: 0, placedAt: 0 },
]));
const ids = (cells) => new Set(detectFormations(cells).map((formation) => formation.id));

assert.equal(new Set(FORMATION_CATALOG.map((formation) => formation.id)).size, 18, 'the atlas has 18 unique forms');
assert.equal(new Set(FORMATION_CATALOG.map((formation) => formation.socialEffect)).size, 18, 'each formation describes a distinct resident draw');
assert.equal(
  new Set(FORMATION_CATALOG.map((formation) => formationGatheringActivity(formation.id))).size,
  18,
  'residents name a distinct activity at every formation',
);
assert.ok(
  FORMATION_CATALOG.every((formation) => formationInfluenceDetails(formation).businesses.length > 0),
  'every formation names its favored trades',
);
assert.match(
  formationInfluenceSummary(FORMATION_CATALOG[0]),
  new RegExp(`${FORMATION_OPENING_ADVANCE} residents earlier.*\\+${FORMATION_BATCH_BONUS} item per batch`),
  'formation effects state their concrete opening and production benefits',
);

const canal = town([[-1, 0], [1, 0]]);
assert.ok(ids(canal).has('narrow-canal'), 'opposing one-storey banks form a narrow canal');
assert.equal(hasAdjacentHomes(canal), false, 'opposing canal banks are not adjacent homes');
const canalForms = detectFormations(canal);
assert.ok(formationBusinessAffinity('fishmonger', { x: -1, z: 0 }, canalForms).score > 0, 'water trades prefer canal-side homes');
assert.equal(formationBusinessAffinity('cafe', { x: -1, z: 0 }, canalForms).score, 0, 'unrelated trades receive no canal bonus');
assert.equal(formationOpeningPopulation('fishmonger', 5, canalForms), 3, 'a suitable formation can bring a trade two residents earlier');

const arch = town([[-1, 0, 2], [1, 0, 2]]);
assert.ok(ids(arch).has('sea-arch'), 'opposing two-storey banks form a sea arch');
assert.deepEqual(
  [...formationLineage(['covered-skybridge'])].sort(),
  ['covered-skybridge', 'high-bridge', 'narrow-canal', 'sea-arch'],
  'later crossing forms remember the forms needed to reach them',
);

const arcade = town([[-1, 0, 2], [0, 0, 2], [1, 0, 2]]);
assert.ok(ids(arcade).has('arcade-row'), 'a straight two-storey run forms an arcade');
assert.ok(hasAdjacentHomes(arcade), 'a street run contains adjacent homes');
assert.ok(formationBusinessAffinity('cafe', { x: 0, z: 0 }, detectFormations(arcade)).score > 0, 'cafés prefer an arcade row');

const roofCourt = town([[0, 0, 2], [1, 0, 2], [0, 1, 2], [1, 1, 2]]);
assert.ok(ids(roofCourt).has('rooftop-court'), 'an equal two-by-two roof block forms one shared court');
assert.equal(detectFormations(roofCourt).filter((formation) => formation.id === 'rooftop-court').length, 1, 'a shared court is recorded once');

const courtyard = town([[0, -1], [1, 0], [0, 1]]);
assert.ok(ids(courtyard).has('courtyard-garden'), 'three surrounding walls form a courtyard garden');

const plaza = town([[0, -1], [1, -1], [0, 2], [1, 2], [-1, 0], [-1, 1]]);
assert.ok(ids(plaza).has('harbor-plaza'), 'six buildings around a two-by-two opening form a plaza');

const tower = town([[0, 0, 3]]);
assert.ok(ids(tower).has('lookout-tower'), 'an isolated three-storey home forms a lookout tower');

assert.equal(new Set(PLACE_IDENTITY_CATALOG.map((identity) => identity.id)).size, 14, 'the atlas has fourteen unique living-place identities');
assert.equal(new Set(PLACE_IDENTITY_CATALOG.map((identity) => identity.landmark.effect)).size, 14, 'each landmark describes a distinct town behavior');
assert.equal(new Set(PLACE_IDENTITY_CATALOG.map((identity) => identity.trace)).size, 14, 'each living place spreads a distinct visual language');
const identityPairs = [
  [{ id: 'narrow-canal', x: 0, z: 0 }, { id: 'arcade-row', x: 2, z: 0 }],
  [{ id: 'courtyard-garden', x: 10, z: 0 }, { id: 'stepped-terrace', x: 12, z: 0 }],
  [{ id: 'arcade-row', x: 20, z: 0 }, { id: 'stepped-terrace', x: 22, z: 0 }],
  [{ id: 'roof-promenade', x: 30, z: 0 }, { id: 'rooftop-court', x: 32, z: 0 }],
  [{ id: 'high-bridge', x: 40, z: 0 }, { id: 'lookout-tower', x: 43, z: 0 }],
  [{ id: 'harbor-plaza', x: 50, z: 0 }, { id: 'cloister-garden', x: 53, z: 0 }],
  [{ id: 'narrow-canal', x: 60, z: 0 }, { id: 'harbor-plaza', x: 63, z: 0 }],
  [{ id: 'sea-arch', x: 70, z: 0 }, { id: 'cloister-garden', x: 72, z: 0 }],
  [{ id: 'arcade-row', x: 80, z: 0 }, { id: 'courtyard-garden', x: 82, z: 0 }],
  [{ id: 'terraced-garden', x: 90, z: 0 }, { id: 'rooftop-pavilion', x: 92, z: 0 }],
  [{ id: 'lantern-stair', x: 100, z: 0 }, { id: 'harbor-plaza', x: 103, z: 0 }],
  [{ id: 'arcade-row', x: 110, z: 0 }, { id: 'lookout-tower', x: 113, z: 0 }],
  [{ id: 'hanging-roof-garden', x: 120, z: 0 }, { id: 'lookout-tower', x: 123, z: 0 }],
  [{ id: 'stepped-terrace', x: 130, z: 0 }, { id: 'rooftop-court', x: 132, z: 0 }],
];
const allIdentityForms = identityPairs.flat();
assert.deepEqual(
  new Set(detectPlaceIdentities(allIdentityForms).map((identity) => identity.id)),
  new Set(PLACE_IDENTITY_CATALOG.map((identity) => identity.id)),
  'each catalog identity emerges from the intended nearby formation pair',
);
const canalMarketForms = identityPairs[0];
assert.equal(placeIdentityProgress('canal-market', []).state, 'missing', 'a living-place clue begins with both formations missing');
assert.equal(placeIdentityProgress('canal-market', [canalMarketForms[0]]).state, 'one-form', 'a living-place clue recognizes its first formation');
assert.equal(placeIdentityProgress('canal-market', [
  { id: 'narrow-canal', x: 0, z: 0 },
  { id: 'arcade-row', x: 8, z: 0 },
]).state, 'distant', 'a living-place clue distinguishes two distant forms from a completed place');
assert.equal(placeIdentityProgress('canal-market', canalMarketForms).state, 'active', 'a living-place clue completes only when both formations meet');
assert.equal(detectPlaceIdentities([
  { id: 'narrow-canal', x: 0, z: 0 },
  { id: 'arcade-row', x: 8, z: 0 },
]).length, 0, 'compatible forms do not combine when they are too far apart');
assert.equal(detectPlaceIdentities([
  { id: 'narrow-canal', x: 0, z: 0 },
  { id: 'arcade-row', x: 3, z: 0 },
]).length, 0, 'ordinary living places no longer emerge from formations merely sharing a district');
assert.deepEqual(
  detectPlaceIdentities([{ id: 'narrow-canal', x: 0, z: 0 }, { id: 'harbor-plaza', x: 2, z: 0 }]).map((place) => place.id),
  ['ferry-quarter'],
  'a water crossing and plaza form a Ferry Quarter without also creating a Canal Market',
);
assert.equal(placeIdentityProgress('star-garden', [{ id: 'hanging-roof-garden', x: 0, z: 0 }]).state, 'one-form', 'specific high-tier recipes surface from either required form');
assert.equal(placeBusinessAffinity('fishmonger', { x: 1, z: 0 }, canalMarketForms).identity?.id, 'canal-market', 'a matching trade recognizes the higher-order place');
assert.equal(placeOpeningPopulation('fishmonger', 5, canalMarketForms), 2, 'a living place can bring a matching trade three residents earlier');
assert.equal(placeInfluenceAt({ x: 4, z: 0 }, canalMarketForms)?.definition.id, 'canal-market', 'a living place reaches nearby buildings from its landmark');
assert.equal(placeInfluenceAt({ x: 7, z: 0 }, canalMarketForms), undefined, 'a living-place influence remains local');
assert.equal(placeInfluenceAt({ x: 21, z: 0 }, allIdentityForms)?.definition.id, 'makers-walk', 'the nearest landmark owns the visual language where influences overlap');
const detectedPlaces = detectPlaceIdentities(allIdentityForms);
assert.deepEqual(
  new Set(detectedPlaces.map((place) => placeLandmarkSocket(place).kind)),
  new Set(PLACE_IDENTITY_CATALOG.map((identity) => identity.landmark.kind)),
  'each living place resolves an exclusive signature landmark socket',
);
const twoWaterForms = new Set(['narrow-canal', 'sea-arch']);
const threeKnownForms = new Set(['narrow-canal', 'sea-arch', 'arcade-row']);
assert.equal(livingPlaceIntroductionReady(twoWaterForms, canalMarketForms, 4), false, 'Second Tide does not interrupt the first two-form lesson');
assert.equal(livingPlaceIntroductionReady(threeKnownForms, [{ id: 'sea-arch', x: 0, z: 0 }], 4), false, 'Second Tide waits for two active formation families');
assert.equal(livingPlaceIntroductionReady(threeKnownForms, canalMarketForms, 2), false, 'Second Tide waits until the town has enough residents to demonstrate a living place');
assert.equal(livingPlaceIntroductionReady(threeKnownForms, canalMarketForms, 3), true, 'Second Tide arrives after three known forms, two active families, and three residents');

assert.equal(new Set(CONFLUENCE_CATALOG.map((confluence) => confluence.id)).size, 7, 'the hidden atlas has seven unique confluences');
assert.equal(new Set(CONFLUENCE_CATALOG.map((confluence) => confluence.landmark.kind)).size, 7, 'every confluence has an exclusive grand landmark');
assert.equal(new Set(CONFLUENCE_CATALOG.map((confluence) => confluence.landmark.effect)).size, 7, 'every confluence describes a distinct civic behavior');
const confluenceTriples = [
  [{ id: 'narrow-canal', x: 0, z: 0 }, { id: 'arcade-row', x: 2, z: 0 }, { id: 'harbor-plaza', x: 1, z: 2 }],
  [{ id: 'sea-arch', x: 20, z: 0 }, { id: 'cloister-garden', x: 22, z: 0 }, { id: 'terraced-garden', x: 21, z: 2 }],
  [{ id: 'arcade-row', x: 40, z: 0 }, { id: 'courtyard-garden', x: 42, z: 0 }, { id: 'stepped-terrace', x: 41, z: 2 }],
  [{ id: 'lantern-stair', x: 60, z: 0 }, { id: 'harbor-plaza', x: 62, z: 0 }, { id: 'rooftop-pavilion', x: 61, z: 2 }],
  [{ id: 'high-bridge', x: 80, z: 0 }, { id: 'lookout-tower', x: 82, z: 0 }, { id: 'hanging-roof-garden', x: 81, z: 2 }],
  [{ id: 'arcade-row', x: 100, z: 0 }, { id: 'terraced-garden', x: 102, z: 0 }, { id: 'rooftop-pavilion', x: 101, z: 2 }],
  [{ id: 'arcade-row', x: 120, z: 0 }, { id: 'courtyard-garden', x: 122, z: 0 }, { id: 'lookout-tower', x: 121, z: 2 }],
];
assert.deepEqual(
  new Set(detectConfluences(confluenceTriples.flat()).map((confluence) => confluence.id)),
  new Set(CONFLUENCE_CATALOG.map((confluence) => confluence.id)),
  'each confluence emerges from its intended three-formation recipe',
);
const chainedExchange = [
  { id: 'narrow-canal', x: 0, z: 0 },
  { id: 'arcade-row', x: 4, z: 0 },
  { id: 'harbor-plaza', x: 8, z: 0 },
];
assert.equal(detectConfluences(chainedExchange).length, 0, 'a confluence requires every pair to be close, not merely a connected chain');
assert.equal(detectConfluences([
  { id: 'narrow-canal', x: 0, z: 0 },
  { id: 'arcade-row', x: 3, z: 0 },
  { id: 'harbor-plaza', x: 1, z: 3 },
]).length, 0, 'a district-scale triangle does not accidentally become a confluence');
assert.equal(confluenceProgress('grand-exchange', chainedExchange).state, 'distant', 'the confluence clue distinguishes three distant forms from a completed cluster');
assert.equal(confluenceProgress('grand-exchange', confluenceTriples[0]).state, 'active', 'the confluence clue completes when all three forms converge');
const grandExchange = detectConfluences(confluenceTriples[0])[0];
const componentPlaces = detectPlaceIdentities(confluenceTriples[0]);
assert.ok(componentPlaces.length >= 2 && componentPlaces.every((place) => confluenceSupersedesPlace(grandExchange, place)), 'the grand exchange supersedes only its exact component landmarks');
console.log('Formation-atlas checks passed.');
