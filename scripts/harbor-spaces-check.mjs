import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { HARBOR_SPACE_PLANS } from '../src/harbor-space-plans.ts';
import { analyzeHarborSpaces } from '../src/harbor-spaces.ts';
import { detectFormations, formationLineage, formationBusinessAffinity } from '../src/formations.ts';
import { SPACE_SIGNATURES } from '../src/harbor-space-signatures.ts';

const cell = (x, z, height = 1) => ({ x, z, height, color: 2, placedAt: 0, foundedAt: 0, renovatedAt: 0 });
const keyOf = ({ x, z }) => `${x},${z}`;
const fixture = (id, rotation = 0, height = 1) => {
  const rows = HARBOR_SPACE_PLANS[id], cells = new Map();
  rows.forEach((row, iz) => [...row].forEach((kind, ix) => {
    if (kind !== 'H') return;
    let x = ix - Math.floor(row.length / 2), z = iz - Math.floor(rows.length / 2);
    for (let turn = 0; turn < rotation; turn++) [x, z] = [-z, x];
    const value = cell(x, z, height); cells.set(keyOf(value), value);
  }));
  return cells;
};

for (const id of Object.keys(HARBOR_SPACE_PLANS)) for (let rotation = 0; rotation < 4; rotation++) for (const height of [1, 5]) {
  const cells = fixture(id, rotation, height), layout = analyzeHarborSpaces(cells);
  assert.equal(layout.spaces.length, 1, `${id}: exactly one shape at rotation ${rotation}`);
  assert.equal(layout.spaces[0].id, id, `${id}: topology, not height, chooses the tier`);
  assert.ok(detectFormations(cells).some((form) => form.id === id), `${id}: its Atlas plan is buildable`);
  assert.deepEqual(analyzeHarborSpaces(new Map([...cells].reverse())).spaces, layout.spaces, 'insertion order does not choose a different shape');
  for (const tile of layout.spaces[0].tiles) {
    assert.equal(layout.ground.has(keyOf(tile)), layout.spaces[0].kind === 'lane', 'water and pavement agree');
    assert.ok(!detectFormations(cells).some((form) => form.x === tile.x && form.z === tile.z && /canal|arch|bridge|gate|courtyard|cloister|plaza/.test(form.id)), 'reserved spaces cannot also become crossings or gardens');
  }
}
const haven = fixture('boat-haven');
assert.equal(analyzeHarborSpaces(haven).spaces[0].id, 'boat-haven');
haven.set('0,1', cell(0, 1)); // Close the one-space mouth of the six-row plan.
assert.equal(analyzeHarborSpaces(haven).spaces.length, 0, 'a sealed pool cannot remain a boat haven');
haven.delete('0,1');
assert.equal(analyzeHarborSpaces(haven).spaces[0].id, 'boat-haven', 'in-place edits invalidate the geometry cache');

const lane = fixture('through-lane');
lane.delete('-1,-1');
assert.equal(analyzeHarborSpaces(lane).spaces.length, 0, 'a lane leaking into open water reverts to water architecture');
const twoBanks = new Map([cell(-1, 0), cell(1, 0)].map((value) => [keyOf(value), value]));
assert.deepEqual(detectFormations(twoBanks).map(({ id }) => id), ['narrow-canal'], 'two facing homes still teach the original canal');
assert.deepEqual([...formationLineage(['boat-haven'])].sort(), ['boat-haven', 'sheltered-basin'], 'narrowing a small basin does not falsely earn a larger working basin');
assert.deepEqual([...formationLineage(['market-lanes'])].sort(), ['market-lanes', 'pocket-lane'], 'branching does not falsely earn a long through lane');
for (const [id, trade] of [['boat-haven', 'shipyard'], ['market-lanes', 'weaver']]) {
  const cells = fixture(id), forms = detectFormations(cells), space = analyzeHarborSpaces(cells).spaces[0];
  assert.ok(formationBusinessAffinity(trade, space.anchor, forms).score > 0, 'new formations support their neighborhood trades');
  assert.ok(space.tiles.every((point) => formationBusinessAffinity(trade, point, forms).score > 0), 'trade support follows the whole footprint, including its far end');
}

// Canvas is only needed for procedural texture construction in SSR checks.
const gradient = { addColorStop() {} };
const context = new Proxy({ createRadialGradient: () => gradient, createLinearGradient: () => gradient }, {
  get: (target, key) => target[key] ?? (() => {}), set: (target, key, value) => (target[key] = value, true),
});
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => context }) };
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { CityRenderer } = await server.ssrLoadModule('/src/city.ts');
  const { NavGraph } = await server.ssrLoadModule('/src/citizens.ts');
  const { analyzeWaterTopology, createDockNavigationPath } = await server.ssrLoadModule('/src/water.ts');
  const { CELL_SIZE, GROUND_WALK_Y } = await server.ssrLoadModule('/src/spatial.ts');
  for (const id of Object.keys(HARBOR_SPACE_PLANS)) {
    const cells = fixture(id), layout = analyzeHarborSpaces(cells), space = layout.spaces[0];
    const city = new CityRenderer(42); city.load([...cells.values()]);
    const nav = new NavGraph(cells, 42), water = analyzeWaterTopology(cells.values(), 42);
    assert.ok([...nav.formationPlaces.values()].includes(id), `${id}: residents can visit the named form`);
    const signaturePieces = [...city.pieces.values()].filter((piece) => piece.userData.spaceSignature);
   assert.equal(signaturePieces.length, 1, `${id}: the form has one named visual signature`);
   assert.equal(signaturePieces[0].userData.spaceSignature, SPACE_SIGNATURES[id], `${id}: its signature is the intended landmark`);
   assert.ok(signaturePieces[0].getObjectByName(`space-signature-${id}`), `${id}: its authored silhouette is in the rendered town`);
    const namedObjects = (name) => [...city.pieces.values()].filter((piece) => piece.getObjectByName(name));
    if (id === 'sheltered-basin')
      assert.ok(namedObjects('space-signature-sheltered-basin').length >= 2, 'the sheltered landing spans the full back bank');
    if (id === 'working-basin') {
      assert.ok(namedObjects('space-signature-working-basin').length >= 2, 'the working basin has twin derricks');
      assert.ok(namedObjects('basin-cargo-lighter').length >= 3, 'the working water contains loaded cargo lighters');
    }
    if (id === 'boat-haven')
      assert.ok(namedObjects('basin-moored-sampan').length >= 4, 'the haven visibly fills with moored canopy boats');
    for (const tile of space.tiles) {
      const piece = city.pieces.get(keyOf(tile));
      assert.equal(piece?.userData.harborSpace, id, `${id}: every part is rendered`);
      const center = [...nav.nodes.values()].find((node) => Math.abs(node.position.x - tile.x * CELL_SIZE) < .001 && Math.abs(node.position.z - tile.z * CELL_SIZE) < .001 && node.position.y === GROUND_WALK_Y);
      assert.equal(Boolean(center), space.kind === 'lane', `${id}: feet only get centers on real pavement`);
      if (space.kind === 'lane') assert.ok(!water.shoreline.some((edge) => keyOf(edge.water) === keyOf(tile)), 'boats cannot berth inside a lane');
    }
    if (space.kind === 'lane') {
      const nodes = space.tiles.map((tile) => [...nav.nodes.values()].find((node) => Math.abs(node.position.x - tile.x * CELL_SIZE) < .001 && Math.abs(node.position.z - tile.z * CELL_SIZE) < .001 && node.position.y === GROUND_WALK_Y));
      assert.ok(nav.canReach(nodes[0].key, nodes.at(-1).key), 'the lane has a continuous walking route');
      assert.ok([...nav.entrances.values()].some((entrance) => nav.canReach(entrance, nodes[0].key)), 'homes can reach the passage');
    } else {
      assert.ok(water.sheltered.some((point) => layout.byTile.has(keyOf(point))), 'the fleet recognizes sheltered basin water');
      assert.ok(nav.docks.length > 0, 'fishers can reach basin moorings');
    }
    const restored = new CityRenderer(42); restored.load(JSON.parse(JSON.stringify(city.serialize())));
    assert.deepEqual(analyzeHarborSpaces(restored.cells).spaces, layout.spaces, 'save round trips preserve shape recognition');
  }
  const basinCity = new CityRenderer(42); basinCity.load([...fixture('boat-haven').values()]);
  basinCity.place(0, 1);
  assert.ok(![...basinCity.pieces.values()].some((piece) => piece.userData.harborSpace === 'boat-haven'), 'closing the mouth removes distant basin meshes');
  basinCity.remove(0, 1);
  assert.ok([...basinCity.pieces.values()].some((piece) => piece.userData.harborSpace === 'boat-haven'), 'reopening the mouth restores basin meshes');
  const laneCity = new CityRenderer(42); laneCity.load([...fixture('through-lane').values()]);
  laneCity.remove(-1, -1);
  assert.ok(![...laneCity.pieces.values()].some((piece) => piece.userData.harborSpace === 'through-lane'), 'breaching one wall removes the whole dry route');
  laneCity.place(-1, -1);
  assert.ok([...laneCity.pieces.values()].some((piece) => piece.userData.harborSpace === 'through-lane'), 'repairing the wall restores the passage');

  const cells = fixture('through-lane');
  const dock = { land: { x: -1, z: -1 }, water: { x: 0, z: -1 }, direction: 1, dock: true };
  assert.equal(createDockNavigationPath(cells.values(), dock, 1).length, 0, 'a boat route cannot start through dry passage cells');
  console.log('Harbor-space checks passed: all six plans, rotations, heights, water/ground exclusivity, residents, trades, saves, and reversible distant rebuilds.');
} finally {
  await server.close();
}
