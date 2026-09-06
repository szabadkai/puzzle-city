import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARDINALS, type BusinessSave, type Cell, type CitizenSave, type CraftGood, type PlaceIdentityId } from './types';
import { townProsperityLevel } from './businesses';
import { detectFormations } from './formations';
import { placeLandmarkSocket, type PlaceIdentityOccurrence } from './place-identities';
import { hash } from './random';
import { roofWalkY } from './spatial';
import { isWalkableRoof } from './architecture';
import { findPlazaAnchors } from './topology';
import {
  analyzeWaterTopology, createDockNavigationPath, createShorelineRoute, WORLD_CELL_SIZE,
  type ShorelineEdge, type WaterPoint, type WaterTopology,
} from './water';
import { FaunaSystem, type WildlifeAction, type WildlifeKind, type WildlifeMemoryInspection } from './fauna';

const FIREWORK_PALETTE = [
  0xff3328, 0xffc51b, 0xffefad,
  0xff4935, 0x35d49a, 0xffb51b,
  0xff2f28, 0xffedbb, 0xffc21a,
] as const;
const MAX_ROOFTOP_PARTY_ROOFS = 384;
const DANCERS_PER_ROOF = 3;

function createFireworkGlowTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.2, 'rgba(255,247,211,.98)');
  gradient.addColorStop(.55, 'rgba(255,190,78,.5)');
  gradient.addColorStop(1, 'rgba(255,150,40,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function createWaterRoute(cells: Iterable<Cell>, seed: number, lane = 0) {
  return createShorelineRoute(cells, seed, lane);
}

/** A faceted working hull with a narrow keel and a recognisable bow. */
function createHullGeometry(length: number, beam: number, depth: number) {
  const stations = [
    { x: -length * .5, width: beam * .31, keel: depth * .64 },
    { x: -length * .34, width: beam * .48, keel: depth * .9 },
    { x: length * .16, width: beam * .5, keel: depth },
    { x: length * .39, width: beam * .35, keel: depth * .82 },
    { x: length * .5, width: beam * .045, keel: depth * .36 },
  ];
  const section = (station: typeof stations[number]) => [
    [station.x, .1, station.width],
    [station.x, -depth * .32, station.width * .78],
    [station.x, -station.keel, 0],
    [station.x, -depth * .32, -station.width * .78],
    [station.x, .1, -station.width],
  ] as const;
  const sections = stations.map(section);
  const positions: number[] = [];
  const triangle = (a: readonly number[], b: readonly number[], c: readonly number[]) => positions.push(...a, ...b, ...c);
  for (let station = 0; station < sections.length - 1; station++) {
    for (let edge = 0; edge < 4; edge++) {
      const a = sections[station][edge];
      const b = sections[station + 1][edge];
      const c = sections[station + 1][edge + 1];
      const d = sections[station][edge + 1];
      triangle(a, d, c);
      triangle(a, c, b);
    }
  }
  for (const station of [0, sections.length - 1]) {
    const face = sections[station];
    const center = [face[0][0], -depth * .32, 0] as const;
    for (let edge = 0; edge < 4; edge++) triangle(center, face[edge], face[edge + 1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function createDeckGeometry(length: number, beam: number) {
  const shape = new THREE.Shape();
  shape.moveTo(-length * .46, -beam * .29);
  shape.lineTo(length * .32, -beam * .43);
  shape.lineTo(length * .46, 0);
  shape.lineTo(length * .32, beam * .43);
  shape.lineTo(-length * .46, beam * .29);
  shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape);
  geometry.rotateX(-Math.PI / 2);
  return geometry;
}

function addGunwales(group: THREE.Group, length: number, beam: number, material: THREE.Material) {
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.CylinderGeometry(.018, .022, length * .77, 6), material);
    rail.rotation.z = Math.PI / 2;
    rail.position.set(-length * .035, .14, side * beam * .45);
    rail.castShadow = true;
    group.add(rail);
  }
}

function consolidateModel(group: THREE.Group) {
  const buckets = new Map<string, THREE.Mesh[]>();
  for (const child of [...group.children]) {
    if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
    const bucket = buckets.get(child.material.uuid) ?? [];
    bucket.push(child);
    buckets.set(child.material.uuid, bucket);
  }
  for (const meshes of buckets.values()) {
    if (meshes.length < 2) continue;
    const keepIndexed = meshes.every((mesh) => mesh.geometry.index !== null);
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      const geometry = keepIndexed || !mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.toNonIndexed();
      if (!geometry.getAttribute('normal')) geometry.computeVertexNormals();
      geometry.applyMatrix4(mesh.matrix);
      return geometry;
    });
    const sharedAttributes = new Set(Object.keys(geometries[0].attributes));
    for (const geometry of geometries.slice(1)) {
      for (const attribute of sharedAttributes) if (!geometry.getAttribute(attribute)) sharedAttributes.delete(attribute);
    }
    for (const geometry of geometries) {
      for (const attribute of Object.keys(geometry.attributes)) if (!sharedAttributes.has(attribute)) geometry.deleteAttribute(attribute);
    }
    const geometry = mergeGeometries(geometries, false);
    for (const part of geometries) part.dispose();
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, meshes[0].material);
    merged.castShadow = meshes.some((mesh) => mesh.castShadow);
    for (const mesh of meshes) {
      group.remove(mesh);
      mesh.geometry.dispose();
    }
    group.add(merged);
  }
  return group;
}

/** Single-color, low-poly deck figures read like little board-game settlers. */
function createDeckPerson(name: string, color: number, role: 'crew' | 'passenger' | 'worker' = 'crew', scale = 1) {
  const person = new THREE.Group();
  person.name = name;
  person.userData[role === 'crew' ? 'vesselCrew' : role === 'passenger' ? 'vesselPassenger' : 'importWorker'] = true;
  const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
  const body = new THREE.CapsuleGeometry(.045, .105, 2, 6);
  body.translate(0, .145, 0);
  const head = new THREE.SphereGeometry(.052, 7, 5);
  head.translate(0, .29, 0);
  const hat = new THREE.ConeGeometry(.09, .045, 7);
  hat.translate(0, .355, 0);
  const arm = new THREE.CylinderGeometry(.017, .02, .17, 5);
  arm.rotateZ(Math.PI / 2);
  arm.translate(0, .18, 0);
  const geometry = mergeGeometries([body, head, hat, arm], false);
  body.dispose();
  head.dispose();
  hat.dispose();
  arm.dispose();
  if (geometry) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.castShadow = true;
    person.add(mesh);
  }
  person.scale.setScalar(scale);
  return person;
}

/** Make a moving vessel easy to select without rendering a separate hit target. */
function addPickSphere(group: THREE.Group, radius: number) {
  const target = group.children.find((child): child is THREE.Mesh => child instanceof THREE.Mesh);
  if (!target) return;
  const preciseRaycast = target.raycast.bind(target);
  const center = new THREE.Vector3();
  const closest = new THREE.Vector3();
  target.raycast = (raycaster, intersections) => {
    preciseRaycast(raycaster, intersections);
    group.getWorldPosition(center);
    raycaster.ray.closestPointToPoint(center, closest);
    if (closest.distanceToSquared(center) > radius * radius) return;
    const distance = raycaster.ray.origin.distanceTo(closest);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersections.push({ distance, point: closest.clone(), object: target });
  };
}

type BoatKind = 'rowboat' | 'fishing boat' | 'merchant boat' | 'signal boat' | 'ferry';
type ImportGood = 'grain' | 'timber' | 'clay' | 'fiber';

const IMPORT_GOODS = new Set<CraftGood>(['grain', 'timber', 'clay', 'fiber']);

export type BoatMemoryInspection = Readonly<{
  kind: 'boat';
  title: string;
  ageLabel: string;
  detail: string;
  note: string;
}>;

export type ImportYardMemoryInspection = Readonly<{
  kind: 'harbor-feature';
  title: string;
  ageLabel: string;
  detail: string;
  note: string;
}>;

export type HarborMemoryInspection = WildlifeMemoryInspection | BoatMemoryInspection | ImportYardMemoryInspection;

export type HarborUpdate = Readonly<{
  exportDeparture?: { good: 'harbor-goods'; capacity: number };
  fireworkBurst?: number;
  prosperityMarketOpened?: { x: number; z: number };
}>;

type BoatActor = {
  kind: BoatKind;
  model: THREE.Group;
  route: THREE.CatmullRomCurve3;
  phase: number;
  speed: number;
  bobSpeed: number;
  eligible: boolean;
};

type FireworkSpark = Readonly<{
  burst: number;
  spark: number;
  direction: THREE.Vector3;
  speed: number;
  radiusScale: number;
  color: THREE.Color;
}>;

type FestivalDancer = Readonly<{
  x: number;
  y: number;
  z: number;
  centerX: number;
  centerZ: number;
  phase: number;
  scale: number;
}>;

type FestivalCrowdBatches = Readonly<{
  bodies: THREE.InstancedMesh;
  heads: THREE.InstancedMesh;
  arms: THREE.InstancedMesh;
  legs: THREE.InstancedMesh;
}>;

export type LanternFinaleStage = 'lanterns' | 'gathering' | 'water' | 'fireworks' | 'complete';

export class HarborAmbience {
  readonly root = new THREE.Group();
  private readonly fleet: BoatActor[] = [];
  private readonly fauna: FaunaSystem;
  private readonly clouds = new THREE.Group();
  private readonly petals: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly fireflies: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly floatingLanterns: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly fireworks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly fireworkSparks: FireworkSpark[] = [];
  private readonly fireworkFlashLights: THREE.PointLight[] = [];
  private readonly festivalCrowd: THREE.Group;
  private readonly festivalDancers: FestivalDancer[] = [];
  private festivalCrowdBatches!: FestivalCrowdBatches;
  private readonly rooftopCrowd: THREE.Group;
  private readonly rooftopDancers: FestivalDancer[] = [];
  private rooftopCrowdBatches!: FestivalCrowdBatches;
  private rooftopLanterns!: THREE.InstancedMesh;
  private readonly rooftopPartyLights: THREE.PointLight[] = [];
  private readonly prosperityMarket: THREE.Group;
  private prosperityMarketAnchor: { x: number; z: number } | null = null;
  private readonly festivalRootTransform = new THREE.Object3D();
  private readonly festivalPartTransform = new THREE.Object3D();
  private readonly festivalCombinedMatrix = new THREE.Matrix4();
  private readonly rain: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly importYard: THREE.Group;
  private readonly cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xffe2bc, transparent: true, opacity: .42, roughness: 1, depthWrite: false });
  private readonly starMaterial = new THREE.PointsMaterial({ color: 0xffe4a3, size: .13, transparent: true, opacity: 0, depthWrite: false });
  private readonly sunDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private cells: Cell[] = [];
  private businesses: BusinessSave[] = [];
  private citizens: CitizenSave[] = [];
  private discoveries = new Set<string>();
  private lanternFinaleStage: LanternFinaleStage = 'complete';
  private placeIdentities = new Set<PlaceIdentityId>();
  private lanternSquarePlace: PlaceIdentityOccurrence | null = null;
  private lanternSquareCenter: THREE.Vector3 | null = null;
  private rooftopPartyCenter: THREE.Vector3 | null = null;
  private lastTimeOfDay = 12;
  private lastRainIntensity = 0;
  private readonly cargoModels = new Map<CraftGood, THREE.Object3D[]>();
  private cargoState: Partial<Record<CraftGood, number>> = {};
  private readonly importQueue: ImportGood[] = [];
  private unloading?: { good: ImportGood; startedAt: number };
  private lastUpdateTime = 0;
  private lastFireworkSoundAt = -Infinity;
  private merchantDocked = false;
  private merchantJourneyPhase = 0;
  private merchantCycle = Number.NaN;
  private merchantLoadedExport = false;
  private merchantShippedCycle = Number.NaN;
  private merchantWasOnDuty = false;
  private importDock?: ShorelineEdge;
  private merchantInboundRoute?: THREE.CurvePath<THREE.Vector3>;
  private merchantOutboundRoute?: THREE.CurvePath<THREE.Vector3>;
  private readonly merchantArrivalPoint = new THREE.Vector3();
  private readonly merchantDeparturePoint = new THREE.Vector3();
  private topology!: WaterTopology;
  private readonly townCenter = new THREE.Vector3();

  constructor(private readonly seed: number, camera: THREE.Camera, cells: Iterable<Cell>) {
    this.root.name = 'harbor-ambience';
    this.createFleet();
    this.importYard = this.createImportYard();
    this.root.add(this.importYard);
    this.fauna = new FaunaSystem(seed);
    this.root.add(this.fauna.root);
    this.createClouds();
    this.createStars();
    this.petals = this.createParticles(42, 0xf1a8ad, .1, 1700);
    this.petals.name = 'blossom-petals';
    this.petals.visible = false;
    this.root.add(this.petals);
    this.fireflies = this.createParticles(30, 0xffdc73, .12, 1800);
    this.fireflies.name = 'evening-fireflies';
    this.fireflies.visible = false;
    this.root.add(this.fireflies);
    this.floatingLanterns = this.createWaterLanterns();
    this.floatingLanterns.name = 'floating-finale-lanterns';
    this.floatingLanterns.visible = false;
    this.root.add(this.floatingLanterns);
    this.fireworks = this.createFireworks();
    this.fireworks.name = 'finale-fireworks';
    this.fireworks.visible = false;
    this.fireworkFlashLights.push(...this.createFireworkFlashLights());
    this.fireworks.add(...this.fireworkFlashLights);
    this.root.add(this.fireworks);
    this.festivalCrowd = this.createFestivalCrowd(false);
    this.festivalCrowd.name = 'lantern-square-dancers';
    this.festivalCrowd.visible = false;
    this.root.add(this.festivalCrowd);
    this.rooftopCrowd = this.createFestivalCrowd(true);
    this.rooftopCrowd.name = 'lantern-rooftop-dancers';
    this.rooftopCrowd.visible = false;
    this.root.add(this.rooftopCrowd);
    this.prosperityMarket = this.createProsperityMarket();
    this.prosperityMarket.visible = false;
    this.root.add(this.prosperityMarket);
    this.rain = this.createRain();
    this.rain.name = 'passing-rain';
    this.rain.visible = false;
    this.root.add(this.rain);
    this.sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xffc36f, transparent: true, opacity: .65, depthWrite: false }),
    );
    this.sunDisc.position.set(-17, 14, -28);
    this.sunDisc.lookAt(camera.position);
    this.root.add(this.sunDisc);
    this.setTown(cells);
  }

  setTown(cells: Iterable<Cell>, businesses: readonly BusinessSave[] = this.businesses, citizens: readonly CitizenSave[] = this.citizens, matureTreeAnchors: readonly THREE.Vector3[] = []) {
    this.cells = [...cells].map((cell) => ({ ...cell }));
    this.businesses = businesses.map((business) => ({ ...business }));
    this.citizens = citizens.map((citizen) => ({ ...citizen, traits: [...citizen.traits], relationships: [...citizen.relationships] }));
    this.topology = analyzeWaterTopology(this.cells, this.seed);
    this.configureMerchantJourney();
    if (this.cells.length) this.townCenter.set(
      this.cells.reduce((sum, cell) => sum + cell.x * WORLD_CELL_SIZE, 0) / this.cells.length,
      0,
      this.cells.reduce((sum, cell) => sum + cell.z * WORLD_CELL_SIZE, 0) / this.cells.length,
    );
    this.fleet.forEach((boat, index) => { boat.route = createWaterRoute(this.cells, this.seed, index * .42); });
    this.fauna.setTown(this.cells, this.businesses, matureTreeAnchors);
    this.syncVesselOccupants();
    this.positionImportYard();
    this.syncProsperityMarketAnchor();
    this.syncLanternSquareAnchors();
    this.syncLanternFinaleVisibility();
    this.refreshFleetVisibility();
  }

  setCargoState(goods: Readonly<Partial<Record<CraftGood, number>>>) {
    this.cargoState = { ...goods };
    for (const [good, models] of this.cargoModels) {
      const amount = this.cargoState[good] ?? 0;
      for (const model of models) model.visible = amount >= ((model.userData.cargoThreshold as number | undefined) ?? 1);
    }
  }

  importSourceCellKey() {
    const dock = this.preferredImportDock();
    return dock ? `${dock.land.x},${dock.land.z}` : undefined;
  }

  activeImportSourceCellKey() {
    return this.merchantDocked ? this.importSourceCellKey() : undefined;
  }

  beginImport(good: CraftGood) {
    if (!IMPORT_GOODS.has(good)) return;
    this.importQueue.push(good as ImportGood);
    if (!this.unloading) this.startNextImport(this.lastUpdateTime);
  }

  setDiscoveryState(discoveries: readonly string[]) {
    const merchantTradeWasActive = this.discoveries.has('merchant-arrival');
    this.discoveries = new Set(discoveries);
    if (!merchantTradeWasActive && this.discoveries.has('merchant-arrival')) {
      const merchant = this.fleet.find((boat) => boat.kind === 'merchant boat');
      if (merchant) merchant.phase = -this.lastUpdateTime * merchant.speed;
      this.merchantCycle = Number.NaN;
      this.merchantLoadedExport = false;
    }
    this.fauna.setDiscoveryState(discoveries);
    this.petals.visible = this.discoveries.has('blossom-tide');
    this.fireflies.visible = this.discoveries.has('evening-chorus');
    this.syncLanternFinaleVisibility();
    this.refreshFleetVisibility();
  }

  startLanternFinale() {
    this.setLanternFinaleStage('lanterns');
  }

  setLanternFinaleStage(stage: LanternFinaleStage) {
    this.lanternFinaleStage = stage;
    this.syncLanternFinaleVisibility();
    this.refreshFleetVisibility();
  }

  lanternFinaleActive() { return this.lanternFinaleStage !== 'complete'; }

  private syncLanternFinaleVisibility() {
    const discovered = this.discoveries.has('lantern-finale');
    this.floatingLanterns.visible = discovered
      && (this.lanternFinaleStage === 'water' || this.lanternFinaleStage === 'fireworks' || this.lanternFinaleStage === 'complete');
    const finale = discovered && this.lanternFinaleStage === 'fireworks';
    const squareParty = Boolean(this.lanternSquareCenter)
      && this.lastTimeOfDay >= 18 && this.lastTimeOfDay < 21.75
      && this.lastRainIntensity < .5;
    this.fireworks.visible = finale || squareParty;
    const finaleParty = discovered && ['gathering', 'water', 'fireworks'].includes(this.lanternFinaleStage);
    this.festivalCrowd.visible = Boolean(this.lanternSquareCenter) && (squareParty || finaleParty);
    this.rooftopCrowd.visible = Boolean(this.rooftopPartyCenter) && (squareParty || finaleParty);
  }

  private syncProsperityMarketAnchor() {
    this.prosperityMarketAnchor = null;
    this.prosperityMarket.visible = false;
    const cells = new Map(this.cells.map((cell) => [`${cell.x},${cell.z}`, cell]));
    const plazas = findPlazaAnchors(cells);
    const arcade = detectFormations(cells).filter((formation) => formation.id === 'arcade-row');
    const plazaStalls = this.prosperityMarket.getObjectByName('prosperity-market-plaza-stalls');
    const arcadeStall = this.prosperityMarket.getObjectByName('prosperity-market-arcade-stall');
    if (plazas.length) {
      const anchor = plazas[Math.floor(hash(this.seed, plazas.length, 0, 9420) * plazas.length) % plazas.length];
      const x = anchor.x + .5;
      const z = anchor.z + .5;
      this.prosperityMarket.position.set(x * WORLD_CELL_SIZE, .2, z * WORLD_CELL_SIZE);
      this.prosperityMarket.rotation.y = 0;
      this.prosperityMarketAnchor = { x, z };
      if (plazaStalls) plazaStalls.visible = true;
      if (arcadeStall) arcadeStall.visible = false;
      return;
    }
    if (!arcade.length) return;
    const formation = arcade[Math.floor(hash(this.seed, arcade.length, 1, 9421) * arcade.length) % arcade.length];
    const cell = cells.get(`${formation.x},${formation.z}`);
    if (!cell) return;
    const exposed = CARDINALS.map((offset, direction) => ({ offset, direction }))
      .filter(({ offset: [dx, dz] }) => !cells.has(`${cell.x + dx},${cell.z + dz}`));
    const front = exposed[Math.floor(hash(this.seed, cell.x, cell.z, 9422) * exposed.length) % exposed.length];
    if (!front) return;
    const [dx, dz] = front.offset;
    const worldX = cell.x * WORLD_CELL_SIZE + dx * 1.55;
    const worldZ = cell.z * WORLD_CELL_SIZE + dz * 1.55;
    this.prosperityMarket.position.set(worldX, .2, worldZ);
    this.prosperityMarket.rotation.y = Math.PI - front.direction * Math.PI / 2;
    this.prosperityMarketAnchor = { x: worldX / WORLD_CELL_SIZE, z: worldZ / WORLD_CELL_SIZE };
    if (plazaStalls) plazaStalls.visible = false;
    if (arcadeStall) arcadeStall.visible = true;
  }

  setPlaceIdentities(identities: readonly PlaceIdentityOccurrence[]) {
    this.placeIdentities = new Set(identities.map((identity) => identity.id));
    this.lanternSquarePlace = identities.find((identity) => identity.id === 'lantern-square') ?? null;
    this.syncLanternSquareAnchors();
    this.syncLanternFinaleVisibility();
    this.refreshFleetVisibility();
  }

  private syncLanternSquareAnchors() {
    const theatre = this.lanternSquarePlace ? placeLandmarkSocket(this.lanternSquarePlace) : null;
    this.lanternSquareCenter = theatre
      ? new THREE.Vector3(theatre.x * WORLD_CELL_SIZE + WORLD_CELL_SIZE / 2, 0, theatre.z * WORLD_CELL_SIZE + WORLD_CELL_SIZE / 2)
      : null;
    if (this.lanternSquareCenter) {
      this.fireworks.position.copy(this.lanternSquareCenter);
      this.festivalCrowd.position.copy(this.lanternSquareCenter).setY(.2);
    } else {
      this.fireworks.position.set(0, 0, 0);
      this.festivalCrowd.position.set(0, 0, 0);
    }

    this.rebuildRooftopParties(Boolean(theatre));
  }

  private rebuildRooftopParties(active: boolean) {
    this.rooftopDancers.length = 0;
    this.rooftopCrowd.position.set(0, 0, 0);
    const cellMap = new Map(this.cells.map((cell) => [`${cell.x},${cell.z}`, cell]));
    const rooftops = active
      ? this.cells.filter((cell) => isWalkableRoof(cell, cellMap)).slice(0, MAX_ROOFTOP_PARTY_ROOFS)
      : [];
    const clothes = [0xd83a32, 0xe4a32b, 0x3d9b79, 0x657eb5, 0xb85872];
    const dummy = this.festivalPartTransform;
    for (const [roofIndex, cell] of rooftops.entries()) {
      const centerX = cell.x * WORLD_CELL_SIZE;
      const centerZ = cell.z * WORLD_CELL_SIZE;
      const y = roofWalkY(cell.height) + .02;
      const turn = hash(this.seed, cell.x, cell.z, 1920) * Math.PI * 2;
      for (let dancerIndex = 0; dancerIndex < DANCERS_PER_ROOF; dancerIndex++) {
        const index = roofIndex * DANCERS_PER_ROOF + dancerIndex;
        const angle = turn + dancerIndex / DANCERS_PER_ROOF * Math.PI * 2;
        const radius = .34 + hash(this.seed, cell.x + dancerIndex, cell.z, 1921) * .16;
        this.rooftopDancers.push(Object.freeze({
          x: centerX + Math.cos(angle) * radius,
          y,
          z: centerZ + Math.sin(angle) * radius,
          centerX,
          centerZ,
          phase: hash(this.seed, roofIndex, dancerIndex, 1922) * Math.PI * 2,
          scale: .78 + hash(this.seed, roofIndex, dancerIndex, 1923) * .2,
        }));
        this.rooftopCrowdBatches.bodies.setColorAt(index, new THREE.Color(clothes[(roofIndex + dancerIndex) % clothes.length]));
      }
      for (let lanternIndex = 0; lanternIndex < 2; lanternIndex++) {
        const angle = turn + lanternIndex * Math.PI;
        dummy.position.set(centerX + Math.cos(angle) * .7, y + .73, centerZ + Math.sin(angle) * .7);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(1, 1.3, 1);
        dummy.updateMatrix();
        this.rooftopLanterns.setMatrixAt(roofIndex * 2 + lanternIndex, dummy.matrix);
      }
    }
    const dancerCount = this.rooftopDancers.length;
    this.rooftopCrowdBatches.bodies.count = dancerCount;
    this.rooftopCrowdBatches.heads.count = dancerCount;
    this.rooftopCrowdBatches.arms.count = dancerCount * 2;
    this.rooftopCrowdBatches.legs.count = dancerCount * 2;
    if (this.rooftopCrowdBatches.bodies.instanceColor) this.rooftopCrowdBatches.bodies.instanceColor.needsUpdate = true;
    this.rooftopLanterns.count = rooftops.length * 2;
    if (this.rooftopLanterns.count) this.rooftopLanterns.instanceMatrix.needsUpdate = true;
    const lightCount = Math.min(rooftops.length, this.rooftopPartyLights.length);
    this.rooftopPartyLights.forEach((light, index) => {
      light.visible = index < lightCount;
      if (!light.visible) return;
      const cell = rooftops[Math.floor(index * rooftops.length / lightCount)];
      light.position.set(cell.x * WORLD_CELL_SIZE, roofWalkY(cell.height) + 1.05, cell.z * WORLD_CELL_SIZE);
    });
    this.rooftopPartyCenter = rooftops.length
      ? new THREE.Vector3(rooftops[0].x * WORLD_CELL_SIZE, roofWalkY(rooftops[0].height), rooftops[0].z * WORLD_CELL_SIZE)
      : null;
    this.rooftopCrowd.userData.partyRoofCount = rooftops.length;
    this.updateFestivalCrowd(this.lastUpdateTime, true);
  }

  waterTopology() { return this.topology; }

  activeFleet() { return this.fleet.filter((boat) => boat.model.visible).map((boat) => boat.kind); }

  wildlifeStats() { return this.fauna.stats(); }

  wildlifeMemoryFromObject(object: THREE.Object3D | null, absoluteHours: number, colonyFoundedAt?: number, instanceId?: number): WildlifeMemoryInspection | null {
    return this.fauna.wildlifeMemoryFromObject(object, absoluteHours, colonyFoundedAt, instanceId);
  }

  memoryFromObject(object: THREE.Object3D | null, absoluteHours: number, colonyFoundedAt?: number, instanceId?: number): HarborMemoryInspection | null {
    const wildlife = this.wildlifeMemoryFromObject(object, absoluteHours, colonyFoundedAt, instanceId);
    if (wildlife) return wildlife;
    if (!object) return null;
    let current: THREE.Object3D | null = object;
    while (current && current !== this.root) {
      const kind = current.userData.boatKind as BoatKind | undefined;
      if (kind) return this.boatObservation(kind, current);
      if (current.userData.importYard) return this.importYardObservation();
      current = current.parent;
    }
    return null;
  }

  wildlifeEffect(action: WildlifeAction, animal: WildlifeKind, focus?: { x: number; z: number } | null) {
    this.fauna.apply(action, animal, focus);
  }

  scatterWildlife(x: number, z: number) { this.fauna.scatterAt(x, z); }

  update(time: number, daylight: number, timeOfDay: number, absoluteHours: number, catColonyFoundedAt?: number, rainIntensity = 0): HarborUpdate {
    this.lastUpdateTime = time;
    this.lastTimeOfDay = timeOfDay;
    this.lastRainIntensity = rainIntensity;
    this.syncLanternFinaleVisibility();
    const marketWasOpen = this.prosperityMarket.visible;
    const marketDay = Math.floor(absoluteHours / 24);
    const marketOffset = Math.floor(hash(this.seed, 0, 0, 9440) * 3);
    const marketOpen = Boolean(this.prosperityMarketAnchor)
      && townProsperityLevel(this.businesses) === 2
      && (marketDay + marketOffset) % 3 === 0
      && timeOfDay >= 9.5
      && timeOfDay < 16
      && rainIntensity < .45;
    this.prosperityMarket.visible = marketOpen;
    const prosperityMarketOpened = marketOpen && !marketWasOpen && this.prosperityMarketAnchor
      ? { ...this.prosperityMarketAnchor }
      : undefined;
    let exportDeparture: HarborUpdate['exportDeparture'];
    for (const boat of this.fleet) {
      if (boat.kind === 'merchant boat' && this.discoveries.has('merchant-arrival') && this.preferredImportDock()) {
        if (this.updateMerchantJourney(boat, time, timeOfDay)) exportDeparture = { good: 'harbor-goods', capacity: 4 };
        continue;
      }
      if (boat.kind === 'merchant boat') this.merchantDocked = false;
      boat.model.visible = boat.eligible && this.boatOnShift(boat.kind, timeOfDay);
      if (!boat.model.visible) continue;
      const progress = (time * boat.speed + boat.phase) % 1;
      const point = boat.route.getPointAt(progress);
      const tangent = boat.route.getTangentAt(progress);
      boat.model.position.copy(point);
      boat.model.position.y += Math.sin(time * boat.bobSpeed + boat.phase * 8) * .055;
      // Hulls are modeled lengthwise on local X, so offset Three's +Z-style heading
      // by a quarter turn. Without this, the fleet travels broadside along its route.
      boat.model.rotation.y = Math.atan2(tangent.x, tangent.z) - Math.PI / 2;
      boat.model.rotation.x = Math.sin(time * boat.bobSpeed * .63 + boat.phase * 4) * .016;
      boat.model.rotation.z = Math.sin(time * boat.bobSpeed * .78 + boat.phase * 5) * .028;
      if (boat.kind === 'fishing boat') this.updateFishingWork(boat, time, timeOfDay);
    }
    this.updateImportYard(time, timeOfDay);
    this.fauna.update(time, daylight, timeOfDay, absoluteHours, catColonyFoundedAt, rainIntensity);
    this.clouds.position.x = Math.sin(time * .018) * 2.5;
    this.cloudMaterial.opacity = .12 + daylight * .32;
    this.starMaterial.opacity = Math.pow(1 - daylight, 2) * (.62 + Math.sin(time * .7) * .08);
    this.sunDisc.material.opacity = daylight * .68;
    this.petals.rotation.y = time * .025;
    this.petals.position.y = Math.sin(time * .18) * .45;
    this.petals.material.opacity = .2 + daylight * .65;
    this.fireflies.rotation.y = -time * .018;
    this.fireflies.material.opacity = Math.pow(1 - daylight, 1.6) * (.55 + Math.sin(time * 1.7) * .2);
    this.floatingLanterns.position.y = -.08 + Math.sin(time * .8) * .025;
    this.floatingLanterns.rotation.y = time * .008;
    this.floatingLanterns.material.opacity = Math.pow(1 - daylight, 1.3) * .92;
    const fireworkBurst = this.fireworks.visible ? this.updateFireworks(time, daylight) : undefined;
    if (this.festivalCrowd.visible) this.updateFestivalCrowd(time, false);
    if (this.rooftopCrowd.visible) this.updateFestivalCrowd(time, true);
    this.updateRain(time, rainIntensity);
    return { exportDeparture, fireworkBurst, prosperityMarketOpened };
  }

  private createRain() {
    const positions = new Float32Array(260 * 3);
    for (let index = 0; index < 260; index++) {
      positions[index * 3] = (hash(this.seed, index, 0, 8900) - .5) * 34;
      positions[index * 3 + 1] = 1 + hash(this.seed, index, 1, 8901) * 14;
      positions[index * 3 + 2] = (hash(this.seed, index, 2, 8902) - .5) * 30;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const material = new THREE.PointsMaterial({ color: 0xb8d9d7, size: .055, transparent: true, opacity: 0, depthWrite: false });
    return new THREE.Points(geometry, material);
  }

  private updateRain(time: number, intensity: number) {
    this.rain.visible = intensity > .025;
    this.rain.material.opacity = intensity * .62;
    if (!this.rain.visible) return;
    this.rain.position.set(this.townCenter.x, 0, this.townCenter.z);
    const positions = this.rain.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let index = 0; index < positions.count; index++) {
      const baseY = 1 + hash(this.seed, index, 1, 8901) * 14;
      positions.setY(index, 1 + ((baseY - time * (7 + intensity * 8)) % 14 + 14) % 14);
      positions.setX(index, (hash(this.seed, index, 0, 8900) - .5) * 34 - time * .18 % 2);
    }
    positions.needsUpdate = true;
  }

  private createImportCargo(good: ImportGood, scale = 1) {
    const cargo = new THREE.Group();
    if (good === 'grain') {
      const canvas = new THREE.MeshStandardMaterial({ color: 0xd5bd82, roughness: 1 });
      for (const offset of [-.065, .065]) {
        const sack = new THREE.Mesh(new THREE.CapsuleGeometry(.065, .11, 2, 6), canvas);
        sack.position.z = offset;
        sack.rotation.z = Math.PI / 2;
        cargo.add(sack);
      }
    } else if (good === 'timber') {
      const wood = new THREE.MeshStandardMaterial({ color: 0x8d613c, roughness: 1 });
      for (let index = 0; index < 3; index++) {
        const log = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .3, 6), wood);
        log.position.set(0, index * .065, (index - 1) * .052);
        log.rotation.z = Math.PI / 2;
        cargo.add(log);
      }
    } else if (good === 'clay') {
      const terracotta = new THREE.MeshStandardMaterial({ color: 0xaa644b, roughness: 1 });
      for (const offset of [-.065, .065]) {
        const jar = new THREE.Mesh(new THREE.CylinderGeometry(.042, .072, .17, 7), terracotta);
        jar.position.set(0, .085, offset);
        cargo.add(jar);
      }
    } else {
      const fiber = new THREE.MeshStandardMaterial({ color: 0xaca16f, roughness: 1 });
      const bale = new THREE.Mesh(new THREE.BoxGeometry(.27, .16, .2), fiber);
      bale.rotation.y = .1;
      cargo.add(bale);
    }
    cargo.scale.setScalar(scale);
    cargo.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = true; });
    return consolidateModel(cargo);
  }

  private createImportYard() {
    const yard = new THREE.Group();
    yard.name = 'dockside-import-yard';
    yard.userData.importYard = true;

    const wood = new THREE.MeshStandardMaterial({ color: 0x76513b, roughness: 1 });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x44372e, roughness: 1 });
    const canvas = new THREE.MeshStandardMaterial({ color: 0xdfc684, roughness: 1 });
    const redCanvas = new THREE.MeshStandardMaterial({ color: 0xb44f43, roughness: .94 });
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x426a6d, roughness: .94, side: THREE.DoubleSide });

    const platform = new THREE.Mesh(new THREE.BoxGeometry(1.58, .14, 1.55), wood);
    platform.name = 'import-platform';
    platform.position.y = .04;
    platform.castShadow = true;
    yard.add(platform);
    for (const x of [-.7, .7]) for (const z of [-.66, .66]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, .64, 6), darkWood);
      post.position.set(x, .3, z);
      post.castShadow = true;
      yard.add(post);
    }
    for (const x of [-.55, .55]) {
      const canopyPost = new THREE.Mesh(new THREE.CylinderGeometry(.025, .03, .9, 6), darkWood);
      canopyPost.position.set(x, .52, -.48);
      yard.add(canopyPost);
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(1.34, .055, .5), canvas);
    canopy.position.set(0, .98, -.48);
    const canopyStripe = new THREE.Mesh(new THREE.BoxGeometry(.42, .062, .51), redCanvas);
    canopyStripe.position.set(0, .985, -.48);
    yard.add(canopy, canopyStripe);

    const positions: Record<ImportGood, readonly [number, number]> = {
      grain: [-.38, -.32], timber: [.34, -.32], clay: [-.38, .18], fiber: [.34, .18],
    };
    for (const good of ['grain', 'timber', 'clay', 'fiber'] satisfies ImportGood[]) {
      const [x, z] = positions[good];
      for (const [index, threshold] of [1, 7].entries()) {
        const stock = this.createImportCargo(good, .86);
        stock.name = `import-store-${good}-${index + 1}`;
        stock.position.set(x + index * .08, .14 + index * .16, z + index * .07);
        stock.rotation.y = index * .22 - .08;
        this.registerCargo(good, stock, threshold);
        yard.add(stock);
      }
      const unloading = this.createImportCargo(good, .9);
      unloading.name = `unloading-${good}`;
      unloading.visible = false;
      yard.add(unloading);
    }

    const lighter = new THREE.Group();
    lighter.name = 'import-lighter';
    // The dock finishes at local z=.775. Keep the lighter parallel to its end
    // with visible water between the hull and timbers instead of intersecting
    // the platform at one corner.
    lighter.position.set(0, 0, 1.18);
    lighter.userData.mooringClearance = .18;
    const hull = new THREE.Mesh(createHullGeometry(1.35, .46, .25), hullMaterial);
    hull.position.y = .02;
    const deck = new THREE.Mesh(createDeckGeometry(1.25, .4), canvas);
    deck.position.y = .13;
    hull.castShadow = true;
    deck.castShadow = true;
    addGunwales(lighter, 1.32, .46, darkWood);
    const boatman = createDeckPerson('import-lighter-boatman', 0x9b594b, 'crew', .68);
    boatman.position.set(-.31, .14, -.04);
    boatman.rotation.y = Math.PI;
    const deckhand = createDeckPerson('import-lighter-deckhand', 0xc7774e, 'worker', .66);
    deckhand.position.set(.18, .14, -.1);
    deckhand.rotation.y = Math.PI;
    lighter.add(hull, deck, boatman, deckhand);
    consolidateModel(lighter);
    yard.add(lighter);

    const gangplank = new THREE.Mesh(new THREE.BoxGeometry(.38, .045, .34), canvas);
    gangplank.name = 'import-gangplank';
    gangplank.position.set(.18, .13, .9);
    gangplank.rotation.x = -.08;
    gangplank.castShadow = true;
    yard.add(gangplank);

    const porter = createDeckPerson('import-dock-porter', 0x456f73, 'worker', .76);
    porter.position.set(.12, .13, .61);
    porter.rotation.y = Math.PI;
    yard.add(porter);

    yard.traverse((object) => { if (object instanceof THREE.Mesh) object.castShadow = true; });
    yard.visible = false;
    return consolidateModel(yard);
  }

  private createFleet() {
    const emptyRoute = createWaterRoute([], this.seed);
    const rowboat = this.createRowboat();
    const fishingBoat = this.createFishingBoat();
    const merchantBoat = this.createMerchantBoat();
    const signalBoat = this.createSignalBoat();
    const ferry = this.createFerry();
    this.fleet.push(
      { kind: 'rowboat', model: rowboat, route: emptyRoute, phase: .08, speed: .012, bobSpeed: 1.15, eligible: false },
      { kind: 'fishing boat', model: fishingBoat, route: emptyRoute, phase: .42, speed: .009, bobSpeed: 1.4, eligible: false },
      { kind: 'merchant boat', model: merchantBoat, route: emptyRoute, phase: 0, speed: .014, bobSpeed: 1.05, eligible: false },
      { kind: 'signal boat', model: signalBoat, route: emptyRoute, phase: .79, speed: .01, bobSpeed: 1.22, eligible: false },
      { kind: 'ferry', model: ferry, route: emptyRoute, phase: .87, speed: .0075, bobSpeed: .92, eligible: false },
    );
    for (const boat of this.fleet) {
      boat.model.name = boat.kind.replaceAll(' ', '-');
      boat.model.userData.boatKind = boat.kind;
      addPickSphere(boat.model, boat.kind === 'rowboat' ? .72 : boat.kind === 'merchant boat' || boat.kind === 'ferry' ? 1.28 : 1.12);
      boat.model.visible = false;
      this.root.add(boat.model);
    }
  }

  private boatObservation(kind: BoatKind, model: THREE.Object3D): BoatMemoryInspection | null {
    for (let current: THREE.Object3D | null = model; current && current !== this.root.parent; current = current.parent) {
      if (!current.visible) return null;
    }
    const fishOnDeck = this.cargoState.fish ?? 0;
    const merchantCargo = (['grain', 'timber', 'clay', 'fiber', 'harbor-goods'] satisfies CraftGood[])
      .filter((good) => (this.cargoState[good] ?? 0) > 0)
      .map((good) => good.replace('-', ' '));
    const merchantMakesJourney = this.discoveries.has('merchant-arrival') && Boolean(this.preferredImportDock());
    const merchantJourneyDetail = this.merchantDocked
      ? `Moored beside the import yard, it is landing raw materials${this.merchantLoadedExport ? ' and taking finished harbor goods aboard' : ''}.`
      : this.merchantJourneyPhase < .38
        ? 'It is arriving from open water with grain, straight timber, river clay, and loom fiber on deck.'
        : this.merchantLoadedExport
          ? 'It is heading back to open water with the harbor\'s finished export crates.'
          : 'It is heading back beyond the harbor after making its call.';
    let passengerCount = 0;
    model.traverse((object) => { if (object.userData.vesselPassenger && object.visible) passengerCount += 1; });
    const observations: Record<BoatKind, Omit<BoatMemoryInspection, 'kind'>> = {
      rowboat: {
        title: 'Harbor rowboat', ageLabel: 'Shoreline wanderer',
        detail: 'A rowboat loops around the exposed edge of town.',
        note: 'Its route updates whenever new buildings change the shoreline.',
      },
      'fishing boat': {
        title: 'Working fishing boat', ageLabel: 'Harbor working vessel',
        detail: `The fishing crew follows the shoreline in search of the morning catch.${fishOnDeck ? ` ${Math.min(3, Math.ceil(fishOnDeck / 2))} silver ${fishOnDeck < 3 ? 'fish lies' : 'fish lie'} on the working deck.` : ''}`,
        note: 'It sails at dawn and late afternoon when the harbor has a dock and a fisher. A second fisher joins once the town has a full crew.',
      },
      'merchant boat': {
        title: 'Merchant boat', ageLabel: 'Visiting cargo vessel',
        detail: merchantMakesJourney ? merchantJourneyDetail : merchantCargo.length
          ? `The working deck carries ${merchantCargo.join(', ')}.`
          : 'The working deck is empty until the next shipment.',
        note: merchantMakesJourney
          ? 'Each trip starts in open water, stops at the working dock, then returns beyond the harbor.'
          : this.placeIdentities.has('canal-market')
          ? 'The market barge\'s painted awning draws it toward the town before evening.'
          : 'A working dock gives it somewhere to unload before evening.',
      },
      'signal boat': {
        title: 'Beacon survey boat', ageLabel: 'Outer-water scout',
        detail: 'A blue-sailed survey boat follows the harbor edge using signals from the roofs.',
        note: 'It appears only while a High Harbor keeps its signal beacon.',
      },
      ferry: {
        title: 'Harbor ferry', ageLabel: 'Daily passenger vessel',
        detail: `The ferry makes a steady circuit between the town and the open water with its skipper${passengerCount ? ` and ${passengerCount} ${passengerCount === 1 ? 'traveler' : 'travelers'}` : ''} aboard.`,
        note: this.placeIdentities.has('ferry-quarter')
          ? 'The Ferry House gives it a dependable landing and a square full of waiting passengers.'
          : 'Its late route depends on a dock and a welcoming inn.',
      },
    };
    return { kind: 'boat', ...observations[kind] };
  }

  private refreshFleetVisibility() {
    if (!this.topology) return;
    const hasDock = this.topology.docks.length > 0;
    const hasImportDock = Boolean(this.importDock);
    const hasInn = this.businesses.some((business) => business.type === 'inn');
    const hasFisher = this.citizens.some((citizen) => citizen.occupation === 'Fisher');
    for (const boat of this.fleet) {
      if (boat.kind === 'rowboat') boat.eligible = this.cells.length > 0;
      if (boat.kind === 'fishing boat') boat.eligible = hasDock && hasFisher && this.discoveries.has('fishing-boat');
      if (boat.kind === 'merchant boat') boat.eligible = (hasImportDock && this.discoveries.has('merchant-arrival')) || this.placeIdentities.has('canal-market');
      if (boat.kind === 'signal boat') boat.eligible = this.placeIdentities.has('high-harbor');
      if (boat.kind === 'ferry') boat.eligible = this.placeIdentities.has('ferry-quarter') || (hasDock && hasInn && this.discoveries.has('ferry-route'));
      boat.model.visible = boat.eligible;
    }
    this.importYard.visible = hasImportDock && this.discoveries.has('merchant-arrival');
  }

  private preferredImportDock() {
    return this.importDock;
  }

  private configureMerchantJourney() {
    this.importDock = undefined;
    this.merchantInboundRoute = undefined;
    this.merchantOutboundRoute = undefined;
    if (!this.topology?.docks.length) return;
    const sheltered = new Set(this.topology.sheltered.map((point) => `${point.x},${point.z}`));
    const occupied = new Set(this.cells.map((cell) => `${cell.x},${cell.z}`));
    const candidates = this.topology.docks.map((dock) => {
      const outwardX = dock.water.x - dock.land.x;
      const outwardZ = dock.water.z - dock.land.z;
      const lateralX = outwardZ;
      const lateralZ = -outwardX;
      const openSides = [-1, 1].filter((side) => !occupied.has(`${dock.water.x + lateralX * side},${dock.water.z + lateralZ * side}`)).length;
      return { dock, openSides };
    }).sort((a, b) => {
      const navigationDifference = b.openSides - a.openSides;
      if (navigationDifference) return navigationDifference;
      const { dock: dockA } = a;
      const { dock: dockB } = b;
      const shelterDifference = Number(sheltered.has(`${dockB.water.x},${dockB.water.z}`)) - Number(sheltered.has(`${dockA.water.x},${dockA.water.z}`));
      if (shelterDifference) return shelterDifference;
      return hash(this.seed, dockB.land.x, dockB.land.z, 2370 + dockB.direction)
        - hash(this.seed, dockA.land.x, dockA.land.z, 2370 + dockA.direction);
    });
    let selected: { dock: ShorelineEdge; positive: readonly WaterPoint[]; negative: readonly WaterPoint[] } | undefined;
    for (const { dock } of candidates) {
      const positive = createDockNavigationPath(this.cells, dock, 1);
      const negative = createDockNavigationPath(this.cells, dock, -1);
      if (positive.length || negative.length) {
        selected = { dock, positive, negative };
        break;
      }
    }
    if (!selected) return;
    this.importDock = selected.dock;
    const inboundSide: -1 | 1 = selected.positive.length ? 1 : -1;
    const outboundSide: -1 | 1 = selected.negative.length ? -1 : inboundSide;
    const inboundPath = inboundSide === 1 ? selected.positive : selected.negative;
    const outboundPath = outboundSide === 1 ? selected.positive : selected.negative;
    this.merchantArrivalPoint.copy(this.merchantBerthPoint(selected.dock, inboundSide));
    this.merchantDeparturePoint.copy(this.merchantBerthPoint(selected.dock, outboundSide));
    this.merchantInboundRoute = this.createMerchantWaterCurve(selected.dock, this.merchantArrivalPoint, inboundPath);
    this.merchantOutboundRoute = this.createMerchantWaterCurve(selected.dock, this.merchantDeparturePoint, outboundPath);
  }

  private merchantBerthPoint(dock: ShorelineEdge, side: -1 | 1) {
    const outward = new THREE.Vector3(dock.water.x - dock.land.x, 0, dock.water.z - dock.land.z);
    const lateral = new THREE.Vector3(outward.z, 0, -outward.x);
    return new THREE.Vector3(dock.land.x * WORLD_CELL_SIZE, -.08, dock.land.z * WORLD_CELL_SIZE)
      .addScaledVector(outward, WORLD_CELL_SIZE * 1.29)
      .addScaledVector(lateral, 1.38 * side);
  }

  private createMerchantWaterCurve(dock: ShorelineEdge, berth: THREE.Vector3, path: readonly WaterPoint[]) {
    const lateral = new THREE.Vector3(dock.water.z - dock.land.z, 0, dock.land.x - dock.water.x);
    const turnCell = new THREE.Vector3(path[0].x * WORLD_CELL_SIZE, -.08, path[0].z * WORLD_CELL_SIZE);
    const waterfrontRun = berth.clone().addScaledVector(lateral, turnCell.clone().sub(berth).dot(lateral));
    const points = [
      berth.clone(),
      waterfrontRun,
      ...path.map((point) => new THREE.Vector3(point.x * WORLD_CELL_SIZE, -.08, point.z * WORLD_CELL_SIZE)),
    ].filter((point, index, all) => index === 0 || point.distanceToSquared(all[index - 1]) > .0001);
    const curve = new THREE.CurvePath<THREE.Vector3>();
    let cursor = points[0];
    const cornerRadius = WORLD_CELL_SIZE * .18;
    for (let index = 1; index < points.length - 1; index++) {
      const before = points[index - 1];
      const corner = points[index];
      const after = points[index + 1];
      const incoming = corner.clone().sub(before).normalize();
      const outgoing = after.clone().sub(corner).normalize();
      if (incoming.dot(outgoing) > .999) continue;
      const radius = Math.min(cornerRadius, corner.distanceTo(before) * .32, corner.distanceTo(after) * .32);
      const cornerStart = corner.clone().addScaledVector(incoming, -radius);
      const cornerEnd = corner.clone().addScaledVector(outgoing, radius);
      if (cursor.distanceToSquared(cornerStart) > .0001) curve.add(new THREE.LineCurve3(cursor, cornerStart));
      curve.add(new THREE.QuadraticBezierCurve3(cornerStart, corner, cornerEnd));
      cursor = cornerEnd;
    }
    const end = points[points.length - 1];
    if (cursor.distanceToSquared(end) > .0001) curve.add(new THREE.LineCurve3(cursor, end));
    return curve;
  }

  private positionImportYard() {
    const dock = this.preferredImportDock();
    if (!dock) {
      this.importYard.visible = false;
      return;
    }
    const dx = dock.water.x - dock.land.x;
    const dz = dock.water.z - dock.land.z;
    this.importYard.position.set(
      (dock.land.x + dx * .77) * WORLD_CELL_SIZE,
      0,
      (dock.land.z + dz * .77) * WORLD_CELL_SIZE,
    );
    this.importYard.rotation.y = Math.atan2(dx, dz);
  }

  private importYardObservation(): ImportYardMemoryInspection | null {
    if (!this.importYard.visible) return null;
    const stored = (['grain', 'timber', 'clay', 'fiber'] satisfies ImportGood[])
      .filter((good) => (this.cargoState[good] ?? 0) > 0)
      .map((good) => `${this.cargoState[good]} ${good}`);
    return {
      kind: 'harbor-feature',
      title: 'Dockside import yard',
      ageLabel: 'Working quay store',
      detail: stored.length
        ? `The open store currently holds ${stored.join(', ')} from beyond the harbor.`
        : 'The marked bays are empty, waiting for the next tide-borne shipment.',
      note: this.unloading
        ? `Dockworkers are carrying ${this.unloading.good} ashore now.`
        : 'The town cannot make grain, straight timber, river clay, or loom fiber. Merchant crews carry them ashore here.',
    };
  }

  private registerCargo(good: CraftGood, model: THREE.Object3D, threshold = 1) {
    model.userData.cargoGood = good;
    model.userData.cargoThreshold = threshold;
    model.visible = (this.cargoState[good] ?? 0) >= threshold;
    const models = this.cargoModels.get(good) ?? [];
    models.push(model);
    this.cargoModels.set(good, models);
  }

  private startNextImport(time: number) {
    const good = this.importQueue.shift();
    if (!good) return;
    this.unloading = { good, startedAt: time };
    const parcel = this.importYard.getObjectByName(`unloading-${good}`);
    if (parcel) parcel.visible = true;
  }

  private updateImportYard(time: number, hour: number) {
    const lighter = this.importYard.getObjectByName('import-lighter');
    const deckhand = this.importYard.getObjectByName('import-lighter-deckhand');
    const porter = this.importYard.getObjectByName('import-dock-porter');
    if (lighter) {
      lighter.visible = (hour >= 7.5 && hour < 19) || Boolean(this.unloading);
      lighter.position.y = Math.sin(time * 1.15) * .035;
      lighter.rotation.z = Math.sin(time * .83) * .018;
    }
    if (porter) porter.visible = (hour >= 7.5 && hour < 19) || Boolean(this.unloading);
    if (!this.unloading) {
      if (deckhand) {
        deckhand.position.set(.18, .14, -.1);
        deckhand.rotation.set(0, Math.PI, 0);
      }
      if (porter) {
        porter.position.set(.12, .13, .61);
        porter.rotation.set(0, Math.PI, 0);
      }
      this.startNextImport(time);
      if (!this.unloading) return;
    }
    const parcel = this.importYard.getObjectByName(`unloading-${this.unloading.good}`);
    const progress = Math.max(0, (time - this.unloading.startedAt) / 4.2);
    if (!parcel || progress >= 1) {
      if (parcel) parcel.visible = false;
      this.unloading = undefined;
      this.startNextImport(time);
      return;
    }
    const smooth = (value: number) => value * value * (3 - 2 * value);
    const dropX: Record<ImportGood, number> = { grain: -.38, timber: .34, clay: -.38, fiber: .34 };
    const dropZ: Record<ImportGood, number> = { grain: -.32, timber: -.32, clay: .18, fiber: .18 };
    const destinationX = dropX[this.unloading.good];
    const destinationZ = dropZ[this.unloading.good];
    let carrierX: number;
    let carrierZ: number;
    let cargoY = .34;
    if (progress < .24) {
      // A deckhand brings the parcel across the short gangplank.
      const phase = smooth(progress / .24);
      carrierX = THREE.MathUtils.lerp(.18, .12, phase);
      carrierZ = THREE.MathUtils.lerp(1.08, .63, phase);
      if (deckhand) {
        deckhand.position.set(carrierX - (lighter?.position.x ?? 0), .14, carrierZ - 1.18);
        deckhand.rotation.set(-Math.sin(phase * Math.PI) * .08, Math.PI, 0);
      }
      if (porter) porter.position.set(.12, .13, .57);
    } else {
      // The porter takes over on solid decking, walks to the marked bay, then
      // bends to set the load down. Cargo stays at hand height throughout.
      const carry = smooth(Math.min(1, (progress - .24) / .6));
      carrierX = THREE.MathUtils.lerp(.12, destinationX, carry);
      carrierZ = THREE.MathUtils.lerp(.57, destinationZ, carry);
      if (porter) {
        porter.position.set(carrierX, .13 + Math.abs(Math.sin(carry * Math.PI * 6)) * .025, carrierZ);
        porter.rotation.y = Math.atan2(destinationX - carrierX, destinationZ - carrierZ || .001);
        porter.rotation.x = progress > .84 ? (progress - .84) / .16 * .28 : 0;
      }
      if (deckhand) {
        deckhand.position.set(.12, .14, -.55);
        deckhand.rotation.set(0, Math.PI, 0);
      }
      if (progress > .84) cargoY = THREE.MathUtils.lerp(.34, .14, smooth((progress - .84) / .16));
    }
    parcel.visible = true;
    parcel.position.set(carrierX, cargoY, carrierZ);
    parcel.rotation.y = progress * .18;
  }

  private updateMerchantJourney(boat: BoatActor, time: number, hour: number) {
    const dock = this.preferredImportDock();
    const inboundRoute = this.merchantInboundRoute;
    const outboundRoute = this.merchantOutboundRoute;
    const onDuty = Boolean(dock && inboundRoute && outboundRoute) && boat.eligible && this.boatOnShift(boat.kind, hour);
    if (!dock || !inboundRoute || !outboundRoute || !onDuty) {
      boat.model.visible = false;
      this.merchantDocked = false;
      this.merchantWasOnDuty = false;
      this.updateMerchantCargo(boat, false, false);
      return false;
    }
    if (!this.merchantWasOnDuty) {
      boat.phase = -time * boat.speed;
      this.merchantCycle = Number.NaN;
      this.merchantLoadedExport = false;
    }
    this.merchantWasOnDuty = true;

    const journey = time * boat.speed + boat.phase;
    const cycle = Math.floor(journey);
    const phase = ((journey % 1) + 1) % 1;
    const dockStart = .38;
    const dockEnd = .6;
    const outsideAt = .94;
    let exportDeparture = false;
    if (cycle !== this.merchantCycle) {
      if (Number.isFinite(this.merchantCycle) && this.merchantLoadedExport && this.merchantShippedCycle !== this.merchantCycle) {
        this.merchantShippedCycle = this.merchantCycle;
        exportDeparture = true;
      }
      this.merchantCycle = cycle;
      this.merchantLoadedExport = false;
    }
    this.merchantJourneyPhase = phase;
    this.merchantDocked = phase >= dockStart && phase < dockEnd;
    if (this.merchantDocked && (this.cargoState['harbor-goods'] ?? 0) > 0) this.merchantLoadedExport = true;

    const direction = new THREE.Vector3();
    if (phase < dockStart) {
      const routeProgress = 1 - phase / dockStart;
      inboundRoute.getPointAt(routeProgress, boat.model.position);
      inboundRoute.getTangentAt(routeProgress, direction).multiplyScalar(-1);
    } else if (phase < dockEnd) {
      const dockProgress = (phase - dockStart) / (dockEnd - dockStart);
      boat.model.position.lerpVectors(this.merchantArrivalPoint, this.merchantDeparturePoint, dockProgress);
      direction.copy(this.merchantDeparturePoint).sub(this.merchantArrivalPoint);
      if (direction.lengthSq() <= .0001) inboundRoute.getTangentAt(0, direction).multiplyScalar(-1);
    } else if (phase < outsideAt) {
      const routeProgress = (phase - dockEnd) / (outsideAt - dockEnd);
      outboundRoute.getPointAt(routeProgress, boat.model.position);
      outboundRoute.getTangentAt(routeProgress, direction);
    } else {
      outboundRoute.getPointAt(1, boat.model.position);
      outboundRoute.getTangentAt(1, direction);
    }

    boat.model.visible = phase < outsideAt;
    boat.model.position.y += Math.sin(time * boat.bobSpeed) * .045;
    if (direction.lengthSq() > .0001) boat.model.rotation.y = Math.atan2(direction.x, direction.z) - Math.PI / 2;
    boat.model.rotation.x = Math.sin(time * boat.bobSpeed * .63) * .014;
    boat.model.rotation.z = Math.sin(time * boat.bobSpeed * .78) * .024;
    this.updateMerchantCargo(boat, phase < dockEnd, phase >= dockStart && phase < outsideAt);

    if (phase >= outsideAt && this.merchantLoadedExport && this.merchantShippedCycle !== cycle) {
      this.merchantShippedCycle = cycle;
      exportDeparture = true;
    }
    return exportDeparture;
  }

  private updateMerchantCargo(boat: BoatActor, incoming: boolean, outgoing: boolean) {
    for (const good of ['grain', 'timber', 'clay', 'fiber'] satisfies ImportGood[]) {
      const cargo = boat.model.getObjectByName(`merchant-cargo-${good}`);
      if (cargo) cargo.visible = incoming;
    }
    const exportCargo = boat.model.getObjectByName('merchant-cargo-harbor-goods');
    if (exportCargo) exportCargo.visible = outgoing && this.merchantLoadedExport;
  }

  private syncVesselOccupants() {
    const fisherCount = this.citizens.filter((citizen) => citizen.occupation === 'Fisher').length;
    const secondFisher = this.root.getObjectByName('fishing-deckhand');
    if (secondFisher) secondFisher.visible = fisherCount >= 2;
    const merchantDeckhand = this.root.getObjectByName('merchant-deckhand');
    if (merchantDeckhand) merchantDeckhand.visible = this.citizens.length >= 8;
    const passengers = [
      this.root.getObjectByName('ferry-passenger-1'),
      this.root.getObjectByName('ferry-passenger-2'),
      this.root.getObjectByName('ferry-passenger-3'),
    ];
    const passengerCount = Math.min(passengers.length, Math.max(1, Math.floor(this.citizens.length / 6)));
    passengers.forEach((passenger, index) => { if (passenger) passenger.visible = index < passengerCount; });
  }

  private boatOnShift(kind: BoatKind, hour: number) {
    if (this.lanternFinaleActive() && hour >= 19 && hour < 23) return true;
    if (kind === 'fishing boat') return (hour >= 4.5 && hour < 11.5) || (hour >= 15.5 && hour < 18.5);
    if (kind === 'merchant boat') return hour >= 8 && hour < 18.5;
    if (kind === 'signal boat') return hour >= 5.5 && hour < 19.5;
    if (kind === 'ferry') return hour >= 6 && hour < 23;
    return hour >= 6.5 && hour < 20.5;
  }

  private updateFishingWork(boat: BoatActor, time: number, hour: number) {
    const net = boat.model.getObjectByName('cast-net');
    const canopy = boat.model.getObjectByName('cast-net-canopy');
    const handline = boat.model.getObjectByName('cast-net-handline');
    const splash = boat.model.getObjectByName('cast-net-splash');
    const fisher = boat.model.getObjectByName('fishing-skipper');
    const castingArm = boat.model.getObjectByName('casting-arm');
    if (!net) return;
    const working = hour >= 5.25 && hour < 10.75;
    const cast = (time * .075 + boat.phase) % 1;
    const active = working && cast < .78;
    net.visible = active;
    if (handline) handline.visible = active;
    if (splash) splash.visible = false;
    if (!active) {
      if (fisher) fisher.rotation.x = 0;
      if (castingArm) castingArm.rotation.x = .42;
      return;
    }
    const progress = cast / .78;
    const smooth = (value: number) => value * value * (3 - 2 * value);
    let x = .08;
    let y = .5;
    let z = .24;
    let spread = .14;
    let opacity = .68;
    let throwPose = 1;
    if (progress < .16) {
      const phase = smooth(progress / .16);
      z += phase * .08;
      y -= phase * .08;
      throwPose = 1 + phase * .75;
    } else if (progress < .42) {
      const phase = smooth((progress - .16) / .26);
      x = THREE.MathUtils.lerp(.08, .16, phase);
      z = THREE.MathUtils.lerp(.32, 1.52, phase);
      y = THREE.MathUtils.lerp(.42, .25, phase) + Math.sin(phase * Math.PI) * .52;
      spread = THREE.MathUtils.lerp(.16, 1, phase);
      throwPose = THREE.MathUtils.lerp(1.75, -1.18, phase);
    } else if (progress < .6) {
      const phase = smooth((progress - .42) / .18);
      x = .16;
      z = 1.52;
      y = THREE.MathUtils.lerp(.25, .015, phase);
      spread = 1 + Math.sin(phase * Math.PI) * .1;
      throwPose = THREE.MathUtils.lerp(-1.18, -.35, phase);
      if (splash instanceof THREE.Mesh && splash.material instanceof THREE.MeshBasicMaterial) {
        const splashPhase = Math.max(0, (phase - .35) / .65);
        splash.visible = splashPhase > 0;
        splash.position.set(x, .015, z);
        splash.scale.setScalar(.35 + splashPhase * 1.2);
        splash.material.opacity = (1 - splashPhase) * .52;
      }
    } else if (progress < .79) {
      const phase = smooth((progress - .6) / .19);
      x = .16;
      z = 1.52;
      y = THREE.MathUtils.lerp(.015, -.2, phase);
      spread = THREE.MathUtils.lerp(1.04, .78, phase);
      opacity = THREE.MathUtils.lerp(.68, .34, phase);
      throwPose = THREE.MathUtils.lerp(-.35, .55, phase);
    } else {
      const phase = smooth((progress - .79) / .21);
      x = THREE.MathUtils.lerp(.16, -.3, phase);
      z = THREE.MathUtils.lerp(1.52, .3, phase);
      y = THREE.MathUtils.lerp(-.2, .31, phase);
      spread = THREE.MathUtils.lerp(.78, .14, phase);
      opacity = THREE.MathUtils.lerp(.34, .66, phase);
      throwPose = .55 + Math.sin(phase * Math.PI * 2) * .48;
    }
    net.position.set(x, y, z);
    net.scale.setScalar(spread);
    net.rotation.y = progress * Math.PI * 1.6;
    net.rotation.z = Math.sin(progress * Math.PI) * .12;
    if (canopy instanceof THREE.Mesh && canopy.material instanceof THREE.MeshBasicMaterial) canopy.material.opacity = opacity;
    if (handline instanceof THREE.Line) {
      const positions = handline.geometry.getAttribute('position') as THREE.BufferAttribute;
      const handX = .13;
      const handY = .44 - Math.cos(throwPose) * .18;
      const handZ = .015 - Math.sin(throwPose) * .18;
      positions.setXYZ(0, handX, handY, handZ);
      positions.setXYZ(1, (handX + x) * .5, (handY + y) * .5 - (progress > .6 ? .12 : 0), (handZ + z) * .5);
      positions.setXYZ(2, x, y + .12 * spread, z);
      positions.needsUpdate = true;
    }
    if (fisher) fisher.rotation.x = throwPose < -.8 ? -.18 : throwPose > 1.2 ? .16 : 0;
    if (castingArm) castingArm.rotation.x = throwPose;
  }

  private createFishingBoat() {
    const boat = new THREE.Group();
    const sailMaterial = new THREE.MeshStandardMaterial({ color: 0xb9493e, side: THREE.DoubleSide, roughness: .9 });
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x593e34, roughness: .95, side: THREE.DoubleSide });
    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0xc89d66, roughness: 1, side: THREE.DoubleSide });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x40312c, roughness: 1 });
    const hull = new THREE.Mesh(createHullGeometry(1.52, .58, .3), hullMaterial);
    hull.position.y = .04;
    hull.castShadow = true;
    const deck = new THREE.Mesh(createDeckGeometry(1.42, .51), deckMaterial);
    deck.position.y = .155;
    deck.castShadow = true;
    addGunwales(boat, 1.5, .58, darkWood);
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.018, .022, .9, 6), hullMaterial);
    mast.position.set(.02, .54, 0);
    const sail = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(.04, .94, 0), new THREE.Vector3(.04, .31, 0), new THREE.Vector3(.55, .37, 0),
    ]), sailMaterial);
    sail.castShadow = true;
    const boom = new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .58, 5), darkWood);
    boom.position.set(.27, .36, 0);
    boom.rotation.z = Math.PI / 2;
    const canopyMaterial = new THREE.MeshStandardMaterial({ color: 0xd7b260, roughness: 1 });
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(.5, .055, .42), canopyMaterial);
    canopy.position.set(-.43, .48, 0);
    for (const z of [-.16, .16]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.012, .015, .3, 5), darkWood);
      post.position.set(-.43, .32, z);
      boat.add(post);
    }
    const netMaterial = new THREE.MeshStandardMaterial({ color: 0xbfae83, roughness: 1 });
    const nets = new THREE.Mesh(new THREE.TorusGeometry(.2, .025, 5, 12), netMaterial);
    nets.position.set(-.38, .24, .22);
    nets.rotation.x = Math.PI / 2;
    for (let index = 0; index < 4; index++) {
      const float = new THREE.Mesh(new THREE.SphereGeometry(.027, 5, 4), sailMaterial);
      float.position.set(-.55 + index * .17, .19, -.29);
      boat.add(float);
    }

    const castNet = new THREE.Group();
    castNet.name = 'cast-net';
    const net = new THREE.Mesh(
      new THREE.ConeGeometry(.52, .26, 16, 3, true),
      new THREE.MeshBasicMaterial({ color: 0xe4d7ad, wireframe: true, transparent: true, opacity: .68, depthWrite: false }),
    );
    net.name = 'cast-net-canopy';
    castNet.add(net);
    const weightsMaterial = new THREE.MeshStandardMaterial({ color: 0x746f61, roughness: .82 });
    for (let index = 0; index < 12; index++) {
      const angle = index / 12 * Math.PI * 2;
      const weight = new THREE.Mesh(new THREE.SphereGeometry(.025, 5, 4), weightsMaterial);
      weight.position.set(Math.cos(angle) * .49, -.13, Math.sin(angle) * .49);
      castNet.add(weight);
    }
    consolidateModel(castNet);
    castNet.visible = false;

    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.Float32BufferAttribute([.13, .57, .08, .13, .57, .08, .13, .57, .08], 3));
    const handline = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: 0xd8c89d, transparent: true, opacity: .78 }));
    handline.name = 'cast-net-handline';
    handline.frustumCulled = false;
    handline.visible = false;
    const splash = new THREE.Mesh(
      new THREE.TorusGeometry(.42, .016, 4, 20),
      new THREE.MeshBasicMaterial({ color: 0xc6eeea, transparent: true, opacity: 0, depthWrite: false }),
    );
    splash.name = 'cast-net-splash';
    splash.rotation.x = Math.PI / 2;
    splash.visible = false;

    const catchMaterial = new THREE.MeshStandardMaterial({ color: 0x91b8ad, metalness: .16, roughness: .66 });
    const catchDisplay = new THREE.Group();
    catchDisplay.name = 'fishing-catch';
    for (let index = 0; index < 3; index++) {
      const fish = new THREE.Group();
      fish.name = `catch-fish-${index + 1}`;
      fish.position.set(-.52 + index * .18, .24 + index % 2 * .018, -.13);
      fish.rotation.y = index % 2 ? .18 : -.14;
      const fishBody = new THREE.Mesh(new THREE.SphereGeometry(.065, 7, 5), catchMaterial);
      fishBody.scale.set(1.65, .52, .58);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(.06, .11, 3), catchMaterial);
      tail.position.x = -.13;
      tail.rotation.z = Math.PI / 2;
      fish.add(fishBody, tail);
      consolidateModel(fish);
      this.registerCargo('fish', fish, index * 2 + 1);
      catchDisplay.add(fish);
    }

    const fisher = new THREE.Group();
    fisher.name = 'fishing-skipper';
    fisher.userData.vesselCrew = true;
    fisher.position.set(.13, .22, -.04);
    const fisherBody = new THREE.Mesh(new THREE.CapsuleGeometry(.055, .12, 2, 6), new THREE.MeshStandardMaterial({ color: 0x456f73, roughness: 1 }));
    fisherBody.position.y = .12;
    const fisherHead = new THREE.Mesh(new THREE.SphereGeometry(.055, 7, 5), new THREE.MeshStandardMaterial({ color: 0xd7a17a, roughness: 1 }));
    fisherHead.position.y = .27;
    const fisherHat = new THREE.Mesh(new THREE.ConeGeometry(.12, .05, 10), new THREE.MeshStandardMaterial({ color: 0xcaa35f, roughness: 1 }));
    fisherHat.position.y = .34;
    const castingArm = new THREE.Group();
    castingArm.name = 'casting-arm';
    castingArm.position.set(0, .22, .055);
    castingArm.rotation.x = .42;
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.018, .022, .19, 5), fisherBody.material);
    arm.position.y = -.085;
    castingArm.add(arm);
    const bracingArm = new THREE.Mesh(new THREE.CylinderGeometry(.018, .022, .18, 5), fisherBody.material);
    bracingArm.position.set(0, .16, -.07);
    bracingArm.rotation.x = -.6;
    fisher.add(fisherBody, fisherHead, fisherHat, castingArm, bracingArm);
    consolidateModel(fisher);

    const fishingDeckhand = createDeckPerson('fishing-deckhand', 0x9d594b, 'crew', .86);
    fishingDeckhand.position.set(-.33, .17, -.08);
    fishingDeckhand.visible = false;

    boat.add(hull, deck, mast, sail, boom, canopy, nets, catchDisplay, castNet, handline, splash, fisher, fishingDeckhand);
    return consolidateModel(boat);
  }

  private createRowboat() {
    const boat = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x685045, roughness: 1, side: THREE.DoubleSide });
    const darkWood = new THREE.MeshStandardMaterial({ color: 0x352e2b, roughness: 1 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xd5bd7d, roughness: 1 });
    const hull = new THREE.Mesh(createHullGeometry(1.12, .38, .22), wood);
    hull.position.y = .035;
    hull.castShadow = true;
    const well = new THREE.Mesh(new THREE.BoxGeometry(.62, .025, .24), darkWood);
    well.position.set(-.07, .14, 0);
    for (const x of [-.3, 0, .28]) {
      const bench = new THREE.Mesh(new THREE.BoxGeometry(.08, .035, .34), cloth);
      bench.position.set(x, .19, 0);
      boat.add(bench);
    }
    addGunwales(boat, 1.08, .38, darkWood);
    for (const side of [-1, 1]) {
      const oar = new THREE.Mesh(new THREE.CylinderGeometry(.012, .016, .78, 5), wood);
      oar.position.set(-.04, .26, side * .14);
      oar.rotation.set(Math.PI / 2, 0, side * .52);
      const blade = new THREE.Mesh(new THREE.BoxGeometry(.16, .025, .065), wood);
      blade.position.set(-.04 - side * .27, .1, side * .42);
      blade.rotation.y = side * .52;
      boat.add(oar, blade);
    }
    const rower = createDeckPerson('rowboat-rower', 0x8f4d43, 'crew', .78);
    rower.position.set(-.03, .17, 0);
    boat.add(hull, well, rower);
    boat.scale.setScalar(.9);
    return consolidateModel(boat);
  }

  private createSignalBoat() {
    const boat = this.createRowboat();
    boat.scale.setScalar(.92);
    const skipper = boat.getObjectByName('rowboat-rower');
    if (skipper) skipper.name = 'signal-skipper';
    const mastMaterial = new THREE.MeshStandardMaterial({ color: 0x4f4540, roughness: 1 });
    const sailMaterial = new THREE.MeshStandardMaterial({ color: 0x477b8b, side: THREE.DoubleSide, roughness: .9 });
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.015, .02, .72, 6), mastMaterial);
    mast.position.set(.04, .48, 0);
    const sail = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(.05, .8, 0), new THREE.Vector3(.05, .22, 0), new THREE.Vector3(.42, .28, 0),
    ]), sailMaterial);
    const pennant = new THREE.Mesh(new THREE.PlaneGeometry(.22, .09), sailMaterial);
    pennant.position.set(.15, .82, 0);
    const signal = new THREE.Mesh(new THREE.SphereGeometry(.05, 7, 5), new THREE.MeshStandardMaterial({ color: 0xffc86b, emissive: 0xff8c3c, emissiveIntensity: 1.2 }));
    signal.position.set(.04, .86, 0);
    boat.add(mast, sail, pennant, signal);
    return boat;
  }

  private createMerchantBoat() {
    const boat = new THREE.Group();
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x385e63, roughness: .92, side: THREE.DoubleSide });
    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0xb7834d, roughness: 1 });
    const trimMaterial = new THREE.MeshStandardMaterial({ color: 0x263e40, roughness: 1 });
    const canvasMaterial = new THREE.MeshStandardMaterial({ color: 0xe1c785, roughness: 1 });
    const hull = new THREE.Mesh(createHullGeometry(1.8, .72, .36), hullMaterial);
    hull.position.y = .025;
    hull.castShadow = true;
    const deck = new THREE.Mesh(createDeckGeometry(1.68, .64), deckMaterial);
    deck.position.y = .14;
    addGunwales(boat, 1.76, .72, trimMaterial);
    boat.add(hull, deck);
    for (const z of [-.23, .23]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(.015, .018, .38, 5), trimMaterial);
      post.position.set(-.58, .34, z);
      boat.add(post);
    }
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(.52, .055, .58), canvasMaterial);
    canopy.position.set(-.58, .55, 0);
    const bowPost = new THREE.Mesh(new THREE.CylinderGeometry(.025, .03, .28, 6), trimMaterial);
    bowPost.position.set(.7, .28, 0);
    boat.add(canopy, bowPost);

    const grain = new THREE.Group();
    grain.name = 'merchant-cargo-grain';
    grain.position.set(-.18, .22, -.17);
    for (const offset of [-.055, .055]) {
      const sack = new THREE.Mesh(new THREE.CapsuleGeometry(.055, .095, 2, 6), canvasMaterial);
      sack.position.z = offset;
      sack.rotation.z = Math.PI / 2;
      grain.add(sack);
    }
    consolidateModel(grain);
    this.registerCargo('grain', grain);

    const timber = new THREE.Group();
    timber.name = 'merchant-cargo-timber';
    timber.position.set(.18, .22, -.17);
    for (let index = 0; index < 3; index++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .25, 6), deckMaterial);
      log.position.set(0, index * .055, (index - 1) * .045);
      log.rotation.z = Math.PI / 2;
      timber.add(log);
    }
    consolidateModel(timber);
    this.registerCargo('timber', timber);

    const clay = new THREE.Group();
    clay.name = 'merchant-cargo-clay';
    clay.position.set(.18, .2, .17);
    const clayMaterial = new THREE.MeshStandardMaterial({ color: 0xa85f47, roughness: 1 });
    for (const offset of [-.055, .055]) {
      const jar = new THREE.Mesh(new THREE.CylinderGeometry(.04, .065, .15, 7), clayMaterial);
      jar.position.set(0, .075, offset);
      clay.add(jar);
    }
    consolidateModel(clay);
    this.registerCargo('clay', clay);

    const fiber = new THREE.Group();
    fiber.name = 'merchant-cargo-fiber';
    fiber.position.set(-.18, .25, .17);
    const bale = new THREE.Mesh(new THREE.BoxGeometry(.22, .13, .17), new THREE.MeshStandardMaterial({ color: 0xb6a46f, roughness: 1 }));
    bale.rotation.y = .12;
    fiber.add(bale);
    this.registerCargo('fiber', fiber);

    const harborGoods = new THREE.Group();
    harborGoods.name = 'merchant-cargo-harbor-goods';
    harborGoods.position.set(.5, .25, 0);
    const exportMaterial = new THREE.MeshStandardMaterial({ color: 0xb14e42, roughness: 1 });
    const exportCrate = new THREE.Mesh(new THREE.BoxGeometry(.22, .2, .24), exportMaterial);
    const exportSlat = new THREE.Mesh(new THREE.BoxGeometry(.23, .025, .04), exportMaterial);
    exportSlat.position.y = .11;
    harborGoods.add(exportCrate, exportSlat);
    consolidateModel(harborGoods);
    this.registerCargo('harbor-goods', harborGoods);

    const captain = createDeckPerson('merchant-captain', 0x315d62, 'crew', .84);
    captain.position.set(-.59, .17, 0);
    const deckhand = createDeckPerson('merchant-deckhand', 0xc7774e, 'crew', .76);
    deckhand.position.set(.61, .16, -.22);
    deckhand.visible = false;
    boat.add(grain, timber, clay, fiber, harborGoods, captain, deckhand);
    boat.scale.setScalar(1.08);
    return consolidateModel(boat);
  }

  private createFerry() {
    const boat = new THREE.Group();
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x4c4b54, roughness: .9, side: THREE.DoubleSide });
    const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0xe2cf9f, roughness: .95 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8d403a, roughness: .86 });
    const hull = new THREE.Mesh(createHullGeometry(2, .76, .38), hullMaterial);
    hull.position.y = .025;
    hull.castShadow = true;
    const deck = new THREE.Mesh(createDeckGeometry(1.88, .69), cabinMaterial);
    deck.position.y = .145;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(.92, .4, .5), cabinMaterial);
    cabin.position.set(-.18, .37, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.12, .075, .64), roofMaterial);
    roof.position.set(-.18, .6, 0);
    addGunwales(boat, 1.96, .76, roofMaterial);
    boat.add(hull, deck, cabin, roof);
    const windowMaterial = new THREE.MeshBasicMaterial({ color: 0xffc66d, toneMapped: false });
    for (const x of [-.34, 0, .34]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(.17, .14, .015), windowMaterial);
      window.position.set(x - .18, .4, .257);
      const farWindow = window.clone();
      farWindow.position.z = -.257;
      boat.add(window, farWindow);
    }
    for (const z of [-.27, .27]) {
      for (const x of [.48, .7]) {
        const rail = new THREE.Mesh(new THREE.CylinderGeometry(.012, .014, .28, 5), roofMaterial);
        rail.position.set(x, .29, z);
        boat.add(rail);
      }
      const railTop = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .28, 5), roofMaterial);
      railTop.rotation.z = Math.PI / 2;
      railTop.position.set(.59, .42, z);
      boat.add(railTop);
    }
    const skipper = createDeckPerson('ferry-skipper', 0x3b6670, 'crew', .8);
    skipper.position.set(.34, .16, 0);
    const passengerColors = [0xc56550, 0x68834f, 0xd09d4d];
    const passengerPositions = [[.55, .16, .18], [.55, .16, -.18], [.76, .16, 0]] as const;
    passengerPositions.forEach(([x, y, z], index) => {
      const passenger = createDeckPerson(`ferry-passenger-${index + 1}`, passengerColors[index], 'passenger', .7);
      passenger.position.set(x, y, z);
      passenger.visible = false;
      boat.add(passenger);
    });
    boat.add(skipper);
    boat.scale.setScalar(1.12);
    return consolidateModel(boat);
  }

  private createClouds() {
    const geometries: THREE.BufferGeometry[] = [];
    for (let cloudIndex = 0; cloudIndex < 5; cloudIndex++) {
      for (let puff = 0; puff < 4; puff++) {
        const geometry = new THREE.IcosahedronGeometry(1.1 + (puff % 2) * .45, 1);
        const matrix = new THREE.Matrix4().compose(
          new THREE.Vector3(-24 + cloudIndex * 11 + puff * 1.25, 10 + (cloudIndex % 2) * 2.5 + Math.sin(puff) * .32, -20 - cloudIndex * 2),
          new THREE.Quaternion(),
          new THREE.Vector3(1.65, .55, .7),
        );
        geometry.applyMatrix4(matrix);
        geometries.push(geometry);
      }
    }
    const geometry = mergeGeometries(geometries, false);
    for (const part of geometries) part.dispose();
    if (geometry) this.clouds.add(new THREE.Mesh(geometry, this.cloudMaterial));
    this.root.add(this.clouds);
  }

  private createStars() {
    const starPositions: number[] = [];
    for (let index = 0; index < 170; index++) {
      const angle = index * 2.39996;
      const radius = 28 + (index % 17) * 1.15;
      starPositions.push(Math.cos(angle) * radius, 12 + (index % 13) * 1.35, Math.sin(angle) * radius);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
    this.root.add(new THREE.Points(geometry, this.starMaterial));
  }

  private createParticles(count: number, color: number, size: number, salt: number) {
    const positions: number[] = [];
    for (let index = 0; index < count; index++) {
      const angle = hash(this.seed, index, 0, salt) * Math.PI * 2;
      const radius = 2 + hash(this.seed, index, 1, salt) * 14;
      positions.push(Math.cos(angle) * radius, .8 + hash(this.seed, index, 2, salt) * 5.5, Math.sin(angle) * radius);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, transparent: true, opacity: 0, depthWrite: false }));
  }

  private createWaterLanterns() {
    const positions: number[] = [];
    for (let index = 0; index < 56; index++) {
      const angle = hash(this.seed, index, 0, 1880) * Math.PI * 2;
      const radius = 6 + hash(this.seed, index, 1, 1880) * 10;
      positions.push(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffbd62, size: .2, transparent: true, opacity: 0, depthWrite: false }));
  }

  private createFireworks() {
    const positions: number[] = [];
    const colors: number[] = [];
    const sparkCount = 84;
    for (let burst = 0; burst < 9; burst++) {
      for (let spark = 0; spark < sparkCount; spark++) {
        const vertical = 1 - (spark + .5) / sparkCount * 2;
        const spread = Math.sqrt(Math.max(0, 1 - vertical * vertical));
        const azimuth = spark * 2.3999632297 + hash(this.seed, burst, 0, 1890) * Math.PI * 2;
        const secondaryColor = spark % 11 === 0 ? 2 : burst % FIREWORK_PALETTE.length;
        this.fireworkSparks.push(Object.freeze({
          burst,
          spark,
          direction: new THREE.Vector3(Math.cos(azimuth) * spread, vertical, Math.sin(azimuth) * spread),
          speed: .82 + hash(this.seed, burst, spark, 1892) * .38,
          radiusScale: burst % 3 === 0 && spark % 2 === 0
            ? .72
            : .92 + hash(this.seed, burst, spark, 1893) * .16,
          color: new THREE.Color(FIREWORK_PALETTE[secondaryColor]),
        }));
        positions.push(0, -100, 0);
        colors.push(0, 0, 0);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    (geometry.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (geometry.getAttribute('color') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const fireworks = new THREE.Points(geometry, new THREE.PointsMaterial({
      color: 0xffffff,
      vertexColors: true,
      map: createFireworkGlowTexture(),
      size: .34,
      transparent: true,
      opacity: 1,
      alphaTest: .01,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    }));
    fireworks.frustumCulled = false;
    fireworks.renderOrder = 5;
    return fireworks;
  }

  private createFireworkFlashLights() {
    return Array.from({ length: 3 }, (_, index) => {
      const light = new THREE.PointLight(FIREWORK_PALETTE[index], 0, 30, 1.8);
      light.name = `firework-flash-${index + 1}`;
      return light;
    });
  }

  private createProsperityMarket() {
    const root = new THREE.Group();
    root.name = 'prosperity-market-day';
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .96, side: THREE.DoubleSide });
    const colors = {
      wood: new THREE.Color(0x704938),
      cream: new THREE.Color(0xe7d4a8),
      red: new THREE.Color(0xb85445),
      blue: new THREE.Color(0x4e7880),
      green: new THREE.Color(0x668458),
    };
    const buildStalls = (name: string, stalls: Array<{ x: number; cloth: THREE.Color; goods: THREE.Color }>) => {
      const geometries: THREE.BufferGeometry[] = [];
      const position = new THREE.Vector3();
      const rotation = new THREE.Euler();
      const quaternion = new THREE.Quaternion();
      const scale = new THREE.Vector3(1, 1, 1);
      const matrix = new THREE.Matrix4();
      const add = (geometry: THREE.BufferGeometry, color: THREE.Color, x: number, y: number, z: number, rotationX = 0) => {
        position.set(x, y, z);
        rotation.set(rotationX, 0, 0);
        quaternion.setFromEuler(rotation);
        matrix.compose(position, quaternion, scale);
        geometry.applyMatrix4(matrix);
        const vertices = geometry.getAttribute('position').count;
        const vertexColors = new Float32Array(vertices * 3);
        for (let index = 0; index < vertices; index++) {
          vertexColors[index * 3] = color.r;
          vertexColors[index * 3 + 1] = color.g;
          vertexColors[index * 3 + 2] = color.b;
        }
        geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
        geometries.push(geometry);
      };
      for (const stall of stalls) {
        const z = .35;
        add(new THREE.BoxGeometry(.86, .18, .5), colors.wood, stall.x, .36, z);
        add(new THREE.BoxGeometry(.78, .08, .42), colors.cream, stall.x, .5, z);
        for (const postX of [-.39, .39]) {
          add(new THREE.CylinderGeometry(.018, .022, .92, 6), colors.wood, stall.x + postX, .91, z + .16);
        }
        for (let index = 0; index < 5; index++) {
          add(new THREE.BoxGeometry(.18, .075, .62), index % 2 ? colors.cream : stall.cloth,
            stall.x + (index - 2) * .18, 1.36, z + .05, -.09);
        }
        for (let index = 0; index < 4; index++) {
          add(new THREE.CylinderGeometry(.055, .075, .12 + index % 2 * .04, 7), index % 2 ? stall.goods : colors.cream,
            stall.x - .27 + index * .18, .62, z - .02 + index % 2 * .04);
        }
        add(new THREE.PlaneGeometry(.48, .24), stall.cloth, stall.x, 1.22, z + .38, -.08);
      }
      const geometry = mergeGeometries(geometries, false);
      for (const part of geometries) part.dispose();
      const mesh = new THREE.Mesh(geometry!, material);
      mesh.name = name;
      mesh.receiveShadow = true;
      return mesh;
    };

    const plaza = buildStalls('prosperity-market-plaza-stalls', [
      { x: -.95, cloth: colors.red, goods: colors.green },
      { x: .95, cloth: colors.blue, goods: colors.red },
    ]);
    const arcade = buildStalls('prosperity-market-arcade-stall', [
      { x: 0, cloth: colors.red, goods: colors.green },
    ]);
    arcade.visible = false;
    root.add(plaza, arcade);
    return root;
  }

  private createFestivalCrowd(rooftop: boolean) {
    const count = rooftop ? MAX_ROOFTOP_PARTY_ROOFS * DANCERS_PER_ROOF : 10;
    const group = new THREE.Group();
    const bodies = new THREE.InstancedMesh(
      new THREE.CapsuleGeometry(.09, .16, 3, 7),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .94 }),
      count,
    );
    const heads = new THREE.InstancedMesh(
      new THREE.SphereGeometry(.09, 9, 7),
      new THREE.MeshStandardMaterial({ color: 0xd9a47c, roughness: .9 }),
      count,
    );
    const arms = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(.019, .023, .19, 6),
      new THREE.MeshStandardMaterial({ color: 0xd9a47c, roughness: .9 }),
      count * 2,
    );
    const legs = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(.022, .027, .17, 6),
      new THREE.MeshStandardMaterial({ color: 0x302b32, roughness: 1 }),
      count * 2,
    );
    const prefix = rooftop ? 'lantern-rooftop-dancer' : 'lantern-square-dancer';
    bodies.name = `${prefix}-bodies`;
    heads.name = `${prefix}-heads`;
    arms.name = `${prefix}-arms`;
    legs.name = `${prefix}-legs`;
    const dancers = rooftop ? this.rooftopDancers : this.festivalDancers;
    const clothes = [0xd83a32, 0xe4a32b, 0x3d9b79, 0x657eb5, 0xb85872];
    const initialDancerCount = rooftop ? 0 : count;
    for (let index = 0; index < initialDancerCount; index++) {
      const angle = index / count * Math.PI * 2 + hash(this.seed, index, 0, 1910) * .28;
      const radius = .32 + index % 3 * .18;
      dancers.push(Object.freeze({
        x: Math.cos(angle) * radius,
        y: 0,
        z: -.48 + Math.sin(angle) * radius,
        centerX: 0,
        centerZ: -.48,
        phase: hash(this.seed, index, 1, 1911) * Math.PI * 2,
        scale: .82 + hash(this.seed, index, 2, 1912) * .22,
      }));
      bodies.setColorAt(index, new THREE.Color(clothes[index % clothes.length]));
    }
    if (bodies.instanceColor) bodies.instanceColor.needsUpdate = true;
    for (const batch of [bodies, heads, arms, legs]) {
      batch.frustumCulled = false;
      batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    }
    const batches = Object.freeze({ bodies, heads, arms, legs });
    if (rooftop) this.rooftopCrowdBatches = batches;
    else this.festivalCrowdBatches = batches;
    bodies.count = initialDancerCount;
    heads.count = initialDancerCount;
    arms.count = initialDancerCount * 2;
    legs.count = initialDancerCount * 2;
    group.add(bodies, heads, arms, legs);
    if (rooftop) {
      const lanternMaterial = new THREE.MeshStandardMaterial({
        color: 0xffb647,
        emissive: 0xff6a22,
        emissiveIntensity: 3,
        roughness: .72,
        toneMapped: false,
      });
      this.rooftopLanterns = new THREE.InstancedMesh(
        new THREE.SphereGeometry(.075, 8, 6),
        lanternMaterial,
        MAX_ROOFTOP_PARTY_ROOFS * 2,
      );
      this.rooftopLanterns.name = 'lantern-rooftop-party-lanterns';
      this.rooftopLanterns.count = 0;
      this.rooftopLanterns.frustumCulled = false;
      this.rooftopLanterns.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      group.add(this.rooftopLanterns);
      for (let index = 0; index < 8; index++) {
        const light = new THREE.PointLight(0xff9c3d, 2.5, 5.2, 1.8);
        light.name = `lantern-rooftop-party-light-${index + 1}`;
        light.visible = false;
        this.rooftopPartyLights.push(light);
        group.add(light);
      }
    }
    this.updateFestivalCrowd(0, rooftop);
    return group;
  }

  private updateFestivalCrowd(time: number, rooftop: boolean) {
    const { bodies, heads, arms, legs } = rooftop ? this.rooftopCrowdBatches : this.festivalCrowdBatches;
    const dancers = rooftop ? this.rooftopDancers : this.festivalDancers;
    const part = this.festivalPartTransform;
    const root = this.festivalRootTransform;
    const setPart = (mesh: THREE.InstancedMesh, index: number, x: number, y: number, z: number, rotationX = 0, rotationZ = 0) => {
      part.position.set(x, y, z);
      part.rotation.set(rotationX, 0, rotationZ);
      part.scale.setScalar(1);
      part.updateMatrix();
      mesh.setMatrixAt(index, this.festivalCombinedMatrix.multiplyMatrices(root.matrix, part.matrix));
    };
    for (const [index, dancer] of dancers.entries()) {
      const beat = time * (3.8 + index % 3 * .35) + dancer.phase;
      const bounce = Math.max(0, Math.sin(beat)) * .07;
      root.position.set(dancer.x, dancer.y, dancer.z);
      root.rotation.set(0, Math.atan2(dancer.centerX - dancer.x, dancer.centerZ - dancer.z) + Math.sin(beat * .5) * .18, 0);
      root.scale.setScalar(dancer.scale);
      root.updateMatrix();
      setPart(bodies, index, 0, .285 + bounce, 0, 0, Math.sin(beat * .5) * .13);
      setPart(heads, index, 0, .5 + bounce, 0);
      setPart(arms, index * 2, -.115, .32 + bounce, 0, Math.sin(beat * .5) * .3, .9 + Math.sin(beat) * .42);
      setPart(arms, index * 2 + 1, .115, .32 + bounce, 0, -Math.cos(beat * .5) * .3, -.9 - Math.cos(beat) * .42);
      setPart(legs, index * 2, -.047, .085, 0, Math.sin(beat) * .26);
      setPart(legs, index * 2 + 1, .047, .085, 0, -Math.sin(beat) * .26);
    }
    for (const batch of [bodies, heads, arms, legs]) batch.instanceMatrix.needsUpdate = true;
  }

  private updateFireworks(time: number, daylight: number) {
    const positions = this.fireworks.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colors = this.fireworks.geometry.getAttribute('color') as THREE.BufferAttribute;
    const cycleDuration = 6.1;
    const launchDuration = .76;
    const burstDuration = 3.05;
    const night = Math.pow(1 - daylight, 1.25);
    const burstStates = Array.from({ length: 9 }, (_, burst) => {
      const elapsed = ((time * .9 - burst * .64) % cycleDuration + cycleDuration) % cycleDuration;
      const age = elapsed - launchDuration;
      return {
        burst,
        elapsed,
        age,
        centerX: (hash(this.seed, burst, 0, 1901) - .5) * 10.5,
        centerY: 7.8 + hash(this.seed, burst, 1, 1902) * 5.4,
        centerZ: (hash(this.seed, burst, 2, 1903) - .5) * 7.5 - 2,
        flash: age >= 0 && age < .58 ? Math.pow(1 - age / .58, 2) * night : 0,
      };
    });
    let fireworkBurst: number | undefined;
    const sounding = burstStates.find((state) => state.age >= 0 && state.age < .08);
    if (sounding && time - this.lastFireworkSoundAt > .72) {
      this.lastFireworkSoundAt = time;
      fireworkBurst = .48 + hash(this.seed, sounding.burst, Math.floor(time * 10), 1905) * .3;
    }
    for (let index = 0; index < this.fireworkSparks.length; index++) {
      const meta = this.fireworkSparks[index];
      const state = burstStates[meta.burst];
      let brightness = 0;
      if (state.elapsed < launchDuration && meta.spark < 10) {
        const launch = state.elapsed / launchDuration;
        const tail = meta.spark / 10 * .68;
        positions.setXYZ(
          index,
          state.centerX * launch,
          .8 + state.centerY * Math.max(0, launch - tail),
          state.centerZ * launch,
        );
        brightness = Math.max(0, 1 - tail - Math.abs(Math.sin(launch * Math.PI * 8)) * .12);
      } else if (state.age >= 0 && state.age < burstDuration) {
        const radius = (.24 + state.age * 2.38) * meta.speed * meta.radiusScale;
        const willowDrop = state.age * state.age * (meta.burst % 3 === 1 ? .72 : .5);
        positions.setXYZ(
          index,
          state.centerX + meta.direction.x * radius,
          state.centerY + meta.direction.y * radius - willowDrop,
          state.centerZ + meta.direction.z * radius,
        );
        const fade = Math.pow(1 - state.age / burstDuration, 1.12);
        const twinkle = .72 + Math.max(0, Math.sin(time * 15 + meta.spark * 2.17)) * .4;
        brightness = fade * twinkle * (state.age < .16 ? 1.62 : 1.12);
      } else {
        positions.setXYZ(index, 0, -100, 0);
      }
      colors.setXYZ(index, meta.color.r * brightness * night, meta.color.g * brightness * night, meta.color.b * brightness * night);
    }
    const flashes = burstStates.filter((state) => state.flash > 0).sort((a, b) => b.flash - a.flash);
    this.fireworkFlashLights.forEach((light, index) => {
      const flash = flashes[index];
      light.intensity = flash ? flash.flash * 38 : 0;
      if (!flash) return;
      light.position.set(flash.centerX, flash.centerY, flash.centerZ);
      light.color.setHex(FIREWORK_PALETTE[flash.burst % FIREWORK_PALETTE.length]);
    });
    positions.needsUpdate = true;
    colors.needsUpdate = true;
    this.fireworks.material.size = .31 + Math.max(0, Math.sin(time * 15)) * .13;
    return fireworkBurst;
  }
}
