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
  save() {},
  restore() {},
  beginPath() {},
  moveTo() {},
  lineTo() {},
  closePath() {},
  stroke() {},
  fill() {},
  arc() {},
  ellipse() {},
  set fillStyle(_value) {},
  set strokeStyle(_value) {},
  set lineWidth(_value) {},
  set lineCap(_value) {},
  set lineJoin(_value) {},
  set font(_value) {},
  set textAlign(_value) {},
  set textBaseline(_value) {},
};
globalThis.document = {
  createElement() {
    return { width: 0, height: 0, getContext() { return context; } };
  },
};

const facadeClaimsConflict = (a, b) => {
  if (a.direction !== b.direction) return false;
  const horizontalOverlap = a.bounds.sideMin < b.bounds.sideMax + .04 && a.bounds.sideMax > b.bounds.sideMin - .04;
  const verticalOverlap = a.bounds.yMin < b.bounds.yMax + .04 && a.bounds.yMax > b.bounds.yMin - .04;
  if (!horizontalOverlap || !verticalOverlap) return false;
  if (a.layer === 'opening' && b.layer === 'opening') return false;
  if ((a.layer === 'opening' && b.layer === 'composition') || (a.layer === 'composition' && b.layer === 'opening')) return false;
  return true;
};

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });

try {
  const { CityRenderer } = await server.ssrLoadModule('/src/city.ts');
  const { CitizenSystem, NavGraph } = await server.ssrLoadModule('/src/citizens.ts');
  const { CONFLUENCE_BY_ID } = await server.ssrLoadModule('/src/confluences.ts');
  const { createWorldSnapshot, DISCOVERY_EVENTS, evaluateCondition, resolveFocus } = await server.ssrLoadModule('/src/grow.ts');
  const { HarborAmbience } = await server.ssrLoadModule('/src/harbor.ts');
  const { hash } = await server.ssrLoadModule('/src/random.ts');
  const { hasWaterStairs } = await server.ssrLoadModule('/src/water.ts');
  const { facadeDirectionAt } = await server.ssrLoadModule('/src/topology.ts');
  const { isWalkableRoof, walkableSteppedTerrace } = await server.ssrLoadModule('/src/architecture.ts');
  const {
    CELL_SIZE, FLOOR_HEIGHT, GROUND_WALK_Y, HIGH_CROSSING_WALK_Y, QUAY_PATH_OFFSET,
    STOREFRONT_APRON_CENTER, STOREFRONT_APRON_DEPTH, STOREFRONT_CAT_OUTWARD,
    TERRACE_STEP_COUNT, TERRACE_TREAD_CLEARANCE, roofWalkY,
    terraceStepOutward, terraceStepWalkY, terraceTreadTopY,
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
    prosperityScore: index < 4 ? 10 : index < 6 ? 4 : 0,
    prosperityUpdatedAt: 240,
    prosperityTier: index < 4 ? 2 : index < 6 ? 1 : 0,
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
    'fishing-boat', 'silver-shoal', 'quay-crabs', 'harbor-cats', 'garden-butterflies',
    'blossom-tide', 'blossom-evening', 'shared-supper', 'evening-chorus', 'ferry-route',
  ];

  const finaleEvent = DISCOVERY_EVENTS.find((event) => event.id === 'lantern-finale');
  const finaleCondition = JSON.stringify(finaleEvent?.condition);
  for (const requirement of ['lit-lanterns', 'festival-crown', 'festival-invitation']) {
    if (!finaleCondition.includes(requirement)) throw new Error(`The lantern finale no longer requires ${requirement}.`);
  }
  const unattendedFinaleSnapshot = {
    litLanternCount: 5,
    festivalInvited: false,
    timeOfDay: 12,
    confluences: [{ id: 'festival-crown', x: 0, z: 0, visitors: 0 }],
  };
  if (evaluateCondition(finaleEvent.condition, unattendedFinaleSnapshot)) {
    throw new Error('The lantern finale can still begin while the game runs unattended.');
  }
  if (!evaluateCondition(finaleEvent.condition, { ...unattendedFinaleSnapshot, festivalInvited: true })) {
    throw new Error('The journal Begin action cannot start the ready lantern finale at any hour.');
  }

  const city = new CityRenderer(seed);
  city.load(cells, 240);
  city.setBusinesses(businesses);
  city.setDiscoveryState(discoveries);
  city.setHarborLanterns(['blossom', 'table', 'chorus', 'clock', 'welcome']);
  city.update(1, 240);
  const earnedLanterns = city.root.getObjectByName('earned-harbor-lanterns');
  const lanternTargets = earnedLanterns?.children.filter((child) => child.userData.harborLanternId) ?? [];
  if (lanternTargets.length !== 5) throw new Error(`The town rendered ${lanternTargets.length} of five earned harbor lanterns.`);
  if (city.memoryFromObject(lanternTargets[0])?.ageLabel !== 'One of five harbor lanterns') {
    throw new Error('Earned harbor lanterns cannot explain their meaning in Observe mode.');
  }
  earnedLanterns.updateWorldMatrix(true, true);
  const lanternPosition = lanternTargets[0].getWorldPosition(new THREE.Vector3());
  const lanternRay = new THREE.Raycaster(lanternPosition.clone().add(new THREE.Vector3(0, 0, 2)), new THREE.Vector3(0, 0, -1));
  if (!lanternRay.intersectObject(lanternTargets[0]).length) throw new Error('Observe mode cannot ray-pick an earned harbor lantern.');
  if (!earnedLanterns?.getObjectByName('earned-harbor-lantern-batch')) throw new Error('Earned lantern visuals were not consolidated into one draw batch.');
  const vegetationPlots = [...city.root.children].filter((group) => group.userData.vegetationPlotKind);
  if (!vegetationPlots.length) throw new Error('Exposed houses did not produce any deterministic vegetation plots.');
  if (!vegetationPlots.some((group) => group.userData.vegetationStage > 0)) throw new Error('Established vegetation plots did not advance with town time.');
  const architecturalTreeHabitats = [...city.root.children]
    .flatMap((group) => (group.userData.architecturalTrees ?? []).map((tree) => tree.habitat));
  if (!architecturalTreeHabitats.includes('rooftop')) throw new Error('Dense flat roofs did not produce compact rooftop trees.');
  if (city.signAtlas.tiles.size < businessTypes.length) throw new Error('The shared sign atlas did not receive every business sign.');
  const pictogramTiles = [...city.signAtlas.tiles.keys()].filter((key) => key.startsWith('pictogram-'));
  if (pictogramTiles.length !== businessTypes.length) throw new Error(`The sign atlas received ${pictogramTiles.length} of ${businessTypes.length} business pictograms.`);
  const renderedShopfronts = new Set(city.root.children.map((group) => group.userData.businessFacade).filter(Boolean));
  const missingShopfronts = businessTypes.filter((type) => !renderedShopfronts.has(type));
  if (missingShopfronts.length) throw new Error(`Businesses are missing distinct shopfronts: ${missingShopfronts.join(', ')}.`);
  const prosperousShopfronts = city.root.children.filter((group) => (group.userData.businessProsperityTier ?? 0) > 0);
  if (prosperousShopfronts.length !== 6) throw new Error(`Recent trade produced ${prosperousShopfronts.length} prosperous shop displays instead of 6.`);
  for (const shop of city.root.children.filter((group) => group.userData.businessFacade)) {
    const direction = shop.userData.businessApronDirection;
    if ((shop.userData.domesticGroundFacadeDirections ?? []).includes(direction)) {
      throw new Error(`${shop.userData.businessFacade} retained a domestic ground façade beneath its shopfront.`);
    }
  }
  for (const group of city.root.children) {
    const claims = group.userData.facadeDecorationClaims ?? [];
    for (let first = 0; first < claims.length; first++) for (let second = first + 1; second < claims.length; second++) {
      if (facadeClaimsConflict(claims[first], claims[second])) {
        throw new Error(`${claims[first].kind} overlaps ${claims[second].kind} in the façade occupancy map.`);
      }
    }
  }
  const recessedPosters = city.root.children.filter((group) => group.userData.businessFacade && group.userData.businessPosterOutward < 1.8);
  if (recessedPosters.length) throw new Error('Business pictograms are recessed behind storefront decorations.');

  // Exercise the collision planner with isolated two-storey homes, where the
  // old generator could independently add a balcony, festival pennants, and
  // wall equipment to the same upper façade.
  const collisionCells = Array.from({ length: 9 }, (_, index) => ({
    x: -8 + index * 2, z: -8, height: 2, color: index % 6,
    placedAt: 0, foundedAt: 0, renovatedAt: 0,
  }));
  const collisionCity = new CityRenderer(seed);
  collisionCity.load(collisionCells, 240);
  collisionCity.setDiscoveryState(['festival-ribbons', 'lantern-finale']);
  const collisionGroups = collisionCity.root.children.filter((group) => group.userData.cellX !== undefined);
  if (!collisionGroups.some((group) => (group.userData.facadeDecorationRejections ?? [])
    .some((rejection) => rejection.kind === 'festival-ribbons'))) {
    throw new Error('The façade occupancy fixture did not reject any pennants competing with a balcony.');
  }
  if (!collisionGroups.some((group) => (group.userData.facadeDecorationClaims ?? [])
    .some((claim) => claim.kind.startsWith('air-conditioner-')))) {
    throw new Error('The façade occupancy fixture did not find a safe alternate slot for any wall equipment.');
  }
  for (const group of collisionGroups) {
    const claims = group.userData.facadeDecorationClaims ?? [];
    for (let first = 0; first < claims.length; first++) for (let second = first + 1; second < claims.length; second++) {
      if (facadeClaimsConflict(claims[first], claims[second])) {
        throw new Error(`${claims[first].kind} overlaps ${claims[second].kind} in the stress-test façade.`);
      }
    }
  }
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
  const floatingLanterns = ambience.root.getObjectByName('floating-finale-lanterns');
  const fireworks = ambience.root.getObjectByName('finale-fireworks');
  if (!floatingLanterns?.visible || fireworks?.visible) throw new Error('A completed finale did not keep only its quiet water-lantern aftermath.');
  ambience.startLanternFinale();
  if (floatingLanterns.visible || fireworks.visible) throw new Error('The finale began before the five town lanterns had answered.');
  ambience.setLanternFinaleStage('water');
  if (!floatingLanterns.visible || fireworks.visible) throw new Error('The water-lantern beat displayed the wrong finale effects.');
  ambience.setLanternFinaleStage('fireworks');
  if (!floatingLanterns.visible || !fireworks.visible) throw new Error('The firework beat did not retain the floating lanterns.');
  ambience.setLanternFinaleStage('complete');
  if (!floatingLanterns.visible || fireworks.visible) throw new Error('The finale did not settle back into its persistent quiet state.');
  const lanternSquarePlace = {
    id: 'lantern-square', x: 1, z: 0, formations: ['harbor-plaza', 'rooftop-pavilion'],
    members: [{ id: 'harbor-plaza', x: 0, z: 0 }, { id: 'rooftop-pavilion', x: 2, z: 0 }],
  };
  ambience.setPlaceIdentities([lanternSquarePlace]);
  ambience.update(12, .05, 19.5, 259.5, 0, 0);
  const festivalDancers = ambience.root.getObjectByName('lantern-square-dancers');
  const rooftopDancers = ambience.root.getObjectByName('lantern-rooftop-dancers');
  if (!fireworks.visible || !festivalDancers?.visible || !rooftopDancers?.visible) {
    throw new Error('Lantern Square did not begin its nightly fireworks and dancing on both levels.');
  }
  if (fireworks.geometry.getAttribute('position').count < 600 || !fireworks.geometry.getAttribute('color') || !fireworks.material.map) {
    throw new Error('Lantern Square fireworks do not contain enough animated, glowing, multicolored sparks.');
  }
  if ((festivalDancers.getObjectByName('lantern-square-dancer-bodies')?.count ?? 0) < 10) {
    throw new Error('Lantern Square did not draw a visible festival crowd.');
  }
  const flatRoofCount = cells.filter((cell) => isWalkableRoof(cell, cellMap)).length;
  const rooftopBodyCount = rooftopDancers.getObjectByName('lantern-rooftop-dancer-bodies')?.count ?? 0;
  const rooftopLanternCount = rooftopDancers.getObjectByName('lantern-rooftop-party-lanterns')?.count ?? 0;
  const rooftopLights = rooftopDancers.children.filter((child) => child instanceof THREE.PointLight && child.visible);
  if (rooftopDancers.userData.partyRoofCount !== flatRoofCount
    || rooftopBodyCount !== flatRoofCount * 3
    || rooftopLanternCount !== flatRoofCount * 2
    || rooftopLights.length !== Math.min(flatRoofCount, 8)) {
    throw new Error('Lantern Square did not place a lit dance party on every flat, walkable rooftop.');
  }
  if (!fireworks.children.some((child) => child instanceof THREE.PointLight && child.intensity > 0)) {
    throw new Error('The firework globes did not cast a brief colored flash over the town.');
  }
  let fireworkSoundTriggered = false;
  for (let testTime = 12; testTime < 13.2; testTime += .04) {
    fireworkSoundTriggered ||= Boolean(ambience.update(testTime, .05, 19.5, 259.5, 0, 0).fireworkBurst);
  }
  if (!fireworkSoundTriggered) throw new Error('The evening firework cycle did not emit a restrained sound cue.');
  ambience.update(13, .8, 12, 252, 0, 0);
  if (fireworks.visible || festivalDancers.visible || rooftopDancers.visible) {
    throw new Error('Lantern Square fireworks or dancers remained active outside the evening celebration.');
  }
  const plazaMarketCells = [
    [0, -1], [1, -1], [0, 2], [1, 2], [-1, 0], [-1, 1],
  ].map(([x, z], index) => ({ x, z, height: 1, color: index, placedAt: 0, foundedAt: 0, renovatedAt: 0 }));
  const marketAmbience = new HarborAmbience(seed, new THREE.PerspectiveCamera(), plazaMarketCells);
  marketAmbience.setTown(plazaMarketCells, businesses, citizens, []);
  const marketOffset = Math.floor(hash(seed, 0, 0, 9440) * 3);
  const marketDay = 3 + (3 - marketOffset) % 3;
  const marketUpdate = marketAmbience.update(1, .8, 11, marketDay * 24 + 11, 0, 0);
  const market = marketAmbience.root.getObjectByName('prosperity-market-day');
  if (!market?.visible || !marketUpdate.prosperityMarketOpened) {
    throw new Error('A flourishing town did not open its scheduled plaza market.');
  }
  if (!market.getObjectByName('prosperity-market-plaza-stalls')?.visible) {
    throw new Error('A plaza market did not use both of its bounded stalls.');
  }
  let marketDraws = 0;
  market.traverse((object) => {
    if (object instanceof THREE.Mesh && object.visible) marketDraws += 1;
  });
  if (marketDraws !== 1) throw new Error(`The open market uses ${marketDraws} draw calls instead of 1.`);
  marketAmbience.update(2, .8, 11, marketDay * 24 + 11.1, 0, .7);
  if (market.visible) throw new Error('Market-day stalls stayed open through heavy rain.');
  const behavioralPlaces = [
    {
      id: 'canal-market', x: 1, z: 0, formations: ['narrow-canal', 'arcade-row'],
      members: [{ id: 'narrow-canal', x: 0, z: 0 }, { id: 'arcade-row', x: 2, z: 0 }],
    },
    {
      id: 'high-harbor', x: 1, z: 0, formations: ['high-bridge', 'lookout-tower'],
      members: [{ id: 'high-bridge', x: 2, z: 0 }, { id: 'lookout-tower', x: 0, z: 0 }],
    },
    {
      id: 'ferry-quarter', x: 1, z: 0, formations: ['narrow-canal', 'harbor-plaza'],
      members: [{ id: 'narrow-canal', x: 0, z: 0 }, { id: 'harbor-plaza', x: 2, z: 0 }],
    },
  ];
  ambience.setPlaceIdentities(behavioralPlaces);
  if (!ambience.activeFleet().includes('merchant boat')) throw new Error('The Canal Market did not attract merchant traffic.');
  if (!ambience.activeFleet().includes('signal boat')) throw new Error('The Signal Beacon did not call its survey boat.');
  if (!ambience.activeFleet().includes('ferry')) throw new Error('The Ferry Quarter did not establish its passenger route.');
  for (const vesselName of ['rowboat', 'fishing-boat', 'merchant-boat', 'signal-boat', 'ferry']) {
    const vessel = ambience.root.getObjectByName(vesselName);
    let crew = 0;
    vessel?.traverse((object) => { if (object.userData.vesselCrew) crew += 1; });
    if (!vessel || crew < 1) throw new Error(`${vesselName} does not have a visible crew model.`);
  }
  const visiblePassengers = ['ferry-passenger-1', 'ferry-passenger-2', 'ferry-passenger-3']
    .filter((name) => ambience.root.getObjectByName(name)?.visible).length;
  if (visiblePassengers !== 2) throw new Error(`The ferry represented ${visiblePassengers} travelers for a sixteen-person town instead of 2.`);
  if (!ambience.root.getObjectByName('fishing-deckhand')?.visible) throw new Error('The second fisher did not join the boat after the crew grew.');
  ambience.setCargoState({ fish: 5, grain: 2, timber: 1, clay: 3, fiber: 2, 'harbor-goods': 1 });
  const visibleCatch = ['catch-fish-1', 'catch-fish-2', 'catch-fish-3']
    .filter((name) => ambience.root.getObjectByName(name)?.visible).length;
  if (visibleCatch !== 3) throw new Error(`Five stored fish produced ${visibleCatch} visible catch pieces instead of 3.`);
  for (const good of ['grain', 'timber', 'clay', 'fiber', 'harbor-goods']) {
    if (!ambience.root.getObjectByName(`merchant-cargo-${good}`)?.visible) throw new Error(`The merchant boat did not show its ${good} cargo.`);
  }
  const importCell = { x: 0, z: 0, height: 1, color: 0, placedAt: 0, foundedAt: 0, renovatedAt: 0 };
  const importAmbience = new HarborAmbience(seed, new THREE.PerspectiveCamera(), [importCell]);
  importAmbience.setTown([importCell], businesses, citizens, []);
  importAmbience.setDiscoveryState(['merchant-arrival']);
  importAmbience.setCargoState({ grain: 2, timber: 1, clay: 3, fiber: 2 });
  const importYard = importAmbience.root.getObjectByName('dockside-import-yard');
  if (!importYard?.visible || importAmbience.importSourceCellKey() !== '0,0') throw new Error('Merchant imports did not establish a visible dockside storage yard.');
  const importLighter = importYard.getObjectByName('import-lighter');
  if (!importLighter || importLighter.position.z < 1.15 || importLighter.userData.mooringClearance < .12) {
    throw new Error('The import lighter was not parked clear of the dock platform.');
  }
  importYard.updateMatrixWorld(true);
  const importPlatform = importYard.getObjectByName('import-platform');
  if (!importPlatform || new THREE.Box3().setFromObject(importPlatform).intersectsBox(new THREE.Box3().setFromObject(importLighter))) {
    throw new Error('The import lighter geometry overlaps the dock platform.');
  }
  if (importYard.getObjectByName('import-hoist')) throw new Error('The obsolete cargo hoist remained in the people-led import yard.');
  for (const worker of ['import-lighter-deckhand', 'import-dock-porter']) {
    if (!importYard.getObjectByName(worker)?.userData.importWorker) throw new Error(`The import yard is missing ${worker}.`);
  }
  for (const good of ['grain', 'timber', 'clay', 'fiber']) {
    if (!importYard.getObjectByName(`import-store-${good}-1`)?.visible) throw new Error(`Dockside storage did not show its ${good} stock.`);
  }
  if (importAmbience.memoryFromObject(importYard, 240, 0)?.title !== 'Dockside import yard') {
    throw new Error('The import yard cannot explain imported materials in Observe mode.');
  }
  importAmbience.beginImport('clay');
  importAmbience.update(1, .8, 12, 240, 0, 0);
  const unloadingClay = importYard.getObjectByName('unloading-clay');
  if (!unloadingClay?.visible || unloadingClay.position.z >= 1.12 || unloadingClay.position.y <= .29) {
    throw new Error('Incoming clay did not visibly travel from the lighter into dockside storage.');
  }
  importYard.updateMatrixWorld(true);
  const deckhandPosition = importYard.getObjectByName('import-lighter-deckhand').getWorldPosition(new THREE.Vector3());
  const cargoPosition = unloadingClay.getWorldPosition(new THREE.Vector3());
  if (cargoPosition.y > .5 || cargoPosition.distanceTo(deckhandPosition) > .55) {
    throw new Error('Incoming cargo floated away from the deckhand carrying it ashore.');
  }
  importAmbience.update(2.5, .8, 12, 240, 0, 0);
  importYard.updateMatrixWorld(true);
  const porterPosition = importYard.getObjectByName('import-dock-porter').getWorldPosition(new THREE.Vector3());
  if (unloadingClay.getWorldPosition(cargoPosition).distanceTo(porterPosition) > .55) {
    throw new Error('The dock porter did not take over the incoming cargo on the platform.');
  }
  const merchantJourney = importAmbience.root.getObjectByName('merchant-boat');
  const outsidePosition = merchantJourney.position.clone();
  if (importAmbience.activeImportSourceCellKey()) throw new Error('Imports were accepted before the merchant reached the dock.');
  importAmbience.setCargoState({ grain: 2, timber: 1, clay: 3, fiber: 2, 'harbor-goods': 3 });
  importAmbience.update(30, .8, 12, 240, 0, 0);
  if (importAmbience.activeImportSourceCellKey() !== '0,0' || merchantJourney.position.distanceTo(outsidePosition) < 8) {
    throw new Error('The merchant boat did not travel from open water to the import dock.');
  }
  importAmbience.update(50, .8, 12, 240, 0, 0);
  if (!merchantJourney.visible || !merchantJourney.getObjectByName('merchant-cargo-harbor-goods')?.visible) {
    throw new Error('The departing merchant did not visibly carry finished harbor goods.');
  }
  const departure = importAmbience.update(69, .8, 12, 240, 0, 0);
  if (!departure.exportDeparture || merchantJourney.visible) throw new Error('The merchant boat did not complete its outbound trip beyond the town.');
  const signalBoat = ambience.root.getObjectByName('signal-boat');
  if (!signalBoat || ambience.memoryFromObject(signalBoat, 240, 0)?.title !== 'Beacon survey boat') {
    throw new Error('The Signal Beacon survey boat cannot be inspected.');
  }
  const fishingBoat = ambience.root.getObjectByName('fishing-boat');
  const castNet = fishingBoat?.getObjectByName('cast-net');
  const castNetCanopy = fishingBoat?.getObjectByName('cast-net-canopy');
  const castNetHandline = fishingBoat?.getObjectByName('cast-net-handline');
  const castNetSplash = fishingBoat?.getObjectByName('cast-net-splash');
  const castingArm = fishingBoat?.getObjectByName('casting-arm');
  if (!fishingBoat || !castNet || !castNetCanopy || !castNetHandline || !castNetSplash || !castingArm) {
    throw new Error('The fishing boat is missing part of its staged net-casting rig.');
  }
  const fishingActor = ambience.fleet.find((boat) => boat.kind === 'fishing boat');
  if (!fishingActor) throw new Error('The fishing boat has no fleet actor.');
  fishingActor.eligible = true;
  ambience.update(10.85, .8, 6, 240, 0, 0);
  if (!castNet.visible || castNet.position.y < .6 || castNet.position.z < .7 || castingArm.rotation.x > 1) {
    throw new Error('The skipper and net did not follow the airborne casting pose.');
  }
  ambience.update(13.25, .8, 6, 240, 0, 0);
  const handlinePositions = castNetHandline.geometry?.getAttribute('position');
  if (!castNet.visible || !castNetSplash.visible || !handlinePositions || handlinePositions.getZ(2) < 1) {
    throw new Error('The cast net did not open over the water with a connected handline and splash.');
  }
  ambience.update(3.76, .8, 6, 240, 0, 0);
  if (!castNet.visible || castNet.position.z > 1.1 || castNet.scale.x > .65) {
    throw new Error('The cast net did not gather back toward the boat during retrieval.');
  }
  ambience.update(6.4, .8, 6, 240, 0, 0);
  if (castNet.visible || castNetHandline.visible) throw new Error('The fishing rig stayed visible during the rest between casts.');
  ambience.setCargoState({});
  if (ambience.root.getObjectByName('catch-fish-1')?.visible || ambience.root.getObjectByName('merchant-cargo-grain')?.visible) {
    throw new Error('Consumed cargo remained visible on the fleet.');
  }
  ambience.setPlaceIdentities([]);
  if (ambience.activeFleet().includes('signal boat')) throw new Error('The survey boat remained after the Signal Beacon disappeared.');
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

  // An isolated cell makes the old fauna rule choose north, while this seed's
  // storefront deliberately faces east. Cats must share the storefront choice
  // and remain in the supported apron lane instead of orbiting into the counter.
  const catCell = { x: -3, z: 0, height: 1, color: 0, placedAt: 0, foundedAt: 0, renovatedAt: 0 };
  const catCells = [catCell];
  const catCellMap = new Map([[`${catCell.x},${catCell.z}`, catCell]]);
  const catBusiness = {
    id: 'cat-fishmonger', type: 'fishmonger', cellKey: `${catCell.x},${catCell.z}`,
    ownerId: 'cat-keeper', name: 'Cat Quay Fish', openedAt: 1, employeeIds: [], visitCount: 20,
  };
  const catFacadeDirection = facadeDirectionAt(catCell.x, catCell.z, catCellMap, seed);
  if (catFacadeDirection !== 1) throw new Error('The cat storefront regression fixture no longer faces east.');
  const catCity = new CityRenderer(seed);
  catCity.load(catCells, 240);
  catCity.setBusinesses([catBusiness]);
  const catFacade = catCity.root.children.find((group) => group.userData.businessFacade === 'fishmonger');
  if (catFacade?.userData.businessApronDirection !== catFacadeDirection) {
    throw new Error('The fishmonger apron did not use the shared façade direction.');
  }
  const catAmbience = new HarborAmbience(seed, new THREE.PerspectiveCamera(), catCells);
  catAmbience.setTown(catCells, [catBusiness], [], []);
  catAmbience.setDiscoveryState(['harbor-cats']);
  catAmbience.update(2, .8, 10, 240, 0, 0);
  const storefrontCatBatch = catAmbience.root.getObjectByName('harbor-cats')?.children
    .find((object) => object instanceof THREE.InstancedMesh && object.count === 3);
  if (!storefrontCatBatch) throw new Error('The fishmonger did not receive its three storefront cat slots.');
  const apronOuterEdge = STOREFRONT_APRON_CENTER + STOREFRONT_APRON_DEPTH / 2;
  const assertCatsOnApron = (phase) => {
    for (let index = 0; index < storefrontCatBatch.count; index++) {
      const matrix = new THREE.Matrix4();
      storefrontCatBatch.getMatrixAt(index, matrix);
      const position = new THREE.Vector3().setFromMatrixPosition(matrix);
      const outward = position.x - catCell.x * CELL_SIZE;
      const lateral = Math.abs(position.z - catCell.z * CELL_SIZE);
      if (Math.abs(outward - STOREFRONT_CAT_OUTWARD) > .02) {
        throw new Error(`Storefront cat ${index} left the safe façade lane during ${phase} (${outward.toFixed(2)}).`);
      }
      if (lateral > 1 || outward >= apronOuterEdge) {
        throw new Error(`Storefront cat ${index} left the supporting shop apron during ${phase}.`);
      }
    }
  };
  assertCatsOnApron('routine movement');
  catAmbience.wildlifeEffect('gather', 'cats', { x: catCell.x, z: catCell.z });
  catAmbience.update(3, .8, 10, 240, 0, 0);
  assertCatsOnApron('a gathering event');
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

  if (drawGroups > 100) throw new Error(`Full-feature scene has ${drawGroups} visible draw groups; budget is 100. ${JSON.stringify(byRoot)}`);

  const plazaCells = [
    [0, -1], [1, -1], [0, 2], [1, 2], [-1, 0], [-1, 1], [2, 0], [2, 1],
  ].map(([x, z]) => ({ x, z, height: 1, color: 0, placedAt: 0, foundedAt: 0, renovatedAt: 0 }));
  const plazaCity = new CityRenderer(seed);
  plazaCity.load(plazaCells, 240);
  const plazaTrees = [...plazaCity.root.children]
    .flatMap((group) => group.userData.architecturalTrees ?? [])
    .filter((tree) => tree.habitat === 'plaza');
  if (plazaTrees.length !== 2) throw new Error(`Harbor plaza produced ${plazaTrees.length} trees instead of 2.`);

  const landmarkCases = [
    {
      id: 'canal-market', title: 'Market Barge', target: [0, 0], cells: [
        { x: 0, z: -1, height: 2, color: 0, placedAt: 0 },
        { x: 0, z: 1, height: 2, color: 0, placedAt: 0 },
        { x: -1, z: 0, height: 2, color: 0, placedAt: 0 },
      ], members: [
        { id: 'sea-arch', x: 0, z: 0, direction: 0 },
        { id: 'arcade-row', x: 1, z: 0, direction: 1 },
      ],
    },
    {
      id: 'garden-commons', title: 'Seed House', target: [0, 0], cells: [
        { x: 0, z: -1, height: 2, color: 1, placedAt: 0 },
        { x: -1, z: 0, height: 2, color: 1, placedAt: 0 },
        { x: 1, z: 0, height: 2, color: 1, placedAt: 0 },
      ], members: [
        { id: 'courtyard-garden', x: 0, z: 0 },
        { id: 'stepped-terrace', x: 2, z: 0, direction: 1 },
      ],
    },
    {
      id: 'makers-walk', title: 'Guild Kiln', target: [0, 0], cells: [
        { x: 0, z: 0, height: 2, color: 2, placedAt: 0 },
      ], members: [
        { id: 'arcade-row', x: 0, z: 0, direction: 1 },
        { id: 'stepped-terrace', x: 2, z: 0, direction: 1 },
      ],
    },
    {
      id: 'roof-village', title: 'Roof Hall', target: [0, 0], cells: [
        { x: 0, z: 0, height: 2, color: 3, placedAt: 0 },
      ], members: [
        { id: 'roof-promenade', x: 2, z: 0, direction: 1 },
        { id: 'rooftop-court', x: 0, z: 0 },
      ],
    },
    {
      id: 'high-harbor', title: 'Signal Beacon', target: [0, 0], cells: [
        { x: 0, z: 0, height: 3, color: 4, placedAt: 0 },
      ], members: [
        { id: 'high-bridge', x: 2, z: 0, direction: 1 },
        { id: 'lookout-tower', x: 0, z: 0 },
      ],
    },
    {
      id: 'lantern-square', title: 'Lantern Theatre', target: [0, 0], cells: plazaCells,
      members: [
        { id: 'harbor-plaza', x: 0, z: 0 },
        { id: 'rooftop-pavilion', x: 3, z: 0 },
      ],
    },
    {
      id: 'ferry-quarter', title: 'Ferry House', target: [0, 0], cells: [
        { x: 0, z: -1, height: 2, color: 0, placedAt: 0 },
        { x: 0, z: 1, height: 2, color: 0, placedAt: 0 },
      ], members: [
        { id: 'sea-arch', x: 0, z: 0 },
        { id: 'harbor-plaza', x: 3, z: 0 },
      ],
    },
    {
      id: 'tidepool-cloister', title: 'Tide Cistern', target: [0, 0], cells: [
        { x: 0, z: -1, height: 2, color: 1, placedAt: 0 },
        { x: -1, z: 0, height: 2, color: 1, placedAt: 0 },
        { x: 1, z: 0, height: 2, color: 1, placedAt: 0 },
      ], members: [
        { id: 'sea-arch', x: 3, z: 0 },
        { id: 'cloister-garden', x: 0, z: 0 },
      ],
    },
    {
      id: 'story-court', title: 'Reading Loggia', target: [0, 0], cells: [
        { x: 0, z: -1, height: 1, color: 2, placedAt: 0 },
        { x: -1, z: 0, height: 1, color: 2, placedAt: 0 },
        { x: 1, z: 0, height: 1, color: 2, placedAt: 0 },
      ], members: [
        { id: 'arcade-row', x: 3, z: 0 },
        { id: 'courtyard-garden', x: 0, z: 0 },
      ],
    },
    {
      id: 'windloom-quarter', title: 'Wind Loom', target: [0, 0], cells: [
        { x: 0, z: 0, height: 3, color: 3, placedAt: 0 },
        { x: 1, z: 0, height: 3, color: 3, placedAt: 0 },
        { x: 0, z: 1, height: 3, color: 3, placedAt: 0 },
        { x: 1, z: 1, height: 3, color: 3, placedAt: 0 },
      ], members: [
        { id: 'terraced-garden', x: 3, z: 0 },
        { id: 'rooftop-pavilion', x: 0, z: 0 },
      ],
    },
    {
      id: 'bell-steps', title: 'Tide Bell', target: [0, 0], cells: [
        { x: 0, z: 0, height: 3, color: 4, placedAt: 0 },
      ], members: [
        { id: 'lantern-stair', x: 0, z: 0 },
        { id: 'harbor-plaza', x: 3, z: 0 },
      ],
    },
    {
      id: 'messengers-row', title: 'Post House', target: [0, 0], cells: [
        { x: 0, z: 0, height: 2, color: 5, placedAt: 0 },
      ], members: [
        { id: 'arcade-row', x: 0, z: 0 },
        { id: 'lookout-tower', x: 3, z: 0 },
      ],
    },
    {
      id: 'star-garden', title: 'Star Dial', target: [0, 0], cells: [
        { x: 0, z: 0, height: 4, color: 6, placedAt: 0 },
        { x: 1, z: 0, height: 4, color: 6, placedAt: 0 },
        { x: 0, z: 1, height: 4, color: 6, placedAt: 0 },
        { x: 1, z: 1, height: 4, color: 6, placedAt: 0 },
      ], members: [
        { id: 'hanging-roof-garden', x: 0, z: 0 },
        { id: 'lookout-tower', x: 3, z: 0 },
      ],
    },
    {
      id: 'kite-steps', title: 'Kite Loft', target: [0, 0], cells: [
        { x: 0, z: 0, height: 2, color: 7, placedAt: 0 },
        { x: 1, z: 0, height: 2, color: 7, placedAt: 0 },
        { x: 0, z: 1, height: 2, color: 7, placedAt: 0 },
        { x: 1, z: 1, height: 2, color: 7, placedAt: 0 },
      ], members: [
        { id: 'stepped-terrace', x: 3, z: 0 },
        { id: 'rooftop-court', x: 0, z: 0 },
      ],
    },
  ];
  for (const landmarkCase of landmarkCases) {
    const landmarkCity = new CityRenderer(seed);
    landmarkCity.load(landmarkCase.cells, 0);
    const [first, second] = landmarkCase.members;
    landmarkCity.setPlaceIdentities([{
      id: landmarkCase.id,
      x: Math.round((first.x + second.x) / 2),
      z: Math.round((first.z + second.z) / 2),
      formations: [first.id, second.id],
      members: [first, second],
    }], true);
    const [targetX, targetZ] = landmarkCase.target;
    const animatedLandmark = landmarkCity.root.children.find((child) => child.userData.cellX === targetX && child.userData.cellZ === targetZ);
    if (!animatedLandmark || animatedLandmark.scale.y >= 1) throw new Error(`${landmarkCase.title} did not receive its arrival animation.`);
    const memory = landmarkCity.memoryAt(targetX, targetZ, 0);
    if (memory?.kind !== 'landmark' || memory.title !== landmarkCase.title || !memory.note.includes('This landmark remains only while')) {
      throw new Error(`${landmarkCase.title} did not replace its formation socket with an inspectable landmark.`);
    }
    if (landmarkCase.id === 'garden-commons' && !landmarkCity.root.children.some((child) => child.userData.seedHouseTrays)) {
      throw new Error('The Seed House did not spread planting trays to nearby homes.');
    }
    if (landmarkCase.id === 'lantern-square') {
      const theatreLights = animatedLandmark.children.filter((child) => child instanceof THREE.PointLight);
      const nightGlows = landmarkCity.root.getObjectByName('night-glows');
      if (theatreLights.length !== 2 || (nightGlows?.geometry?.getAttribute('position').count ?? 0) < 9) {
        throw new Error('The Lantern Theatre is missing its local lamps or layered night glows.');
      }
    }
    if (landmarkCase.id === 'canal-market') {
      const barge = animatedLandmark.getObjectByName('market-barge-model');
      const hasShapedHull = barge?.children.some((child) => child instanceof THREE.Mesh && child.geometry.type === 'ExtrudeGeometry');
      const representedPeople = barge?.children.filter((child) => child.userData.bargePerson).length ?? 0;
      if (!barge || !hasShapedHull || barge.children.length < 18 || representedPeople !== 2) {
        throw new Error('The Market Barge is missing its shaped hull, striped canopy, or working-deck details.');
      }
      const marketFrontages = landmarkCity.root.children
        .filter((child) => child.userData.canalMarketFrontDirection !== undefined);
      if (!marketFrontages.length) throw new Error('The Canal Market did not establish a coherent neighboring frontage.');
      for (const frontage of marketFrontages) {
        const direction = frontage.userData.canalMarketFrontDirection;
        const cellX = frontage.userData.cellX;
        const cellZ = frontage.userData.cellZ;
        const [frontDx, frontDz] = [[0, -1], [1, 0], [0, 1], [-1, 0]][direction];
        const before = Math.abs(cellX - targetX) + Math.abs(cellZ - targetZ);
        const after = Math.abs(cellX + frontDx - targetX) + Math.abs(cellZ + frontDz - targetZ);
        if (after >= before) throw new Error('A Canal Market frontage does not face toward its barge.');
        if ((frontage.userData.residentialAwningDirections ?? []).includes(direction)) {
          throw new Error('A residential awning remained beneath a Canal Market frontage.');
        }
        if ((frontage.userData.arcadeDirections ?? []).includes(direction)) {
          throw new Error('An arcade arch remained on the Canal Market frontage.');
        }
        if ((frontage.userData.domesticGroundFacadeDirections ?? []).includes(direction)) {
          throw new Error('A domestic ground façade remained beneath a Canal Market frontage.');
        }
      }
      if (landmarkCity.signAtlas.tiles.size !== 0) {
        throw new Error('A non-business hanging sign still makes a Canal Market home look like a shop.');
      }
    }
    if (landmarkCase.id === 'makers-walk' && !landmarkCity.root.children.some((child) => child.userData.guildKilnMarks)) {
      throw new Error('The Guild Kiln did not spread fired craft marks to nearby façades.');
    }
    landmarkCity.setPlaceIdentities([]);
    if (landmarkCity.memoryAt(targetX, targetZ, 0)?.kind === 'landmark') {
      throw new Error(`${landmarkCase.title} remained after its source relationship was removed.`);
    }
  }

  const courtyardCells = [
    { x: 0, z: -1, height: 2, color: 1, placedAt: 0 },
    { x: -1, z: 0, height: 2, color: 1, placedAt: 0 },
    { x: 1, z: 0, height: 2, color: 1, placedAt: 0 },
  ];
  const roofCells = [
    { x: 0, z: 0, height: 3, color: 3, placedAt: 0 },
    { x: 1, z: 0, height: 3, color: 3, placedAt: 0 },
    { x: 0, z: 1, height: 3, color: 3, placedAt: 0 },
    { x: 1, z: 1, height: 3, color: 3, placedAt: 0 },
  ];
  const confluenceCases = [
    { id: 'grand-exchange', target: [0, 0], cells: [{ x: -1, z: 0, height: 2, color: 0, placedAt: 0 }, { x: 1, z: 0, height: 2, color: 0, placedAt: 0 }], members: [{ id: 'narrow-canal', x: 0, z: 0 }, { id: 'arcade-row', x: 2, z: 0 }, { id: 'harbor-plaza', x: 1, z: 2 }] },
    { id: 'tide-sanctuary', target: [0, 0], cells: courtyardCells, members: [{ id: 'sea-arch', x: 2, z: 0 }, { id: 'cloister-garden', x: 0, z: 0 }, { id: 'terraced-garden', x: 1, z: 2 }] },
    { id: 'house-of-hands', target: [0, 0], cells: courtyardCells, members: [{ id: 'arcade-row', x: 2, z: 0 }, { id: 'courtyard-garden', x: 0, z: 0 }, { id: 'stepped-terrace', x: 1, z: 2 }] },
    { id: 'festival-crown', target: [0, 0], cells: plazaCells, members: [{ id: 'lantern-stair', x: 2, z: 0 }, { id: 'harbor-plaza', x: 0, z: 0 }, { id: 'rooftop-pavilion', x: 1, z: 2 }] },
    { id: 'celestial-beacon', target: [0, 0], cells: [{ x: 0, z: 0, height: 4, color: 4, placedAt: 0 }], members: [{ id: 'high-bridge', x: 2, z: 0 }, { id: 'lookout-tower', x: 0, z: 0 }, { id: 'hanging-roof-garden', x: 1, z: 2 }] },
    { id: 'banner-guild', target: [0, 0], cells: roofCells, members: [{ id: 'arcade-row', x: 2, z: 0 }, { id: 'terraced-garden', x: 1, z: 2 }, { id: 'rooftop-pavilion', x: 0, z: 0 }] },
    { id: 'archive-tower', target: [0, 0], cells: [{ x: 0, z: 0, height: 4, color: 5, placedAt: 0 }], members: [{ id: 'arcade-row', x: 2, z: 0 }, { id: 'courtyard-garden', x: 1, z: 2 }, { id: 'lookout-tower', x: 0, z: 0 }] },
  ];
  for (const confluenceCase of confluenceCases) {
    const definition = CONFLUENCE_BY_ID.get(confluenceCase.id);
    const confluenceCity = new CityRenderer(seed);
    confluenceCity.load(confluenceCase.cells, 0);
    confluenceCity.setConfluences([{
      id: confluenceCase.id,
      x: Math.round(confluenceCase.members.reduce((sum, member) => sum + member.x, 0) / 3),
      z: Math.round(confluenceCase.members.reduce((sum, member) => sum + member.z, 0) / 3),
      formations: confluenceCase.members.map((member) => member.id),
      members: confluenceCase.members,
    }], true);
    const [targetX, targetZ] = confluenceCase.target;
    const landmarkGroup = confluenceCity.root.children.find((child) => child.userData.cellX === targetX && child.userData.cellZ === targetZ);
    if (!landmarkGroup || landmarkGroup.scale.y >= 1 || landmarkGroup.userData.confluenceLandmark !== definition.landmark.kind) {
      throw new Error(`${definition.landmark.title} did not arrive as a distinct animated confluence landmark.`);
    }
    if (confluenceCase.id === 'archive-tower') {
      if (!landmarkGroup.userData.archiveReplacesTowerRoof || landmarkGroup.userData.hasPitchedTowerRoof) {
        throw new Error("The Harbor Archive did not replace the lookout's intersecting pitched roof.");
      }
      if (landmarkGroup.userData.archiveWindowCount !== 8) {
        throw new Error('The Harbor Archive is missing its four paired record-room window bays.');
      }
    }
    const memory = confluenceCity.memoryAt(targetX, targetZ, 0);
    if (memory?.kind !== 'landmark' || memory.title !== definition.landmark.title || !memory.note.includes('all three formations')) {
      throw new Error(`${definition.landmark.title} is not inspectable as a three-formation landmark.`);
    }
    confluenceCity.setConfluences([]);
    if (confluenceCity.memoryAt(targetX, targetZ, 0)?.title === definition.landmark.title) {
      throw new Error(`${definition.landmark.title} remained after its three-formation relationship was removed.`);
    }
  }
  const clockCity = new CityRenderer(seed);
  clockCity.load([{ x: 0, z: 0, height: 4, color: 2, placedAt: 0 }], 0);
  clockCity.setDiscoveryState(['clock-tower']);
  const clockGroup = clockCity.root.children.find((child) => child.userData.cellX === 0 && child.userData.cellZ === 0);
  if (!clockGroup || clockGroup.userData.clockFaceCount !== 4) {
    throw new Error('An isolated clocktower does not mount a complete dial on every exposed face.');
  }
  if (clockGroup.userData.balconyDirection !== undefined) {
    throw new Error('A balcony still intersects an authored clock face.');
  }
  const confluenceEvents = DISCOVERY_EVENTS.filter((event) => event.id.startsWith('confluence-'));
  if (confluenceEvents.length !== 7 || confluenceEvents.some((event) => event.repeatable || event.effects.some((effect) => effect.kind === 'business'))) {
    throw new Error('Confluences do not each have one non-economic, one-time journal story.');
  }
  const exchangeFixture = confluenceCases[0];
  const exchangeSnapshot = createWorldSnapshot({
    cells: exchangeFixture.cells,
    citizens: [],
    businesses: [],
    seed,
    day: 4,
    timeOfDay: 12,
    priorDiscoveries: [],
    confluences: [{
      id: exchangeFixture.id,
      x: 1,
      z: 1,
      formations: exchangeFixture.members.map((member) => member.id),
      members: exchangeFixture.members,
    }],
    confluenceVisitorCounts: new Map([[exchangeFixture.id, 2]]),
  });
  if (!evaluateCondition({ kind: 'confluence', confluenceId: exchangeFixture.id, atLeast: 1, visitorsAtLeast: 2 }, exchangeSnapshot)) {
    throw new Error('GROW did not recognize resident use of an active confluence.');
  }
  const exchangeFocus = resolveFocus({ kind: 'confluence', confluenceId: exchangeFixture.id }, exchangeSnapshot);
  if (exchangeFocus?.x !== 0 || exchangeFocus.z !== 0) throw new Error('A Confluence story did not focus its grand landmark socket.');

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
  const lowerLandingY = roofWalkY(terraceCells[1].height);
  const lowestTreadY = terraceTreadTopY(terraceTopY, TERRACE_STEP_COUNT - 1);
  if (Math.abs(lowestTreadY - lowerLandingY - TERRACE_TREAD_CLEARANCE) > .001) {
    throw new Error('Terrace tread clearance no longer separates the lowest step from the lower roof deck.');
  }
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
