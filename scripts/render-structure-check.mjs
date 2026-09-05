import * as THREE from 'three';
import { createServer } from 'vite';

// City textures are produced with CanvasTexture. The structural test only
// needs the drawing surface contract; it does not create a WebGL renderer.
const gradient = { addColorStop() {} };
const context = {
  createRadialGradient() { return gradient; },
  fillRect() {},
  strokeRect() {},
  fillText() {},
  clearRect() {},
  set fillStyle(_value) {},
  set strokeStyle(_value) {},
  set lineWidth(_value) {},
  set font(_value) {},
  set textAlign(_value) {},
  set textBaseline(_value) {},
};
globalThis.document = {
  createElement() {
    return { width: 0, height: 0, getContext() { return context; } };
  },
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const { CityRenderer } = await server.ssrLoadModule('/src/city.ts');
  const { CitizenSystem } = await server.ssrLoadModule('/src/citizens.ts');
  const { HarborAmbience } = await server.ssrLoadModule('/src/harbor.ts');

  const seed = 42;
  const cells = [];
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) {
    if (Math.abs(x) + Math.abs(z) >= 4) continue;
    cells.push({
      x,
      z,
      height: 1 + Math.abs((x * 7 + z * 3) % 3),
      color: Math.abs(x * 5 + z) % 6,
      placedAt: 0,
      foundedAt: 0,
      renovatedAt: 0,
    });
  }

  const businessTypes = [
    'bakery', 'cafe', 'flower-shop', 'workshop', 'bookstore',
    'fishmonger', 'restaurant', 'tea-house', 'inn', 'pottery',
  ];
  const businesses = cells.slice(0, 10).map((cell, index) => ({
    id: `business-${index}`,
    type: businessTypes[index],
    cellKey: `${cell.x},${cell.z}`,
    ownerId: `citizen-${index}`,
    name: `Shop ${index}`,
    openedAt: 1,
    employeeIds: [],
    visitCount: 20,
  }));
  const citizens = Array.from({ length: 16 }, (_, index) => {
    const home = cells[index % cells.length];
    return {
      id: `citizen-${index}`,
      name: `Citizen ${index}`,
      homeKey: `${home.x},${home.z}`,
      position: [home.x, home.z],
      occupation: index % 3 === 0 ? 'Fisher' : 'Gardener',
      traits: ['curious'],
      relationships: [],
      color: index % 6,
      ageGroup: 'adult',
    };
  });
  const discoveries = [
    'lantern-finale', 'tower-bell', 'birds-nest', 'clock-tower',
    'rooftop-gardens', 'festival-ribbons', 'rare-tree', 'gulls-return',
    'silver-shoal', 'quay-crabs', 'harbor-cats', 'garden-butterflies',
    'blossom-tide', 'evening-chorus',
  ];

  const city = new CityRenderer(seed);
  city.load(cells, 240);
  city.setBusinesses(businesses);
  city.setDiscoveryState(discoveries);
  city.update(1, 240);
  const vegetationPlots = [...city.root.children].filter((group) => group.userData.vegetationPlotKind);
  if (!vegetationPlots.length) throw new Error('Exposed houses did not produce any deterministic vegetation plots.');
  if (!vegetationPlots.some((group) => group.userData.vegetationStage > 0)) throw new Error('Established vegetation plots did not advance with town time.');
  const architecturalTreeHabitats = [...city.root.children]
    .flatMap((group) => (group.userData.architecturalTrees ?? []).map((tree) => tree.habitat));
  if (!architecturalTreeHabitats.includes('rooftop')) throw new Error('Dense flat roofs did not produce compact rooftop trees.');
  if (city.signAtlas.tiles.size < businessTypes.length) throw new Error('The shared sign atlas did not receive every business sign.');
  const staticBatches = city.root.getObjectByName('town-static-batches').children;
  const vertexBatchMaterials = new Set();
  for (const batch of staticBatches) {
    if (!(batch instanceof THREE.Mesh) || Array.isArray(batch.material) || !batch.material.vertexColors) continue;
    if (!batch.geometry.getAttribute('color')) throw new Error('A vertex-colored town batch is missing its color attribute.');
    vertexBatchMaterials.add(batch.material.uuid);
  }
  if (vertexBatchMaterials.size < 3) throw new Error('Wall, roof, and accent vertex-color batches were not all created.');

  const cellMap = new Map(cells.map((cell) => [`${cell.x},${cell.z}`, cell]));
  const people = new CitizenSystem(seed, cellMap, citizens);
  people.setBusinesses(businesses);
  people.setDiscoveries(discoveries);
  people.update(.016, 12, 240, 1);

  const ambience = new HarborAmbience(seed, new THREE.PerspectiveCamera(), cells);
  ambience.setTown(cells, businesses, citizens, city.matureTreeAnchors(240));
  ambience.setDiscoveryState(discoveries);
  ambience.update(1, .8, 12, 240, 0, 0);

  const root = new THREE.Group();
  root.add(city.root, people.root, ambience.root);
  const byRoot = {};
  let drawGroups = 0;
  for (const section of root.children) {
    let sectionDraws = 0;
    section.traverse((object) => {
      let visible = object.visible;
      for (let parent = object.parent; parent && visible && parent !== root; parent = parent.parent) visible = visible && parent.visible;
      if (!visible || (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Points))) return;
      if (object instanceof THREE.InstancedMesh && object.count === 0) return;
      if (object instanceof THREE.Points && object.geometry.getAttribute('position')?.count === 0) return;
      sectionDraws += Array.isArray(object.material) ? object.material.length : 1;
    });
    byRoot[section.name] = sectionDraws;
    drawGroups += sectionDraws;
  }

  if (drawGroups > 100) throw new Error(`Full-feature scene has ${drawGroups} visible draw groups; budget is 100.`);

  const plazaCells = [
    [0, -1], [1, -1], [0, 2], [1, 2], [-1, 0], [-1, 1], [2, 0], [2, 1],
  ].map(([x, z]) => ({ x, z, height: 1, color: 0, placedAt: 0, foundedAt: 0, renovatedAt: 0 }));
  const plazaCity = new CityRenderer(seed);
  plazaCity.load(plazaCells, 240);
  const plazaTrees = [...plazaCity.root.children]
    .flatMap((group) => group.userData.architecturalTrees ?? [])
    .filter((tree) => tree.habitat === 'plaza');
  if (plazaTrees.length !== 2) throw new Error(`Harbor plaza produced ${plazaTrees.length} trees instead of 2.`);

  console.log(`Render-structure check passed: ${drawGroups} draw groups`, byRoot);
} finally {
  await server.close();
}
