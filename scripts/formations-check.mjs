import assert from 'node:assert/strict';
import {
  detectFormations,
  FORMATION_CATALOG,
  formationBusinessAffinity,
  formationLineage,
  formationOpeningPopulation,
  hasAdjacentHomes,
} from '../src/formations.ts';
import {
  detectPlaceIdentities,
  livingPlaceIntroductionReady,
  PLACE_IDENTITY_CATALOG,
  placeBusinessAffinity,
  placeIdentityProgress,
  placeLandmarkSocket,
  placeOpeningPopulation,
} from '../src/place-identities.ts';

const town = (entries) => new Map(entries.map(([x, z, height = 1]) => [
  `${x},${z}`,
  { x, z, height, color: 0, placedAt: 0 },
]));
const ids = (cells) => new Set(detectFormations(cells).map((formation) => formation.id));

assert.equal(new Set(FORMATION_CATALOG.map((formation) => formation.id)).size, 18, 'the atlas has 18 unique forms');

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

assert.equal(new Set(PLACE_IDENTITY_CATALOG.map((identity) => identity.id)).size, 6, 'the atlas has six unique living-place identities');
assert.equal(new Set(PLACE_IDENTITY_CATALOG.map((identity) => identity.landmark.effect)).size, 6, 'each landmark describes a distinct town behavior');
const identityPairs = [
  [{ id: 'narrow-canal', x: 0, z: 0 }, { id: 'arcade-row', x: 2, z: 0 }],
  [{ id: 'courtyard-garden', x: 10, z: 0 }, { id: 'stepped-terrace', x: 12, z: 0 }],
  [{ id: 'arcade-row', x: 20, z: 0 }, { id: 'stepped-terrace', x: 22, z: 0 }],
  [{ id: 'roof-promenade', x: 30, z: 0 }, { id: 'rooftop-court', x: 32, z: 0 }],
  [{ id: 'high-bridge', x: 40, z: 0 }, { id: 'lookout-tower', x: 43, z: 0 }],
  [{ id: 'harbor-plaza', x: 50, z: 0 }, { id: 'cloister-garden', x: 53, z: 0 }],
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
assert.equal(placeBusinessAffinity('fishmonger', { x: 1, z: 0 }, canalMarketForms).identity?.id, 'canal-market', 'a matching trade recognizes the higher-order place');
assert.equal(placeOpeningPopulation('fishmonger', 5, canalMarketForms), 2, 'a living place can bring a matching trade three residents earlier');
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
console.log('Formation-atlas checks passed.');
