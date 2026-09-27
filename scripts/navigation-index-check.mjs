import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { HARBOR_SPACE_PLANS } from '../src/harbor-space-plans.ts';

const server = await createServer({ server: { middlewareMode: true, hmr: false }, appType: 'custom', logLevel: 'error' });
try {
  const { NavGraph } = await server.ssrLoadModule('/src/citizens.ts');
  const { detectFormations, FORMATION_BY_ID } = await server.ssrLoadModule('/src/formations.ts');
  const { detectPlaceIdentities, placeLandmarkSocket } = await server.ssrLoadModule('/src/place-identities.ts');
  const { detectConfluences, confluenceLandmarkSocket } = await server.ssrLoadModule('/src/confluences.ts');
  const { CELL_SIZE: cellSize } = await server.ssrLoadModule('/src/spatial.ts');
  const cell = (x, z, height) => ({ x, z, height, color: 0, placedAt: 0 });
  const fixtures = [];
  for (const rows of Object.values(HARBOR_SPACE_PLANS)) for (const height of [1, 3, 5]) {
    const cells = [];
    rows.forEach((row, z) => [...row].forEach((kind, x) => {
      if (kind === 'H') cells.push(cell(x - Math.floor(row.length / 2), z - Math.floor(rows.length / 2), height));
    }));
    fixtures.push(cells);
  }
  // Separate islands, roof routes, and dense mixed topology exercise ties,
  // elevation preferences, multi-tile footprints, and component limits.
  fixtures.push([cell(-5, 0, 3), cell(-3, 0, 3), cell(3, 0, 1), cell(5, 0, 1)]);
  const dense = [];
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
    if (Math.hypot(x, z) < 8 && (x * x + z * z) % 4 !== 1) dense.push(cell(x, z, 1 + Math.abs(x * 7 + z * 3) % 5));
  }
  fixtures.push(dense);
  let checked = 0;
  for (const cells of fixtures) {
    const map = new Map(cells.map(value => [`${value.x},${value.z}`, value]));
    const graph = new NavGraph(map, 42);
    const nodes = [...graph.nodes.values()];
    const checkComponents = (points, radius, limit, elevated) => {
      const distance = node => Math.min(...points.map(point => Math.hypot(node.position.x - point.x * cellSize, node.position.z - point.z * cellSize)));
      const sorted = nodes.filter(node => distance(node) <= radius && (elevated === undefined || graph.rooftops.has(node.key) === elevated))
        .sort((a, b) => distance(a) - distance(b));
      const seen = new Set(), expected = [];
      for (const node of sorted) {
        const component = graph.componentByNode.get(node.key);
        if (!component || seen.has(component)) continue;
        seen.add(component); expected.push(node.key);
        if (expected.length === limit) break;
      }
      assert.deepEqual(graph.nearestComponentNodes(points, radius, limit, elevated).map(node => node.key), expected,
        'indexed destinations must match exhaustive distance ordering and component selection');
      checked++;
    };
    const checkLandmark = (x, z, elevated) => {
      const preferred = nodes.filter(node => graph.rooftops.has(node.key) === elevated);
      const expected = (preferred.length ? preferred : [...nodes]).sort((a, b) =>
        Math.hypot(a.position.x - x, a.position.z - z) - Math.hypot(b.position.x - x, b.position.z - z))[0];
      assert.equal(graph.nearestLandmarkNode(x, z, elevated)?.key, expected?.key, 'landmark targets and elevation fallback must remain unchanged');
      checked++;
    };
    const forms = detectFormations(map);
    for (const form of forms) {
      const family = FORMATION_BY_ID.get(form.id).family;
      checkComponents(form.footprint ?? [form], cellSize * 2.35, 4, family === 'rooftop' || family === 'terrace' || form.id === 'roof-promenade');
    }
    for (const place of detectPlaceIdentities(forms)) {
      checkComponents([place], cellSize * 2.8, 4);
      const landmark = placeLandmarkSocket(place);
      for (const elevated of [false, true]) checkLandmark(landmark.x * cellSize, landmark.z * cellSize, elevated);
    }
    for (const place of detectConfluences(forms)) {
      checkComponents([place], cellSize * 3.2, 5);
      const landmark = confluenceLandmarkSocket(place);
      for (const elevated of [false, true]) checkLandmark(landmark.x * cellSize, landmark.z * cellSize, elevated);
    }
  }
  console.log(`Navigation indexing matches exhaustive selection for ${checked} destinations across ${fixtures.length} towns.`);
} finally { await server.close(); }
