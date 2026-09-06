import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { BusinessSave, Cell, CitizenSave, CraftGood, PlaceIdentityId } from './types';
import type { PlaceIdentityOccurrence } from './place-identities';
import { hash } from './random';
import { analyzeWaterTopology, createShorelineRoute, WORLD_CELL_SIZE, type WaterTopology } from './water';
import { FaunaSystem, type WildlifeAction, type WildlifeKind, type WildlifeMemoryInspection } from './fauna';

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
  private readonly cargoModels = new Map<CraftGood, THREE.Object3D[]>();
  private cargoState: Partial<Record<CraftGood, number>> = {};
  private readonly importQueue: ImportGood[] = [];
  private unloading?: { good: ImportGood; startedAt: number };
  private lastUpdateTime = 0;
  private merchantDocked = false;
  private merchantJourneyPhase = 0;
  private merchantCycle = Number.NaN;
  private merchantLoadedExport = false;
  private merchantShippedCycle = Number.NaN;
  private merchantWasOnDuty = false;
  private topology!: WaterTopology;
  private readonly townCenter = new THREE.Vector3();

  constructor(private readonly seed: number, camera: THREE.Camera, cells: Iterable<Cell>) {
    this.root.name = 'harbor-ambience';
    this.createFleet();
    this.importYard = this.createImportYard();
    this.root.add(this.importYard);
    this.fauna = new FaunaSystem(seed);
    this.root.add(this.fauna.root);
    this.setTown(cells);
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
    this.root.add(this.fireworks);
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
  }

  setTown(cells: Iterable<Cell>, businesses: readonly BusinessSave[] = this.businesses, citizens: readonly CitizenSave[] = this.citizens, matureTreeAnchors: readonly THREE.Vector3[] = []) {
    this.cells = [...cells].map((cell) => ({ ...cell }));
    this.businesses = businesses.map((business) => ({ ...business }));
    this.citizens = citizens.map((citizen) => ({ ...citizen, traits: [...citizen.traits], relationships: [...citizen.relationships] }));
    this.topology = analyzeWaterTopology(this.cells, this.seed);
    if (this.cells.length) this.townCenter.set(
      this.cells.reduce((sum, cell) => sum + cell.x * WORLD_CELL_SIZE, 0) / this.cells.length,
      0,
      this.cells.reduce((sum, cell) => sum + cell.z * WORLD_CELL_SIZE, 0) / this.cells.length,
    );
    this.fleet.forEach((boat, index) => { boat.route = createWaterRoute(this.cells, this.seed, index * .42); });
    this.fauna.setTown(this.cells, this.businesses, matureTreeAnchors);
    this.syncVesselOccupants();
    this.positionImportYard();
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
    this.fireworks.visible = discovered && this.lanternFinaleStage === 'fireworks';
  }

  setPlaceIdentities(identities: readonly PlaceIdentityOccurrence[]) {
    this.placeIdentities = new Set(identities.map((identity) => identity.id));
    this.refreshFleetVisibility();
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
    this.fireworks.rotation.y = time * .025;
    this.fireworks.material.opacity = Math.pow(1 - daylight, 2) * (.38 + Math.pow(Math.max(0, Math.sin(time * 1.35)), 5) * .62);
    this.fireworks.material.size = .11 + (Math.sin(time * 1.35) * .5 + .5) * .11;
    this.updateRain(time, rainIntensity);
    return { exportDeparture };
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
          ? 'It is heading back to open water with the harbor’s finished export crates.'
          : 'It is heading back beyond the harbor after making its call.';
    let passengerCount = 0;
    model.traverse((object) => { if (object.userData.vesselPassenger && object.visible) passengerCount += 1; });
    const observations: Record<BoatKind, Omit<BoatMemoryInspection, 'kind'>> = {
      rowboat: {
        title: 'Harbor rowboat', ageLabel: 'Shoreline wanderer',
        detail: 'A small rowboat follows the changing edge of the town.',
        note: 'Its route quietly reshapes itself whenever the harbor grows.',
      },
      'fishing boat': {
        title: 'Working fishing boat', ageLabel: 'Harbor working vessel',
        detail: `The fishing crew follows the shoreline in search of the morning catch.${fishOnDeck ? ` ${Math.min(3, Math.ceil(fishOnDeck / 2))} silver ${fishOnDeck < 3 ? 'fish lies' : 'fish lie'} on the working deck.` : ''}`,
        note: 'It sails at dawn and late afternoon when the harbor has a dock and a fisher. A second fisher joins once the town has a full crew.',
      },
      'merchant boat': {
        title: 'Merchant boat', ageLabel: 'Visiting cargo vessel',
        detail: merchantMakesJourney ? merchantJourneyDetail : merchantCargo.length
          ? `Visible ${merchantCargo.join(', ')} ride on the broad working deck.`
          : 'The broad working deck is ready for the harbor’s next real shipment.',
        note: merchantMakesJourney
          ? 'Each round trip begins beyond the town, pauses at the working dock, and ends back in open water.'
          : this.placeIdentities.has('canal-market')
          ? 'The market barge’s painted awning draws it toward the town before evening.'
          : 'A working dock gives it somewhere to unload before evening.',
      },
      'signal boat': {
        title: 'Beacon survey boat', ageLabel: 'Outer-water scout',
        detail: 'A small blue sail traces the edge of the harbor and reads the signals above the roofs.',
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
    const hasInn = this.businesses.some((business) => business.type === 'inn');
    const hasFisher = this.citizens.some((citizen) => citizen.occupation === 'Fisher');
    for (const boat of this.fleet) {
      if (boat.kind === 'rowboat') boat.eligible = this.cells.length > 0;
      if (boat.kind === 'fishing boat') boat.eligible = hasDock && hasFisher && this.discoveries.has('fishing-boat');
      if (boat.kind === 'merchant boat') boat.eligible = (hasDock && this.discoveries.has('merchant-arrival')) || this.placeIdentities.has('canal-market');
      if (boat.kind === 'signal boat') boat.eligible = this.placeIdentities.has('high-harbor');
      if (boat.kind === 'ferry') boat.eligible = this.placeIdentities.has('ferry-quarter') || (hasDock && hasInn && this.discoveries.has('ferry-route'));
      boat.model.visible = boat.eligible;
    }
    this.importYard.visible = hasDock && this.discoveries.has('merchant-arrival');
  }

  private preferredImportDock() {
    if (!this.topology?.docks.length) return undefined;
    const sheltered = new Set(this.topology.sheltered.map((point) => `${point.x},${point.z}`));
    return [...this.topology.docks].sort((a, b) => {
      const shelterDifference = Number(sheltered.has(`${b.water.x},${b.water.z}`)) - Number(sheltered.has(`${a.water.x},${a.water.z}`));
      if (shelterDifference) return shelterDifference;
      return hash(this.seed, b.land.x, b.land.z, 2370 + b.direction) - hash(this.seed, a.land.x, a.land.z, 2370 + a.direction);
    })[0];
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
        : 'Grain, straight timber, river clay, and loom fiber cannot be made locally; merchant crews carry them ashore here.',
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
    const onDuty = Boolean(dock) && boat.eligible && this.boatOnShift(boat.kind, hour);
    if (!dock || !onDuty) {
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

    const outward = new THREE.Vector3(dock.water.x - dock.land.x, 0, dock.water.z - dock.land.z);
    const lateral = new THREE.Vector3(outward.z, 0, -outward.x);
    const land = new THREE.Vector3(dock.land.x * WORLD_CELL_SIZE, 0, dock.land.z * WORLD_CELL_SIZE);
    const yardCenter = land.clone().addScaledVector(outward, WORLD_CELL_SIZE * .77);
    const dockPoint = yardCenter.clone().addScaledVector(outward, .58).addScaledVector(lateral, 1.38);
    dockPoint.y = -.08;
    const inboundOutside = land.clone().addScaledVector(outward, 28).addScaledVector(lateral, 6);
    const inboundControl = dockPoint.clone().addScaledVector(outward, 3.2).addScaledVector(lateral, 3.4);
    const outboundControl = dockPoint.clone().addScaledVector(outward, 3.2).addScaledVector(lateral, -3.4);
    const outboundOutside = land.clone().addScaledVector(outward, 28).addScaledVector(lateral, -6);
    inboundOutside.y = inboundControl.y = outboundControl.y = outboundOutside.y = -.08;

    const direction = new THREE.Vector3();
    if (phase < dockStart) {
      const progress = phase / dockStart;
      this.quadraticPoint(inboundOutside, inboundControl, dockPoint, progress, boat.model.position);
      this.quadraticTangent(inboundOutside, inboundControl, dockPoint, progress, direction);
    } else if (phase < dockEnd) {
      boat.model.position.copy(dockPoint);
      direction.copy(lateral).multiplyScalar(-1);
    } else if (phase < outsideAt) {
      const progress = (phase - dockEnd) / (outsideAt - dockEnd);
      this.quadraticPoint(dockPoint, outboundControl, outboundOutside, progress, boat.model.position);
      this.quadraticTangent(dockPoint, outboundControl, outboundOutside, progress, direction);
    } else {
      boat.model.position.copy(outboundOutside);
      direction.copy(outward);
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

  private quadraticPoint(a: THREE.Vector3, control: THREE.Vector3, b: THREE.Vector3, amount: number, target: THREE.Vector3) {
    const inverse = 1 - amount;
    return target.set(
      inverse * inverse * a.x + 2 * inverse * amount * control.x + amount * amount * b.x,
      inverse * inverse * a.y + 2 * inverse * amount * control.y + amount * amount * b.y,
      inverse * inverse * a.z + 2 * inverse * amount * control.z + amount * amount * b.z,
    );
  }

  private quadraticTangent(a: THREE.Vector3, control: THREE.Vector3, b: THREE.Vector3, amount: number, target: THREE.Vector3) {
    return target.set(
      2 * (1 - amount) * (control.x - a.x) + 2 * amount * (b.x - control.x),
      0,
      2 * (1 - amount) * (control.z - a.z) + 2 * amount * (b.z - control.z),
    ).normalize();
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
    const centers = [[-7, 8, -5], [6, 10, -8], [1, 7, -13]] as const;
    centers.forEach(([cx, cy, cz], burst) => {
      for (let index = 0; index < 28; index++) {
        const angle = index / 28 * Math.PI * 2;
        const radius = .8 + hash(this.seed, burst, index, 1890) * 1.7;
        positions.push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, cz + Math.sin(angle * 3) * .42);
      }
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    return new THREE.Points(geometry, new THREE.PointsMaterial({ color: 0xffbf70, size: .16, transparent: true, opacity: 0, depthWrite: false }));
  }
}
