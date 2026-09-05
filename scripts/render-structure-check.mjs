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
  const { CitizenSystem, NavGraph } = await server.ssrLoadModule('/src/citizens.ts');
  const { HarborAmbience } = await server.ssrLoadModule('/src/harbor.ts');
  const { hash } = await server.ssrLoadModule('/src/random.ts');
  const { hasWaterStairs } = await server.ssrLoadModule('/src/water.ts');
  const { walkableSteppedTerrace } = await server.ssrLoadModule('/src/architecture.ts');
  const {
    CELL_SIZE, FLOOR_HEIGHT, GROUND_WALK_Y, HIGH_CROSSING_WALK_Y, QUAY_PATH_OFFSET,
    TERRACE_STEP_COUNT, terraceStepOutward, terraceStepWalkY,
  } = await server.ssrLoadModule('/src/spatial.ts');

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
    'mill', 'smokehouse', 'weaver', 'shipyard',
  ];
  const businesses = cells.slice(0, businessTypes.length).map((cell, index) => ({
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

  const turtleBatch = ambience.root.getObjectByName('harbor-turtles')?.children
    .find((object) => object instanceof THREE.InstancedMesh && object.count > 0);
  if (!turtleBatch) throw new Error('Harbor turtles were not visible around a built town.');
  if (ambience.wildlifeMemoryFromObject(turtleBatch, 240, 0)?.title !== 'Harbor turtle') {
    throw new Error('Visible turtles cannot be inspected in Observe mode.');
  }
  const catBatch = ambience.root.getObjectByName('harbor-cats')?.children
    .find((object) => object instanceof THREE.InstancedMesh && object.count > 0);
  if (!catBatch || ambience.wildlifeMemoryFromObject(catBatch, 240, 0)?.kind !== 'cat') {
    throw new Error('Visible harbor cats cannot be inspected in Observe mode.');
  }
  const fishBatch = ambience.root.getObjectByName('fish-schools')?.children
    .flatMap((school) => school.children)
    .find((object) => object instanceof THREE.InstancedMesh && object.count > 0)
    ?? ambience.root.getObjectByName('fish-schools')?.children.find((object) => object instanceof THREE.InstancedMesh && object.count > 0);
  if (!fishBatch || ambience.wildlifeMemoryFromObject(fishBatch, 240, 0)?.title !== 'Silver shoal') {
    throw new Error('Visible waterlife cannot be inspected in Observe mode.');
  }
  const rowboat = ambience.root.getObjectByName('rowboat');
  if (!rowboat?.visible || ambience.memoryFromObject(rowboat, 240, 0)?.kind !== 'boat') {
    throw new Error('Visible boats cannot be inspected in Observe mode.');
  }
  ambience.root.updateWorldMatrix(true, true);
  const raycaster = new THREE.Raycaster();
  const target = rowboat.getWorldPosition(new THREE.Vector3());
  raycaster.set(target.clone().add(new THREE.Vector3(8, 9, 10)), new THREE.Vector3(-8, -9, -10).normalize());
  const boatRayHit = raycaster.intersectObject(ambience.root, true)
    .find((hit) => ambience.memoryFromObject(hit.object, 240, 0, hit.instanceId)?.kind === 'boat');
  if (!boatRayHit) throw new Error('The Observe raycaster cannot select a visible boat.');

  const turtleMatrix = new THREE.Matrix4();
  turtleBatch.getMatrixAt(0, turtleMatrix);
  turtleMatrix.premultiply(turtleBatch.matrixWorld);
  const turtleTarget = new THREE.Vector3().setFromMatrixPosition(turtleMatrix);
  raycaster.set(turtleTarget.clone().add(new THREE.Vector3(8, 9, 10)), new THREE.Vector3(-8, -9, -10).normalize());
  const turtleRayHit = raycaster.intersectObject(ambience.root, true)
    .find((hit) => ambience.memoryFromObject(hit.object, 240, 0, hit.instanceId)?.title === 'Harbor turtle');
  if (!turtleRayHit) throw new Error('The Observe raycaster cannot select visible instanced wildlife.');

  const raycastFirstInstance = (batch, expectedTitle) => {
    batch.getMatrixAt(0, turtleMatrix);
    turtleMatrix.premultiply(batch.matrixWorld);
    const instanceTarget = new THREE.Vector3().setFromMatrixPosition(turtleMatrix);
    raycaster.set(instanceTarget.clone().add(new THREE.Vector3(8, 9, 10)), new THREE.Vector3(-8, -9, -10).normalize());
    return raycaster.intersectObject(ambience.root, true)
      .some((hit) => ambience.memoryFromObject(hit.object, 240, 0, hit.instanceId)?.title === expectedTitle);
  };
  if (!raycastFirstInstance(fishBatch, 'Silver shoal')) {
    throw new Error('The Observe raycaster cannot select visible fish.');
  }

  let jellyfishRayHit = false;
  for (let testTime = 0; testTime < 120 && !jellyfishRayHit; testTime += 1) {
    ambience.update(testTime, .8, 12, 240, 0, 0);
    const jellyfish = ambience.root.getObjectByName('squid-group');
    if (!jellyfish?.visible) continue;
    ambience.root.updateWorldMatrix(true, true);
    const jellyfishTarget = jellyfish.children[0]?.getWorldPosition(new THREE.Vector3());
    if (!jellyfishTarget) continue;
    raycaster.set(jellyfishTarget.clone().add(new THREE.Vector3(8, 9, 10)), new THREE.Vector3(-8, -9, -10).normalize());
    jellyfishRayHit = raycaster.intersectObject(ambience.root, true)
      .some((hit) => ambience.memoryFromObject(hit.object, 240, 0, hit.instanceId)?.title === 'Drifting jellyfish');
  }
  if (!jellyfishRayHit) throw new Error('The Observe raycaster cannot select visible jellyfish.');

  let dolphinRayHit = false;
  for (let testTime = 0; testTime < 120 && !dolphinRayHit; testTime += 1) {
    ambience.update(testTime, .8, 12, 240, 0, 0);
    ambience.root.updateWorldMatrix(true, true);
    let dolphinBatch;
    ambience.root.traverse((object) => {
      if (object instanceof THREE.InstancedMesh && object.userData.wildlifeObservation === 'dolphins' && object.count > 0) dolphinBatch = object;
    });
    if (dolphinBatch) dolphinRayHit = raycastFirstInstance(dolphinBatch, 'Dolphin pod');
  }
  if (!dolphinRayHit) throw new Error('The Observe raycaster cannot select visible dolphins.');

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

  const singleCell = { x: 0, z: 0, height: 1, color: 0, placedAt: 0 };
  const singleGraph = new NavGraph(new Map([['0,0', singleCell]]), seed);
  const groundNodes = [...singleGraph.nodes.values()].filter((node) => Math.abs(node.position.y - GROUND_WALK_Y) < .001);
  const furthestGroundCoordinate = Math.max(...groundNodes.flatMap((node) => [Math.abs(node.position.x), Math.abs(node.position.z)]));
  if (Math.abs(furthestGroundCoordinate - QUAY_PATH_OFFSET) > .001) {
    throw new Error(`Ground route is ${furthestGroundCoordinate} from the cell centre instead of ${QUAY_PATH_OFFSET}.`);
  }

  let stairSeed = 0;
  let stairDirection = 0;
  while (stairSeed < 10_000) {
    stairDirection = Math.floor(hash(stairSeed, 0, 0, 27) * 4);
    if (hasWaterStairs(singleCell, stairDirection, stairSeed)) break;
    stairSeed += 1;
  }
  const stairCity = new CityRenderer(stairSeed);
  stairCity.load([singleCell], 0);
  const residentialPiece = stairCity.root.children.find((child) => child.userData.cellX === 0 && child.userData.cellZ === 0);
  if (residentialPiece?.userData.waterStairDirection !== stairDirection) {
    throw new Error('Residential water stairs are not aligned with the entrance façade.');
  }
  stairCity.setBusinesses([{
    id: 'test-shop', type: 'cafe', cellKey: '0,0', ownerId: 'test-owner',
    name: 'Test Shop', openedAt: 0, employeeIds: [], visitCount: 0,
  }]);
  const businessPiece = stairCity.root.children.find((child) => child.userData.cellX === 0 && child.userData.cellZ === 0);
  if (businessPiece?.userData.waterStairDirection !== undefined) {
    throw new Error('Water stairs overlap a business entrance.');
  }

  const crossingCells = [
    { x: 0, z: -1, height: 3, color: 0, placedAt: 0 },
    { x: 0, z: 1, height: 3, color: 0, placedAt: 0 },
  ];
  const crossingGraph = new NavGraph(new Map(crossingCells.map((cell) => [`${cell.x},${cell.z}`, cell])), seed);
  const bridgeNodes = [...crossingGraph.nodes.values()].filter((node) => Math.abs(node.position.y - HIGH_CROSSING_WALK_Y) < .001);
  const bridgeEnds = bridgeNodes.filter((node) => Math.abs(node.position.z) > .001).map((node) => Math.abs(node.position.z));
  const expectedBridgeEnd = CELL_SIZE - QUAY_PATH_OFFSET;
  if (bridgeEnds.length !== 2 || bridgeEnds.some((position) => Math.abs(position - expectedBridgeEnd) > .001)) {
    throw new Error('Bridge navigation no longer meets its rendered access ladders.');
  }

  const terraceCells = [
    { x: 0, z: 0, height: 2, color: 0, placedAt: 0 },
    { x: 0, z: -1, height: 1, color: 0, placedAt: 0 },
    { x: 0, z: 1, height: 3, color: 0, placedAt: 0 },
    { x: -1, z: -1, height: 1, color: 0, placedAt: 0 },
    { x: 1, z: -1, height: 1, color: 0, placedAt: 0 },
    { x: 0, z: -2, height: 1, color: 0, placedAt: 0 },
  ];
  const bareTerraceCells = terraceCells.slice(0, 3);
  const bareTerraceMap = new Map(bareTerraceCells.map((cell) => [`${cell.x},${cell.z}`, cell]));
  if (walkableSteppedTerrace(bareTerraceCells[0], bareTerraceMap) !== null) {
    throw new Error('A terrace stair was created without a usable lower roof landing.');
  }
  const bareTerraceCity = new CityRenderer(seed);
  bareTerraceCity.load(bareTerraceCells, 0);
  if (bareTerraceCity.root.children.some((child) => child.userData.terraceDirection !== undefined)) {
    throw new Error('The renderer added a façade stair without a usable lower roof landing.');
  }
  const terraceGraph = new NavGraph(new Map(terraceCells.map((cell) => [`${cell.x},${cell.z}`, cell])), seed);
  const terraceCity = new CityRenderer(seed);
  terraceCity.load(terraceCells, 0);
  if (!terraceCity.root.children.some((child) => child.userData.terraceDirection !== undefined)) {
    throw new Error('A valid roof-to-roof terrace stair was not rendered.');
  }
  const terraceTopY = .38 + terraceCells[0].height * FLOOR_HEIGHT;
  for (let index = 0; index < TERRACE_STEP_COUNT; index++) {
    const expectedZ = -terraceStepOutward(index);
    const expectedY = terraceStepWalkY(terraceTopY, index);
    const aligned = [...terraceGraph.nodes.values()].some((node) =>
      Math.abs(node.position.x) < .001
      && Math.abs(node.position.z - expectedZ) < .001
      && Math.abs(node.position.y - expectedY) < .001);
    if (!aligned) throw new Error(`Terrace tread ${index + 1} is missing its aligned navigation node.`);
  }

  console.log(`Render-structure check passed: ${drawGroups} draw groups`, byRoot);
} finally {
  await server.close();
}
