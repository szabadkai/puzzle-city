import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash } from './random';
import { facadeDirectionAt, findPlazaAnchors } from './topology';
import { CARDINALS, type BusinessSave, type Cell, keyOf } from './types';
import { analyzeWaterTopology, createShorelineRoute, WORLD_CELL_SIZE } from './water';
import { ageInHours, catColonyAt, describeAge, KITTEN_GROWTH_HOURS, KITTEN_INTERVAL_HOURS } from './memory';
import { FLOOR_HEIGHT, STOREFRONT_CAT_OUTWARD, STOREFRONT_CAT_Y } from './spatial';

export type WildlifeKind = 'gulls' | 'fish' | 'crabs' | 'cats' | 'butterflies';
export type WildlifeAction = 'reveal' | 'gather' | 'scatter';

export type CatMemoryInspection = Readonly<{
  kind: 'cat';
  title: string;
  ageLabel: string;
  detail: string;
  note: string;
}>;

export type WildlifeMemoryInspection = CatMemoryInspection | Readonly<{
  kind: 'wildlife';
  title: string;
  ageLabel: string;
  detail: string;
  note: string;
}>;

type ObservableWildlife = 'fish' | 'crab' | 'cat' | 'turtle' | 'whale' | 'dolphins' | 'squids' | 'tuna';

type GullActor = {
  model: THREE.Group;
  leftWing: THREE.Object3D;
  rightWing: THREE.Object3D;
  phase: number;
  mode: 'flying' | 'feeding' | 'perching' | 'scattering';
};

type ActorInstanceBatch = {
  mesh: THREE.InstancedMesh;
  parent: THREE.Group;
  sources: THREE.Group[];
};

type MarineVisitor = {
  model: THREE.Group;
  route: THREE.CatmullRomCurve3;
  phase: number;
  speed: number;
  cycle: number;
  duration: number;
  scheduleOffset: number;
};

type SchoolFishActor = {
  model: THREE.Group;
  tail: THREE.Group;
  baseX: number;
  baseZ: number;
  phase: number;
};

type FishSchoolActor = {
  model: THREE.Group;
  fish: SchoolFishActor[];
  phase: number;
};

type TurtleActor = {
  model: THREE.Group;
  frontFlippers: readonly [THREE.Group, THREE.Group];
  phase: number;
};

type AmbientBirdActor = {
  model: THREE.Group;
  leftWing: THREE.Group;
  rightWing: THREE.Group;
  baseX: number;
  baseY: number;
  baseZ: number;
  phase: number;
};

type CatActor = {
  model: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  phase: number;
};

type CatAnchor = {
  position: THREE.Vector3;
  /** Unit cardinal pointing away from a storefront, absent in open gardens. */
  outward?: readonly [number, number];
  cluster: string;
};

const CELL = WORLD_CELL_SIZE;
const INSTANCE_WHITE = new THREE.Color(0xffffff);
const TURTLE_VISIT_CYCLE = 108;
const TURTLE_VISIT_DURATION = 18;
const TURTLE_SCALE = .72;

function parseCellKey(cellKey: string) {
  const [x, z] = cellKey.split(',').map(Number);
  return { x, z };
}

/** Collapse the rigid pieces of one small actor without disturbing animated parts. */
function consolidateActor(group: THREE.Group, animatedParts = new Set<THREE.Object3D>()) {
  const buckets = new Map<THREE.Material, THREE.Mesh[]>();
  for (const child of [...group.children]) {
    if (!(child instanceof THREE.Mesh) || animatedParts.has(child)) continue;
    const material = child.material as THREE.Material | THREE.Material[];
    if (Array.isArray(material)) continue;
    const bucket = buckets.get(material) ?? [];
    bucket.push(child);
    buckets.set(material, bucket);
  }
  for (const [material, meshes] of buckets) {
    if (meshes.length < 2) continue;
    const keepIndexed = meshes.every((mesh) => mesh.geometry.index !== null);
    const geometries = meshes.map((mesh) => {
      mesh.updateMatrix();
      const geometry = keepIndexed || !mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.toNonIndexed();
      geometry.applyMatrix4(mesh.matrix);
      return geometry;
    });
    const geometry = mergeGeometries(geometries, false);
    geometries.forEach((entry) => entry.dispose());
    if (!geometry) continue;
    const merged = new THREE.Mesh(geometry, material);
    merged.castShadow = meshes.some((mesh) => mesh.castShadow);
    merged.receiveShadow = meshes.some((mesh) => mesh.receiveShadow);
    meshes.forEach((mesh) => {
      group.remove(mesh);
      mesh.geometry.dispose();
    });
    group.add(merged);
  }
}

/** Add forgiving screen picking to a moving model without adding another draw call. */
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

export class FaunaSystem {
  readonly root = new THREE.Group();
  private readonly ambientBirds = new THREE.Group();
  private readonly gullRoot = new THREE.Group();
  private readonly fishRoot = new THREE.Group();
  private readonly crabRoot = new THREE.Group();
  private readonly catRoot = new THREE.Group();
  private readonly turtleRoot = new THREE.Group();
  private readonly butterflyRoot = new THREE.Group();
  private readonly marineRoot = new THREE.Group();
  private readonly ambientBirdActors: AmbientBirdActor[] = [];
  private readonly gulls: GullActor[] = [];
  private readonly fishSchools: FishSchoolActor[] = [];
  private readonly crabs: THREE.Group[] = [];
  private readonly cats: CatActor[] = [];
  private readonly turtles: TurtleActor[] = [];
  private readonly butterflies: THREE.Group[] = [];
  private readonly marineVisitors: Record<'whale' | 'dolphins' | 'squids' | 'tuna', MarineVisitor>;
  private readonly actorInstanceBatches: ActorInstanceBatch[] = [];
  private readonly instanceMatrix = new THREE.Matrix4();
  private readonly inverseParentMatrix = new THREE.Matrix4();
  private cells: Cell[] = [];
  private businesses: BusinessSave[] = [];
  private discoveries = new Set<string>();
  private dockAnchors: THREE.Vector3[] = [];
  private waterAnchors: THREE.Vector3[] = [];
  private gardenAnchors: THREE.Vector3[] = [];
  private towerAnchors: THREE.Vector3[] = [];
  private catAnchors: CatAnchor[] = [];
  private matureTreeAnchors: THREE.Vector3[] = [];
  private catCapacity = 0;
  private visibleCatCount = 0;
  private kittenCount = 0;
  private migratingCatCount = 0;
  private migrationStartedAt = 0;
  private migrationUntil = 0;
  private townCenter = new THREE.Vector3();
  private lastRealTime = 0;
  private scatterUntil = 0;
  private scatterFocus: THREE.Vector3 | null = null;
  private feedUntil = 0;
  private feedFocus: THREE.Vector3 | null = null;
  private catGatherUntil = 0;
  private catGatherCluster: string | null = null;

  constructor(private readonly seed: number) {
    this.root.name = 'fauna';
    this.ambientBirds.name = 'ambient-birds';
    this.gullRoot.name = 'gulls';
    this.fishRoot.name = 'fish-schools';
    this.crabRoot.name = 'dock-crabs';
    this.catRoot.name = 'harbor-cats';
    this.turtleRoot.name = 'harbor-turtles';
    this.butterflyRoot.name = 'garden-butterflies';
    this.marineRoot.name = 'passing-sea-life';
    this.createAmbientBirds();
    this.createGulls();
    this.createFishSchools();
    this.createCrabs();
    this.createCats();
    this.createTurtles();
    this.createButterflies();
    this.marineVisitors = this.createMarineVisitors();
    this.root.add(this.ambientBirds, this.gullRoot, this.fishRoot, this.crabRoot, this.catRoot, this.turtleRoot, this.butterflyRoot, this.marineRoot);
    this.setDiscoveryState([]);
  }

  setTown(cells: Iterable<Cell>, businesses: readonly BusinessSave[], matureTreeAnchors: readonly THREE.Vector3[] = []) {
    this.cells = [...cells].map((cell) => ({ ...cell }));
    this.businesses = businesses.map((business) => ({ ...business }));
    this.matureTreeAnchors = matureTreeAnchors.map((anchor) => anchor.clone());
    const occupied = new Map(this.cells.map((cell) => [keyOf(cell.x, cell.z), cell]));
    const topology = analyzeWaterTopology(this.cells, this.seed);
    this.dockAnchors = topology.docks.map((edge) => {
      const [dx, dz] = CARDINALS[edge.direction];
      return new THREE.Vector3(edge.land.x * CELL + dx * CELL * .78, .04, edge.land.z * CELL + dz * CELL * .78);
    });
    this.waterAnchors = [...topology.sheltered, ...topology.canals, ...topology.shoreline.map((edge) => edge.water)]
      .map((point) => new THREE.Vector3(point.x * CELL, -.275, point.z * CELL));
    this.towerAnchors = this.cells
      .filter((cell) => cell.height >= 3 && CARDINALS.filter(([dx, dz]) => occupied.has(keyOf(cell.x + dx, cell.z + dz))).length <= 1)
      .map((cell) => new THREE.Vector3(cell.x * CELL, cell.height * FLOOR_HEIGHT + 1.25, cell.z * CELL));
    const courtyardAnchors: THREE.Vector3[] = [];
    for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
      if (occupied.has(keyOf(x, z))) continue;
      if (CARDINALS.filter(([dx, dz]) => occupied.has(keyOf(x + dx, z + dz))).length >= 3) courtyardAnchors.push(new THREE.Vector3(x * CELL, .75, z * CELL));
    }
    const plazaAnchors = findPlazaAnchors(occupied).map((anchor) => new THREE.Vector3((anchor.x + .5) * CELL, .45, (anchor.z + .5) * CELL));
    const flowerAnchors = this.businesses.filter((business) => business.type === 'flower-shop').map((business) => {
      const cell = parseCellKey(business.cellKey);
      return this.exteriorAnchor(cell.x, cell.z, occupied, .66);
    });
    this.gardenAnchors = [...courtyardAnchors, ...plazaAnchors, ...flowerAnchors];
    const storefrontCatAnchors = (business: BusinessSave, sideSlots: readonly number[]) => {
      const cell = parseCellKey(business.cellKey);
      const direction = facadeDirectionAt(cell.x, cell.z, occupied, this.seed);
      const [dx, dz] = CARDINALS[direction];
      const lateralX = dz;
      const lateralZ = -dx;
      return sideSlots.map((side): CatAnchor => ({
        position: new THREE.Vector3(
          cell.x * CELL + dx * STOREFRONT_CAT_OUTWARD + lateralX * side,
          STOREFRONT_CAT_Y,
          cell.z * CELL + dz * STOREFRONT_CAT_OUTWARD + lateralZ * side,
        ),
        outward: [dx, dz],
        cluster: `business:${business.id}`,
      }));
    };
    const workingCatAnchors = this.businesses
      .filter((business) => business.type === 'fishmonger' || business.type === 'inn')
      .flatMap((business) => storefrontCatAnchors(business, business.type === 'fishmonger' ? [-.64, 0, .64] : [-.4, .4]));
    const openGardenCatAnchors = [...courtyardAnchors, ...plazaAnchors].map((anchor, index): CatAnchor => ({
      position: anchor.clone().setY(.28),
      cluster: `garden:${index}`,
    }));
    const flowerCatAnchors = this.businesses
      .filter((business) => business.type === 'flower-shop')
      .flatMap((business) => storefrontCatAnchors(business, [0]));
    const gardenCatAnchors = [...openGardenCatAnchors, ...flowerCatAnchors].slice(0, 2);
    this.catAnchors = [...workingCatAnchors, ...gardenCatAnchors];
    if (this.catGatherCluster && !this.catAnchors.some((anchor) => anchor.cluster === this.catGatherCluster)) {
      this.catGatherCluster = null;
      this.catGatherUntil = 0;
    }
    const nextCapacity = Math.min(this.cats.length, this.catAnchors.length);
    if (nextCapacity < this.visibleCatCount) {
      this.migratingCatCount = this.visibleCatCount - nextCapacity;
      this.migrationStartedAt = this.lastRealTime;
      this.migrationUntil = this.lastRealTime + 11;
    }
    this.catCapacity = nextCapacity;
    if (this.cells.length) {
      this.townCenter.set(
        this.cells.reduce((sum, cell) => sum + cell.x * CELL, 0) / this.cells.length,
        0,
        this.cells.reduce((sum, cell) => sum + cell.z * CELL, 0) / this.cells.length,
      );
    } else this.townCenter.set(0, 0, 0);
    this.ambientBirds.visible = this.cells.length > 0;
    this.marineRoot.visible = this.cells.length > 0;
    this.turtleRoot.visible = this.cells.length > 0 && this.waterAnchors.length > 0;
    Object.values(this.marineVisitors).forEach((visitor, index) => {
      visitor.route = createShorelineRoute(this.cells, this.seed + 4100 + index * 97, 1.35 + index * .38);
    });
  }

  setDiscoveryState(discoveries: readonly string[]) {
    this.discoveries = new Set(discoveries);
    this.gullRoot.visible = this.discoveries.has('gulls-return');
    this.fishRoot.visible = this.discoveries.has('silver-shoal');
    this.crabRoot.visible = this.discoveries.has('quay-crabs');
    this.catRoot.visible = this.discoveries.has('harbor-cats');
    this.butterflyRoot.visible = this.discoveries.has('garden-butterflies');
  }

  apply(action: WildlifeAction, animal: WildlifeKind, focus?: { x: number; z: number } | null) {
    const group = this.groupFor(animal);
    if (action === 'reveal') group.visible = true;
    const worldFocus = focus ? new THREE.Vector3(focus.x * CELL, .35, focus.z * CELL) : null;
    if (action === 'scatter' && (animal === 'gulls' || animal === 'butterflies')) {
      this.scatterUntil = this.lastRealTime + 5;
      this.scatterFocus = worldFocus;
    }
    if (action === 'gather' && animal === 'gulls') {
      this.feedFocus = worldFocus ?? this.gardenAnchors[0]?.clone() ?? this.townCenter.clone();
      this.feedUntil = this.lastRealTime + 9;
    }
    if (action === 'gather' && animal === 'cats') {
      const nearest = worldFocus && this.catAnchors.length
        ? this.catAnchors.reduce((best, anchor) => anchor.position.distanceToSquared(worldFocus) < best.position.distanceToSquared(worldFocus) ? anchor : best)
        : this.catAnchors[0];
      this.catGatherCluster = nearest?.cluster ?? null;
      this.catGatherUntil = this.lastRealTime + 9;
    }
  }

  scatterAt(x: number, z: number) {
    this.scatterFocus = new THREE.Vector3(x * CELL, .35, z * CELL);
    this.scatterUntil = this.lastRealTime + 4.5;
  }

  update(time: number, daylight: number, timeOfDay: number, absoluteHours: number, catColonyFoundedAt?: number, rainIntensity = 0) {
    this.lastRealTime = time;
    this.updateAmbientBirds(time);
    this.updateGulls(time, daylight, timeOfDay, absoluteHours, rainIntensity);
    this.updateFish(time);
    this.updateCrabs(time);
    this.updateCats(time, timeOfDay, absoluteHours, catColonyFoundedAt, rainIntensity);
    this.updateTurtles(time);
    this.updateButterflies(time, daylight, rainIntensity);
    this.updateMarineVisitors(time);
    this.updateActorInstances();
  }

  stats() {
    const modes = this.gulls.reduce((counts, gull) => {
      counts[gull.mode] += 1;
      return counts;
    }, { flying: 0, feeding: 0, perching: 0, scattering: 0 });
    return {
      birds: this.ambientBirds.visible ? 6 : 0,
      gulls: this.gullRoot.visible ? this.gulls.length : 0,
      gullModes: modes,
      fish: this.fishRoot.visible && this.waterAnchors.length ? this.fishSchools.length * 5 : 0,
      crabs: this.crabRoot.visible ? Math.min(this.crabs.length, this.dockAnchors.length) : 0,
      cats: this.catRoot.visible ? this.visibleCatCount : 0,
      catCapacity: this.catCapacity,
      kittens: this.kittenCount,
      migratingCats: timeBefore(this.lastRealTime, this.migrationUntil) ? this.migratingCatCount : 0,
      turtles: this.turtleRoot.visible && this.waterAnchors.length
        ? this.turtles.filter((turtle) => turtle.model.visible).length
        : 0,
      butterflies: this.butterflyRoot.visible ? Math.min(this.butterflies.length, Math.max(0, this.gardenAnchors.length * 3)) : 0,
      whale: this.marineRoot.visible && this.marineVisitors.whale.model.visible ? 1 : 0,
      dolphins: this.marineRoot.visible && this.marineVisitors.dolphins.model.visible ? 3 : 0,
      squids: this.marineRoot.visible && this.marineVisitors.squids.model.visible ? 4 : 0,
      tuna: this.marineRoot.visible && this.marineVisitors.tuna.model.visible ? 11 : 0,
    };
  }

  catMemoryFromObject(object: THREE.Object3D | null, absoluteHours: number, colonyFoundedAt?: number): CatMemoryInspection | null {
    let current = object;
    while (current && current !== this.catRoot) {
      const index = current.userData.catIndex as number | undefined;
      if (index !== undefined) {
        const colonyAge = ageInHours(colonyFoundedAt, absoluteHours);
        const bornAfter = index < 3 ? 0 : (index - 2) * KITTEN_INTERVAL_HOURS;
        const catAge = Math.max(0, colonyAge - bornAfter);
        const kitten = index >= 3 && catAge < KITTEN_GROWTH_HOURS;
        const family = current.userData.catFamily as number;
        return {
          kind: 'cat',
          title: kitten ? 'Harbor kitten' : index < 3 ? 'Founding harbor cat' : 'Harbor cat',
          ageLabel: describeAge(catAge),
          detail: kitten ? `A young member of coat-family ${family + 1}.` : `One of ${this.visibleCatCount} cats living around the harbor.`,
          note: index < 3 ? 'It was here when the colony first gathered.' : 'Its coat and markings echo one of the colony founders.',
        };
      }
      current = current.parent;
    }
    return null;
  }

  wildlifeMemoryFromObject(object: THREE.Object3D | null, absoluteHours: number, colonyFoundedAt?: number, instanceId?: number): WildlifeMemoryInspection | null {
    if (!object || !this.isVisibleInScene(object)) return null;
    const instanceSource = object instanceof THREE.InstancedMesh && instanceId !== undefined
      ? (object.userData.visibleActorSources as THREE.Group[] | undefined)?.[instanceId]
      : undefined;
    const observedObject = instanceSource ?? object;
    let current: THREE.Object3D | null = observedObject;
    while (current && current !== this.root) {
      const wildlife = current.userData.wildlifeObservation as ObservableWildlife | undefined;
      if (wildlife === 'cat') {
        const individual = this.catMemoryFromObject(observedObject, absoluteHours, colonyFoundedAt);
        if (individual) return individual;
        return {
          kind: 'cat',
          title: 'Harbor cats',
          ageLabel: describeAge(ageInHours(colonyFoundedAt, absoluteHours)),
          detail: `${this.visibleCatCount} ${this.visibleCatCount === 1 ? 'cat lives' : 'cats live'} among the inns, gardens, and fishmongers.`,
          note: this.kittenCount ? `${this.kittenCount} of them ${this.kittenCount === 1 ? 'is a growing kitten' : 'are growing kittens'}.` : 'The adult cats make the same rounds each day.',
        };
      }
      const observation = wildlife ? this.waterlifeObservation(wildlife) : null;
      if (observation) return observation;
      current = current.parent;
    }
    return null;
  }

  private isVisibleInScene(object: THREE.Object3D) {
    if (object instanceof THREE.InstancedMesh && object.count === 0) return false;
    for (let current: THREE.Object3D | null = object; current && current !== this.root.parent; current = current.parent) {
      if (!current.visible) return false;
    }
    return true;
  }

  private waterlifeObservation(wildlife: Exclude<ObservableWildlife, 'cat'>): WildlifeMemoryInspection {
    const observations: Record<Exclude<ObservableWildlife, 'cat'>, Omit<WildlifeMemoryInspection, 'kind'>> = {
      fish: {
        title: 'Silver shoal', ageLabel: 'Sheltered-water residents',
        detail: 'Silver fish circle below the calmer water inside the harbor.',
        note: 'They gather where walls, canals, and quays soften the open tide.',
      },
      crab: {
        title: 'Quay crab', ageLabel: 'Low-tide forager',
        detail: 'A red crab patrols the damp edge of the dock.',
        note: 'It moves sideways between barnacled stones and dropped scraps.',
      },
      turtle: {
        title: 'Harbor turtle', ageLabel: 'Rare tide-wanderer',
        detail: 'A solitary sea turtle rises from the deeper harbor water.',
        note: 'Sightings are rare. Before long, it paddles back out to sea.',
      },
      whale: {
        title: 'Passing whale', ageLabel: 'Deep-water visitor',
        detail: 'A broad-backed whale surfaces with a slow tail stroke and a misty breath.',
        note: 'Its long pectoral fins and wide flukes carry it through the deep water beyond the harbor walls.',
      },
      dolphins: {
        title: 'Dolphin pod', ageLabel: 'Playful visitors',
        detail: 'Three dolphins arc through the swell in a loose traveling pod.',
        note: 'The leader rises first and the others follow around the town\'s shoreline.',
      },
      squids: {
        title: 'Drifting jellyfish', ageLabel: 'Below the surface',
        detail: 'Translucent jellyfish pulse through the green-blue water.',
        note: 'They are easiest to see when the tide carries them close to shore.',
      },
      tuna: {
        title: 'Passing tuna', ageLabel: 'Open-water school',
        detail: 'A tight school of tuna streams past the harbor.',
        note: 'The whole group turns almost as if it were a single creature.',
      },
    };
    return { kind: 'wildlife', ...observations[wildlife] };
  }

  private exteriorAnchor(x: number, z: number, occupied: ReadonlyMap<string, Cell>, distance: number) {
    const [dx, dz] = CARDINALS[facadeDirectionAt(x, z, occupied, this.seed)];
    return new THREE.Vector3(x * CELL + dx * CELL * distance, .28, z * CELL + dz * CELL * distance);
  }

  private groupFor(animal: WildlifeKind) {
    if (animal === 'gulls') return this.gullRoot;
    if (animal === 'fish') return this.fishRoot;
    if (animal === 'crabs') return this.crabRoot;
    if (animal === 'cats') return this.catRoot;
    return this.butterflyRoot;
  }

  /**
   * Render many independently moving tiny actors as a few material batches.
   * Their hidden source groups remain in place for simulation and per-animal inspection.
   */
  private createActorInstances(parent: THREE.Group, actors: THREE.Group[]) {
    const layouts = new Map<string, { material: THREE.Material; geometry: THREE.BufferGeometry; sources: THREE.Group[] }>();
    for (const actor of actors) {
      const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
      for (const child of actor.children) {
        if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) continue;
        const material = child.material as THREE.Material;
        const meshes = byMaterial.get(material) ?? [];
        meshes.push(child);
        byMaterial.set(material, meshes);
      }
      for (const [material, meshes] of byMaterial) {
        const keepIndexed = meshes.every((mesh) => mesh.geometry.index !== null);
        const parts = meshes.map((mesh) => {
          mesh.updateMatrix();
          const geometry = keepIndexed || !mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.toNonIndexed();
          geometry.applyMatrix4(mesh.matrix);
          return geometry;
        });
        const geometry = parts.length === 1 ? parts[0] : mergeGeometries(parts, false);
        if (parts.length > 1) parts.forEach((part) => part.dispose());
        if (!geometry) continue;
        const existing = layouts.get(material.uuid);
        if (existing) {
          existing.sources.push(actor);
          geometry.dispose();
        } else layouts.set(material.uuid, { material, geometry, sources: [actor] });
      }
      actor.children.forEach((child) => {
        if (child instanceof THREE.Mesh) child.visible = false;
      });
    }
    for (const layout of layouts.values()) {
      const mesh = new THREE.InstancedMesh(layout.geometry, layout.material, layout.sources.length);
      mesh.name = `${parent.name}-instances`;
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.userData.wildlifeObservation = layout.sources[0]?.userData.wildlifeObservation;
      this.addActorInstanceRaycast(mesh);
      parent.add(mesh);
      this.actorInstanceBatches.push({ mesh, parent, sources: layout.sources });
    }
  }

  private addActorInstanceRaycast(mesh: THREE.InstancedMesh) {
    const wildlife = mesh.userData.wildlifeObservation as ObservableWildlife | undefined;
    const radius = wildlife === 'dolphins' ? .62
      : wildlife === 'turtle' ? .46
        : wildlife === 'cat' ? .38
          : wildlife === 'fish' || wildlife === 'tuna' ? .34
            : .3;
    const instance = new THREE.Matrix4();
    const world = new THREE.Matrix4();
    const center = new THREE.Vector3();
    const closest = new THREE.Vector3();
    mesh.raycast = (raycaster, intersections) => {
      mesh.updateWorldMatrix(true, false);
      for (let instanceId = 0; instanceId < mesh.count; instanceId++) {
        mesh.getMatrixAt(instanceId, instance);
        world.multiplyMatrices(mesh.matrixWorld, instance);
        center.setFromMatrixPosition(world);
        raycaster.ray.closestPointToPoint(center, closest);
        if (closest.distanceToSquared(center) > radius * radius) continue;
        const distance = raycaster.ray.origin.distanceTo(closest);
        if (distance < raycaster.near || distance > raycaster.far) continue;
        intersections.push({ distance, point: closest.clone(), object: mesh, instanceId });
      }
    };
  }

  private updateActorInstances() {
    for (const batch of this.actorInstanceBatches) {
      if (!batch.parent.visible) {
        batch.mesh.count = 0;
        continue;
      }
      batch.parent.updateWorldMatrix(true, false);
      this.inverseParentMatrix.copy(batch.parent.matrixWorld).invert();
      let count = 0;
      const visibleActorSources = (batch.mesh.userData.visibleActorSources ??= []) as THREE.Group[];
      visibleActorSources.length = 0;
      for (const source of batch.sources) {
        if (!this.actorSourceVisible(source, batch.parent)) continue;
        source.updateWorldMatrix(true, false);
        visibleActorSources.push(source);
        batch.mesh.setMatrixAt(count++, this.instanceMatrix.multiplyMatrices(this.inverseParentMatrix, source.matrixWorld));
        batch.mesh.setColorAt(count - 1, source.userData.instanceColor instanceof THREE.Color ? source.userData.instanceColor : INSTANCE_WHITE);
      }
      batch.mesh.count = count;
      if (count) {
        batch.mesh.instanceMatrix.needsUpdate = true;
        if (batch.mesh.instanceColor) batch.mesh.instanceColor.needsUpdate = true;
        // Moving instances invalidate Three's lazily cached raycast bounds.
        batch.mesh.boundingBox = null;
        batch.mesh.boundingSphere = null;
      }
    }
  }

  private actorSourceVisible(source: THREE.Object3D, parent: THREE.Object3D) {
    for (let current: THREE.Object3D | null = source; current && current !== parent; current = current.parent) {
      if (!current.visible) return false;
    }
    return true;
  }

  private createAmbientBirds() {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const colors = [0xb8c6c1, 0xd8d9ce, 0x9fafaD].map((color) => new THREE.Color(color));
    const wingGeometry = new THREE.BufferGeometry();
    wingGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      0, 0, .065,
      .36, .008, -.015,
      .255, 0, -.135,
      .035, 0, -.075,
    ], 3));
    wingGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    wingGeometry.computeVertexNormals();
    const formation = [
      [0, .12, .26],
      [-.58, 0, -.28], [.58, -.05, -.28],
      [-1.04, -.12, -.78], [1.04, -.08, -.78],
      [0, -.2, -1.08],
    ] as const;
    const bodies: THREE.Group[] = [];
    const wings: THREE.Group[] = [];
    for (let index = 0; index < 6; index++) {
      const model = new THREE.Group();
      const color = colors[index % colors.length];
      model.userData.instanceColor = color;
      const body = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 5), material);
      body.scale.set(.72, .58, 1.55);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.06, 7, 5), material);
      head.position.set(0, .018, .145);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(.023, .1, 5), material);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, .01, .225);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(.065, .14, 4), material);
      tail.rotation.x = -Math.PI / 2;
      tail.position.set(0, 0, -.165);
      model.add(body, head, beak, tail);
      const birdWings: THREE.Group[] = [];
      for (const side of [-1, 1]) {
        const wing = new THREE.Group();
        wing.name = 'ambient-bird-wing';
        wing.scale.x = side;
        wing.position.set(0, .015, .015);
        wing.userData.instanceColor = color;
        wing.add(new THREE.Mesh(wingGeometry, material));
        model.add(wing);
        birdWings.push(wing);
        wings.push(wing);
      }
      consolidateActor(model);
      const [baseX, baseY, baseZ] = formation[index];
      model.position.set(baseX, baseY, baseZ);
      model.scale.setScalar(.88 + index % 3 * .035);
      this.ambientBirds.add(model);
      bodies.push(model);
      this.ambientBirdActors.push({
        model,
        leftWing: birdWings[0],
        rightWing: birdWings[1],
        baseX,
        baseY,
        baseZ,
        phase: hash(this.seed, index, 0, 2197) * Math.PI * 2,
      });
    }
    this.createActorInstances(this.ambientBirds, bodies);
    this.createActorInstances(this.ambientBirds, wings);
  }

  private createGulls() {
    const white = new THREE.MeshStandardMaterial({ color: 0xe9e5d8, roughness: .88 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x3f5154, roughness: .92 });
    for (let index = 0; index < 6; index++) {
      const model = new THREE.Group();
      const body = new THREE.Mesh(new THREE.SphereGeometry(.11, 7, 5), white);
      body.scale.set(.75, .7, 1.55);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.075, 7, 5), white);
      head.position.set(0, .055, .16);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(.025, .1, 5), dark);
      beak.rotation.x = Math.PI / 2;
      beak.position.set(0, .045, .25);
      const wingGeometry = new THREE.BoxGeometry(.28, .018, .09);
      const leftWing = new THREE.Mesh(wingGeometry, white);
      const rightWing = new THREE.Mesh(wingGeometry, white);
      leftWing.position.x = -.17;
      rightWing.position.x = .17;
      model.add(body, head, beak, leftWing, rightWing);
      consolidateActor(model, new Set([leftWing, rightWing]));
      model.scale.setScalar(.78);
      model.position.copy(this.townCenter).setY(4 + index * .12);
      this.gullRoot.add(model);
      this.gulls.push({ model, leftWing, rightWing, phase: hash(this.seed, index, 0, 2301) * Math.PI * 2, mode: 'flying' });
    }
    this.createActorInstances(this.gullRoot, this.gulls.map((gull) => gull.model));
  }

  private createFishSchools() {
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .64, depthWrite: false, side: THREE.DoubleSide });
    const colors = [0x315f65, 0x5b7c78, 0x9a8058].map((color) => new THREE.Color(color));
    const tailGeometry = new THREE.BufferGeometry();
    tailGeometry.setAttribute('position', new THREE.Float32BufferAttribute([
      .015, 0, 0,
      -.15, .105, 0,
      -.105, 0, 0,
      -.15, -.105, 0,
    ], 3));
    tailGeometry.setIndex([0, 1, 2, 0, 2, 3]);
    tailGeometry.computeVertexNormals();
    const fishActors: THREE.Group[] = [];
    const tailActors: THREE.Group[] = [];
    for (let schoolIndex = 0; schoolIndex < 3; schoolIndex++) {
      const school = new THREE.Group();
      const schoolFish: SchoolFishActor[] = [];
      for (let fishIndex = 0; fishIndex < 5; fishIndex++) {
        const fish = new THREE.Group();
        fish.userData.wildlifeObservation = 'fish' satisfies ObservableWildlife;
        const color = colors[(schoolIndex + fishIndex) % colors.length];
        fish.userData.instanceColor = color;
        const body = new THREE.Mesh(new THREE.SphereGeometry(.09, 9, 6), material);
        body.scale.set(1.9, .5, .76);
        const dorsal = new THREE.Mesh(new THREE.ConeGeometry(.043, .13, 3), material);
        dorsal.position.set(-.015, .09, 0);
        dorsal.scale.z = .42;
        const tail = new THREE.Group();
        tail.name = 'fish-tail';
        tail.position.x = -.17;
        tail.userData.instanceColor = color;
        tail.userData.wildlifeObservation = 'fish' satisfies ObservableWildlife;
        tail.add(new THREE.Mesh(tailGeometry, material));
        fish.add(body, dorsal, tail);
        for (const side of [-1, 1]) {
          const fin = new THREE.Mesh(new THREE.ConeGeometry(.025, .12, 3), material);
          fin.position.set(.025, -.025, side * .065);
          fin.rotation.x = side * Math.PI / 2;
          fin.rotation.z = -.35;
          fish.add(fin);
        }
        consolidateActor(fish);
        const baseX = (fishIndex - 2) * .23;
        const baseZ = Math.sin(fishIndex * 2) * .18;
        const phase = hash(this.seed, schoolIndex, fishIndex, 3321) * Math.PI * 2;
        fish.position.set(baseX, 0, baseZ);
        school.add(fish);
        fishActors.push(fish);
        tailActors.push(tail);
        schoolFish.push({ model: fish, tail, baseX, baseZ, phase });
      }
      this.fishRoot.add(school);
      this.fishSchools.push({ model: school, fish: schoolFish, phase: hash(this.seed, schoolIndex, 0, 3320) * Math.PI * 2 });
    }
    this.createActorInstances(this.fishRoot, fishActors);
    this.createActorInstances(this.fishRoot, tailActors);
  }

  private createCrabs() {
    const shellMaterial = new THREE.MeshStandardMaterial({ color: 0xb84f3e, roughness: .92 });
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x783c35, roughness: 1 });
    for (let index = 0; index < 5; index++) {
      const crab = new THREE.Group();
      crab.userData.wildlifeObservation = 'crab' satisfies ObservableWildlife;
      const shell = new THREE.Mesh(new THREE.SphereGeometry(.1, 7, 5), shellMaterial);
      shell.scale.set(1.35, .45, .85);
      crab.add(shell);
      for (const side of [-1, 1]) for (let leg = 0; leg < 3; leg++) {
        const limb = new THREE.Mesh(new THREE.CylinderGeometry(.012, .018, .16, 5), legMaterial);
        limb.rotation.z = Math.PI / 2 + side * .35;
        limb.rotation.y = (leg - 1) * .35;
        limb.position.set(side * .12, -.015, (leg - 1) * .06);
        crab.add(limb);
      }
      consolidateActor(crab);
      crab.scale.setScalar(.85);
      this.crabRoot.add(crab);
      this.crabs.push(crab);
    }
    this.createActorInstances(this.crabRoot, this.crabs);
  }

  private createCats() {
    const coatMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .94 });
    const faceMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: .9 });
    const coatColors = [0xc58b51, 0x4b4a4c, 0xe1c6a0].map((color) => new THREE.Color(color));
    const faceColors = [0x49362e, 0x24292a, 0x665344].map((color) => new THREE.Color(color));
    const torsos: THREE.Group[] = [];
    const heads: THREE.Group[] = [];
    const tails: THREE.Group[] = [];
    const faces: THREE.Group[] = [];
    for (let index = 0; index < 12; index++) {
      // Later kittens deterministically inherit one of the founding coats.
      const family = index < 3 ? index : Math.floor(hash(this.seed, index, 0, 2840) * 3);
      const coat = coatColors[family].clone();
      coat.offsetHSL((hash(this.seed, index, family, 2842) - .5) * .018, 0, (hash(this.seed, index, family, 2843) - .5) * .07);
      const cat = new THREE.Group();
      cat.userData.catIndex = index;
      cat.userData.catFamily = family;
      cat.userData.wildlifeObservation = 'cat' satisfies ObservableWildlife;

      const torso = new THREE.Group();
      torso.name = 'cat-torso';
      torso.userData.instanceColor = coat;
      torso.userData.wildlifeObservation = 'cat' satisfies ObservableWildlife;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(.085, .24, 3, 8), coatMaterial);
      body.rotation.z = Math.PI / 2;
      body.position.y = .145;
      const haunch = new THREE.Mesh(new THREE.SphereGeometry(.115, 8, 6), coatMaterial);
      haunch.scale.set(.95, 1.02, .86);
      haunch.position.set(-.15, .13, 0);
      const chest = new THREE.Mesh(new THREE.SphereGeometry(.095, 8, 6), coatMaterial);
      chest.scale.set(.78, 1.08, .82);
      chest.position.set(.135, .15, 0);
      torso.add(body, haunch, chest);
      for (const x of [-.13, .13]) for (const side of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.CylinderGeometry(.024, .029, .14, 6), coatMaterial);
        leg.position.set(x, .055, side * .064);
        const paw = new THREE.Mesh(new THREE.SphereGeometry(.033, 6, 4), coatMaterial);
        paw.scale.set(1.32, .48, .82);
        paw.position.set(x + .015, -.012, side * .066);
        torso.add(leg, paw);
      }
      consolidateActor(torso);

      const head = new THREE.Group();
      head.name = 'cat-head';
      head.position.set(.225, .245, 0);
      head.userData.instanceColor = coat;
      head.userData.wildlifeObservation = 'cat' satisfies ObservableWildlife;
      const skull = new THREE.Mesh(new THREE.SphereGeometry(.105, 9, 6), coatMaterial);
      skull.scale.set(.98, .94, .92);
      head.add(skull);
      for (const z of [-.06, .06]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(.044, .105, 4), coatMaterial);
        ear.position.set(-.008, .105, z);
        ear.rotation.z = -.08;
        const muzzle = new THREE.Mesh(new THREE.SphereGeometry(.04, 7, 5), coatMaterial);
        muzzle.scale.set(.8, .65, .72);
        muzzle.position.set(.082, -.027, z * .56);
        head.add(ear, muzzle);
      }
      consolidateActor(head);

      const face = new THREE.Group();
      face.name = 'cat-face';
      face.userData.instanceColor = faceColors[family];
      face.userData.wildlifeObservation = 'cat' satisfies ObservableWildlife;
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(.013, 6, 4), faceMaterial);
        eye.position.set(.088, .025, side * .056);
        face.add(eye);
      }
      const nose = new THREE.Mesh(new THREE.SphereGeometry(.012, 6, 4), faceMaterial);
      nose.scale.set(.82, .7, 1);
      nose.position.set(.116, -.028, 0);
      face.add(nose);
      consolidateActor(face);
      head.add(face);

      const tail = new THREE.Group();
      tail.name = 'cat-tail';
      tail.position.set(-.235, .14, 0);
      tail.userData.instanceColor = coat;
      tail.userData.wildlifeObservation = 'cat' satisfies ObservableWildlife;
      const tailCurve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(-.105, .012, 0),
        new THREE.Vector3(-.18, .095, .008),
        new THREE.Vector3(-.145, .215, .018),
        new THREE.Vector3(-.06, .275, .025),
      ]);
      tail.add(new THREE.Mesh(new THREE.TubeGeometry(tailCurve, 10, .022, 5, false), coatMaterial));

      cat.add(torso, head, tail);
      cat.scale.setScalar(.9);
      this.catRoot.add(cat);
      torsos.push(torso);
      heads.push(head);
      tails.push(tail);
      faces.push(face);
      this.cats.push({ model: cat, torso, head, tail, phase: hash(this.seed, index, family, 2844) * Math.PI * 2 });
    }
    this.createActorInstances(this.catRoot, torsos);
    this.createActorInstances(this.catRoot, heads);
    this.createActorInstances(this.catRoot, tails);
    this.createActorInstances(this.catRoot, faces);
  }

  private createTurtles() {
    const shellMaterial = new THREE.MeshStandardMaterial({ color: 0x58725b, roughness: .9 });
    const skin = new THREE.MeshStandardMaterial({ color: 0x78947b, roughness: .95, side: THREE.DoubleSide });
    const paddleShape = new THREE.Shape();
    paddleShape.moveTo(-.045, 0);
    paddleShape.lineTo(.05, 0);
    paddleShape.lineTo(.092, .2);
    paddleShape.lineTo(.052, .4);
    paddleShape.lineTo(-.006, .53);
    paddleShape.lineTo(-.066, .48);
    paddleShape.lineTo(-.098, .24);
    paddleShape.closePath();
    const paddleGeometry = new THREE.ExtrudeGeometry(paddleShape, {
      depth: .02,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: .008,
      bevelThickness: .006,
      curveSegments: 1,
    });
    paddleGeometry.translate(0, 0, -.01);
    paddleGeometry.rotateX(Math.PI / 2);
    const frontFlipperActors: THREE.Group[] = [];
    for (let index = 0; index < 1; index++) {
      const turtle = new THREE.Group();
      turtle.userData.wildlifeObservation = 'turtle' satisfies ObservableWildlife;
      const shell = new THREE.Mesh(new THREE.SphereGeometry(.22, 9, 6), shellMaterial);
      shell.scale.set(1.25, .34, .88);
      const neck = new THREE.Mesh(new THREE.SphereGeometry(.075, 7, 5), skin);
      neck.scale.set(1.45, .55, .7);
      neck.position.set(.235, -.015, 0);
      const head = new THREE.Mesh(new THREE.SphereGeometry(.075, 7, 5), skin);
      head.scale.set(1.25, .72, .82);
      head.position.set(.34, -.01, 0);
      turtle.add(shell, neck, head);
      for (const x of [-.12, .02, .14]) {
        const scute = new THREE.Mesh(new THREE.SphereGeometry(.09, 7, 5), shellMaterial);
        scute.scale.set(.68, .18, .66);
        scute.position.set(x, .073, 0);
        turtle.add(scute);
      }
      for (const side of [-1, 1]) {
        const eye = new THREE.Mesh(new THREE.SphereGeometry(.014, 5, 4), shellMaterial);
        eye.position.set(.398, .007, side * .047);
        turtle.add(eye);
      }
      const frontFlippers: THREE.Group[] = [];
      for (const side of [-1, 1] as const) {
        const frontFlipper = new THREE.Group();
        frontFlipper.name = 'turtle-front-paddle';
        frontFlipper.userData.wildlifeObservation = 'turtle' satisfies ObservableWildlife;
        frontFlipper.position.set(.09, -.012, side * .145);
        frontFlipper.scale.z = side;
        frontFlipper.rotation.y = -side * .18;
        frontFlipper.add(new THREE.Mesh(paddleGeometry, skin));
        turtle.add(frontFlipper);
        frontFlipperActors.push(frontFlipper);
        frontFlippers.push(frontFlipper);

        const backFlipper = new THREE.Mesh(paddleGeometry.clone(), skin);
        backFlipper.scale.set(.68, .72, side * .55);
        backFlipper.position.set(-.17, -.02, side * .135);
        backFlipper.rotation.y = -side * .52;
        turtle.add(backFlipper);
      }
      const tail = new THREE.Mesh(new THREE.ConeGeometry(.035, .12, 5), skin);
      tail.rotation.z = Math.PI / 2;
      tail.position.x = -.27;
      turtle.add(tail);
      consolidateActor(turtle);
      turtle.scale.setScalar(TURTLE_SCALE);
      this.turtleRoot.add(turtle);
      this.turtles.push({
        model: turtle,
        frontFlippers: frontFlippers as [THREE.Group, THREE.Group],
        phase: hash(this.seed, index, 0, 3612) * Math.PI * 2,
      });
    }
    this.createActorInstances(this.turtleRoot, this.turtles.map((turtle) => turtle.model));
    this.createActorInstances(this.turtleRoot, frontFlipperActors);
  }

  private createButterflies() {
    const colors = [0xe9ad42, 0x74a5a0, 0xd4737d];
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    for (let index = 0; index < 12; index++) {
      const butterfly = new THREE.Group();
      butterfly.userData.instanceColor = new THREE.Color(colors[index % colors.length]);
      const left = new THREE.Mesh(new THREE.CircleGeometry(.07, 5, 0, Math.PI), material);
      const right = new THREE.Mesh(new THREE.CircleGeometry(.07, 5, 0, Math.PI), material);
      left.position.x = -.045;
      right.position.x = .045;
      left.userData.wingSide = -1;
      right.userData.wingSide = 1;
      butterfly.add(left, right);
      consolidateActor(butterfly);
      this.butterflyRoot.add(butterfly);
      this.butterflies.push(butterfly);
    }
    this.createActorInstances(this.butterflyRoot, this.butterflies);
  }

  private createMarineVisitors() {
    const emptyRoute = createShorelineRoute([], this.seed, 1.5);
    const whale = this.createWhale();
    const dolphins = this.createDolphinPod();
    const squids = this.createSquidGroup();
    const tuna = this.createTunaPack();
    this.marineRoot.add(whale, dolphins, squids, tuna);

    const visitor = (
      model: THREE.Group,
      phase: number,
      speed: number,
      cycle: number,
      duration: number,
      salt: number,
    ): MarineVisitor => ({
      model,
      route: emptyRoute,
      phase,
      speed,
      cycle,
      duration,
      scheduleOffset: hash(this.seed, salt, 0, 4700) * cycle,
    });

    return {
      whale: visitor(whale, .13, .0046, 110, 20, 1),
      dolphins: visitor(dolphins, .39, .0105, 70, 24, 2),
      squids: visitor(squids, .64, .0072, 80, 30, 3),
      tuna: visitor(tuna, .82, .0135, 64, 34, 4),
    };
  }

  private createWhale() {
    const whale = new THREE.Group();
    whale.name = 'whale';
    whale.userData.wildlifeObservation = 'whale' satisfies ObservableWildlife;
    const blue = new THREE.MeshStandardMaterial({ color: 0x3d6871, roughness: .8 });
    const pale = new THREE.MeshStandardMaterial({ color: 0x91aaa5, roughness: .88 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(.5, 12, 7), blue);
    body.scale.set(2.55, .68, .82);
    body.position.x = -.08;
    const belly = new THREE.Mesh(new THREE.SphereGeometry(.46, 10, 6), pale);
    belly.scale.set(2.28, .34, .62);
    belly.position.set(.08, -.245, 0);
    const brow = new THREE.Mesh(new THREE.SphereGeometry(.34, 9, 6), blue);
    brow.scale.set(1.45, .62, .94);
    brow.position.set(.92, -.005, 0);
    const rostrum = new THREE.Mesh(new THREE.SphereGeometry(.27, 9, 6), blue);
    rostrum.scale.set(1.45, .42, .9);
    rostrum.position.set(1.18, -.08, 0);
    const jaw = new THREE.Mesh(new THREE.SphereGeometry(.25, 9, 5), pale);
    jaw.scale.set(1.48, .34, .76);
    jaw.position.set(1.12, -.22, 0);
    const dorsalShape = new THREE.Shape();
    dorsalShape.moveTo(-.2, 0);
    dorsalShape.lineTo(.17, 0);
    dorsalShape.quadraticCurveTo(.02, .13, -.05, .3);
    dorsalShape.quadraticCurveTo(-.11, .27, -.2, 0);
    dorsalShape.closePath();
    const dorsalGeometry = new THREE.ExtrudeGeometry(dorsalShape, {
      depth: .09, bevelEnabled: true, bevelSegments: 1, bevelSize: .012, bevelThickness: .01, curveSegments: 2,
    });
    dorsalGeometry.translate(0, 0, -.045);
    const dorsal = new THREE.Mesh(dorsalGeometry, blue);
    dorsal.position.set(-.18, .25, 0);
    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(new THREE.ConeGeometry(.15, .98, 7), blue);
      fin.scale.x = .72;
      fin.position.set(.18, -.12, side * .43);
      fin.rotation.x = side * Math.PI / 2;
      fin.rotation.y = -side * .5;
      whale.add(fin);
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.025, 6, 4), pale);
      eye.scale.set(1.2, .72, .55);
      eye.position.set(.98, .075, side * .35);
      whale.add(eye);
    }
    for (let index = 0; index < 5; index++) {
      const tubercle = new THREE.Mesh(new THREE.SphereGeometry(.025, 5, 4), blue);
      tubercle.position.set(1.08 + index % 3 * .09, .13 - Math.floor(index / 3) * .025, (index % 2 ? -1 : 1) * (.06 + index * .018));
      whale.add(tubercle);
    }
    for (const side of [-1, 1]) {
      const blowhole = new THREE.Mesh(new THREE.SphereGeometry(.027, 6, 4), pale);
      blowhole.scale.set(1.45, .28, .65);
      blowhole.position.set(.93, .205, side * .04);
      whale.add(blowhole);
    }
    const tail = new THREE.Group();
    tail.name = 'whale-tail';
    tail.position.x = -1.13;
    const tailStock = new THREE.Mesh(new THREE.CylinderGeometry(.055, .18, .66, 8), blue);
    tailStock.rotation.z = Math.PI / 2;
    tailStock.position.x = -.26;
    tail.add(tailStock);
    const flukeShape = new THREE.Shape();
    flukeShape.moveTo(-.13, 0);
    flukeShape.lineTo(-.24, .1);
    flukeShape.lineTo(-.34, .42);
    flukeShape.lineTo(-.5, .59);
    flukeShape.lineTo(-.62, .51);
    flukeShape.lineTo(-.55, .25);
    flukeShape.lineTo(-.37, .045);
    flukeShape.lineTo(-.46, 0);
    flukeShape.lineTo(-.37, -.045);
    flukeShape.lineTo(-.55, -.25);
    flukeShape.lineTo(-.62, -.51);
    flukeShape.lineTo(-.5, -.59);
    flukeShape.lineTo(-.34, -.42);
    flukeShape.lineTo(-.24, -.1);
    flukeShape.closePath();
    const flukeGeometry = new THREE.ExtrudeGeometry(flukeShape, {
      depth: .055,
      bevelEnabled: true,
      bevelSegments: 1,
      bevelSize: .012,
      bevelThickness: .01,
      curveSegments: 1,
    });
    flukeGeometry.translate(0, 0, -.0275);
    flukeGeometry.rotateX(Math.PI / 2);
    tail.add(new THREE.Mesh(flukeGeometry, blue));
    consolidateActor(tail);
    const spout = new THREE.Group();
    spout.name = 'whale-spout';
    const spray = new THREE.MeshBasicMaterial({ color: 0xc5e2dd, transparent: true, opacity: .72, depthWrite: false });
    for (let index = 0; index < 7; index++) {
      const height = index * .115;
      const spread = Math.max(0, index - 2) * .045;
      const drop = new THREE.Mesh(new THREE.SphereGeometry(.028 + index * .005, 5, 4), spray);
      drop.scale.set(.75, 1.35, .75);
      drop.position.set(-index * .006, height, (index % 2 ? -1 : 1) * spread);
      spout.add(drop);
    }
    spout.position.set(.93, .215, 0);
    consolidateActor(spout);
    whale.add(body, belly, brow, rostrum, jaw, dorsal, tail, spout);
    consolidateActor(whale);
    addPickSphere(whale, 1.35);
    whale.userData.baseScale = 1;
    whale.userData.tail = tail;
    return whale;
  }

  private createDolphinPod() {
    const pod = new THREE.Group();
    pod.name = 'dolphin-pod';
    pod.userData.wildlifeObservation = 'dolphins' satisfies ObservableWildlife;
    const blue = new THREE.MeshStandardMaterial({ color: 0x56828a, roughness: .76, side: THREE.DoubleSide });
    const pale = new THREE.MeshStandardMaterial({ color: 0xa8bbb2, roughness: .86 });
    const detail = new THREE.MeshStandardMaterial({ color: 0x173d43, roughness: .82 });
    const dolphinActors: THREE.Group[] = [];
    const dorsalShape = new THREE.Shape();
    dorsalShape.moveTo(-.12, 0);
    dorsalShape.lineTo(.07, 0);
    dorsalShape.quadraticCurveTo(0, .07, -.05, .18);
    dorsalShape.quadraticCurveTo(-.082, .125, -.12, 0);
    dorsalShape.closePath();
    const pectoralShape = new THREE.Shape();
    pectoralShape.moveTo(.065, 0);
    pectoralShape.lineTo(-.045, 0);
    pectoralShape.lineTo(-.085, .1);
    pectoralShape.quadraticCurveTo(-.13, .27, -.105, .37);
    pectoralShape.quadraticCurveTo(-.045, .29, .065, .035);
    pectoralShape.closePath();
    const flukeShape = new THREE.Shape();
    flukeShape.moveTo(-.01, 0);
    flukeShape.lineTo(-.05, .04);
    flukeShape.lineTo(-.09, .2);
    flukeShape.lineTo(-.16, .34);
    flukeShape.lineTo(-.22, .3);
    flukeShape.lineTo(-.17, .13);
    flukeShape.lineTo(-.11, .025);
    flukeShape.lineTo(-.16, 0);
    flukeShape.lineTo(-.11, -.025);
    flukeShape.lineTo(-.17, -.13);
    flukeShape.lineTo(-.22, -.3);
    flukeShape.lineTo(-.16, -.34);
    flukeShape.lineTo(-.09, -.2);
    flukeShape.lineTo(-.05, -.04);
    flukeShape.closePath();
    const bodyProfile = [
      new THREE.Vector2(0, -.68),
      new THREE.Vector2(.045, -.61),
      new THREE.Vector2(.095, -.44),
      new THREE.Vector2(.14, -.22),
      new THREE.Vector2(.17, .05),
      new THREE.Vector2(.168, .24),
      new THREE.Vector2(.135, .43),
      new THREE.Vector2(.07, .55),
      new THREE.Vector2(0, .58),
    ];
    const formation = [
      [.32, 0],
      [-.36, -.58],
      [-.52, .58],
    ] as const;
    for (let index = 0; index < 3; index++) {
      const dolphin = new THREE.Group();
      dolphin.userData.podIndex = index;
      dolphin.userData.wildlifeObservation = 'dolphins' satisfies ObservableWildlife;
      dolphin.name = `dolphin-${index + 1}`;
      const bodyGeometry = new THREE.LatheGeometry(bodyProfile, 12);
      bodyGeometry.rotateZ(-Math.PI / 2);
      bodyGeometry.scale(1, 1, .86);
      const body = new THREE.Mesh(bodyGeometry, blue);
      const melon = new THREE.Mesh(new THREE.SphereGeometry(.13, 10, 7), blue);
      melon.scale.set(1.22, .84, .92);
      melon.position.set(.465, .035, 0);
      const belly = new THREE.Mesh(new THREE.SphereGeometry(.18, 9, 6), pale);
      belly.scale.set(1.95, .2, .52);
      belly.position.set(.1, -.125, 0);
      const beak = new THREE.Mesh(new THREE.CapsuleGeometry(.038, .19, 2, 7), blue);
      beak.rotation.z = Math.PI / 2;
      beak.position.set(.645, -.015, 0);
      const lowerJaw = new THREE.Mesh(new THREE.CapsuleGeometry(.027, .155, 2, 7), pale);
      lowerJaw.rotation.z = Math.PI / 2;
      lowerJaw.position.set(.63, -.043, 0);
      const dorsalGeometry = new THREE.ExtrudeGeometry(dorsalShape, {
        depth: .05, bevelEnabled: true, bevelSegments: 1, bevelSize: .008, bevelThickness: .007, curveSegments: 2,
      });
      dorsalGeometry.translate(0, 0, -.025);
      const dorsal = new THREE.Mesh(dorsalGeometry, blue);
      dorsal.position.set(-.09, .1, 0);
      const flukeGeometry = new THREE.ExtrudeGeometry(flukeShape, {
        depth: .028, bevelEnabled: true, bevelSegments: 1, bevelSize: .006, bevelThickness: .005, curveSegments: 1,
      });
      flukeGeometry.translate(0, 0, -.014);
      flukeGeometry.rotateX(Math.PI / 2);
      const flukes = new THREE.Mesh(flukeGeometry, blue);
      flukes.position.x = -.59;
      dolphin.add(flukes);
      for (const side of [-1, 1] as const) {
        const pectoralGeometry = new THREE.ExtrudeGeometry(pectoralShape, {
          depth: .022, bevelEnabled: true, bevelSegments: 1, bevelSize: .005, bevelThickness: .004, curveSegments: 2,
        });
        pectoralGeometry.translate(0, 0, -.011);
        pectoralGeometry.rotateX(Math.PI / 2);
        const pectoral = new THREE.Mesh(pectoralGeometry, blue);
        pectoral.position.set(.11, -.07, side * .11);
        pectoral.scale.z = side;
        pectoral.rotation.x = side * .12;
        pectoral.rotation.y = -side * .12;
        dolphin.add(pectoral);
        const eye = new THREE.Mesh(new THREE.SphereGeometry(.014, 6, 4), detail);
        eye.scale.set(1.2, .82, .62);
        eye.position.set(.51, .07, side * .13);
        const mouthCurve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(.555, -.04, side * .038),
          new THREE.Vector3(.635, -.05, side * .04),
          new THREE.Vector3(.715, -.043, side * .035),
        ]);
        const mouth = new THREE.Mesh(new THREE.TubeGeometry(mouthCurve, 4, .005, 4, false), detail);
        dolphin.add(eye, mouth);
      }
      const blowhole = new THREE.Mesh(new THREE.SphereGeometry(.022, 6, 4), detail);
      blowhole.scale.set(1.35, .25, .65);
      blowhole.position.set(.37, .17, 0);
      dolphin.add(body, melon, belly, beak, lowerJaw, dorsal, blowhole);
      consolidateActor(dolphin);
      dolphin.position.set(formation[index][0], 0, formation[index][1]);
      dolphin.userData.baseX = dolphin.position.x;
      dolphin.userData.baseZ = dolphin.position.z;
      dolphin.userData.motionPhase = -index * .72 + (hash(this.seed, index, 0, 4822) - .5) * .12;
      dolphin.scale.setScalar(.88 + index * .045);
      pod.add(dolphin);
      dolphinActors.push(dolphin);
    }
    this.createActorInstances(this.marineRoot, dolphinActors);
    pod.userData.baseScale = 1;
    return pod;
  }

  private createSquidGroup() {
    const group = new THREE.Group();
    group.name = 'squid-group';
    group.userData.wildlifeObservation = 'squids' satisfies ObservableWildlife;
    const colors = [0xaa6f79, 0xc28782, 0x8d6e88, 0xb77c68];
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, transparent: true, opacity: .72, roughness: .8, depthWrite: false,
    });
    const jellyfishActors: THREE.Group[] = [];
    for (let index = 0; index < 4; index++) {
      const squid = new THREE.Group();
      squid.userData.wildlifeObservation = 'squids' satisfies ObservableWildlife;
      squid.userData.instanceColor = new THREE.Color(colors[index]);
      const bell = new THREE.Mesh(new THREE.SphereGeometry(.2, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), material);
      bell.scale.set(1.08, .78, 1.08);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(.195, .023, 5, 10), material);
      rim.rotation.x = Math.PI / 2;
      for (let tentacle = 0; tentacle < 5; tentacle++) {
        const angle = tentacle / 5 * Math.PI * 2;
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(.012, .022, .3 + tentacle % 2 * .09, 5), material);
        arm.position.set(Math.cos(angle) * .105, -.17 - tentacle % 2 * .035, Math.sin(angle) * .105);
        arm.rotation.z = Math.sin(angle) * .14;
        arm.rotation.x = Math.cos(angle) * .14;
        squid.add(arm);
      }
      const oralArm = new THREE.Mesh(new THREE.CylinderGeometry(.025, .04, .34, 6), material);
      oralArm.position.y = -.19;
      squid.add(bell, rim, oralArm);
      consolidateActor(squid);
      squid.position.set(-index * .34, Math.sin(index) * .12, (index - 1.5) * .33);
      squid.userData.baseX = squid.position.x;
      squid.userData.baseZ = squid.position.z;
      squid.userData.baseScale = .8 + index * .055;
      squid.userData.motionPhase = hash(this.seed, index, 0, 4927) * Math.PI * 2;
      squid.scale.setScalar(squid.userData.baseScale);
      group.add(squid);
      jellyfishActors.push(squid);
    }
    this.createActorInstances(this.marineRoot, jellyfishActors);
    group.userData.baseScale = 1;
    return group;
  }

  private createTunaPack() {
    const pack = new THREE.Group();
    pack.name = 'tuna-pack';
    pack.userData.wildlifeObservation = 'tuna' satisfies ObservableWildlife;
    const silver = new THREE.MeshStandardMaterial({ color: 0x78999a, roughness: .7, metalness: .08, transparent: true, opacity: .78, depthWrite: false });
    const tunaActors: THREE.Group[] = [];
    for (let index = 0; index < 11; index++) {
      const fish = new THREE.Group();
      fish.userData.schoolIndex = index;
      fish.userData.wildlifeObservation = 'tuna' satisfies ObservableWildlife;
      const body = new THREE.Mesh(new THREE.SphereGeometry(.11, 7, 5), silver);
      body.scale.set(2.4, .55, .72);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(.1, .22, 3), silver);
      tail.rotation.z = -Math.PI / 2;
      tail.position.x = -.31;
      const dorsal = new THREE.Mesh(new THREE.ConeGeometry(.055, .16, 3), silver);
      dorsal.position.set(-.06, .1, 0);
      dorsal.scale.z = .38;
      fish.add(body, tail, dorsal);
      for (const side of [-1, 1]) {
        const fin = new THREE.Mesh(new THREE.ConeGeometry(.03, .14, 3), silver);
        fin.position.set(.01, -.025, side * .08);
        fin.rotation.x = side * Math.PI / 2;
        fin.rotation.z = -.32;
        fish.add(fin);
      }
      consolidateActor(fish);
      const row = Math.floor(index / 4);
      fish.position.set(-row * .36 - index % 4 * .18, (index % 3 - 1) * .08, (index % 4 - 1.5) * .25);
      fish.userData.baseX = fish.position.x;
      fish.userData.baseY = fish.position.y;
      fish.userData.baseZ = fish.position.z;
      fish.userData.motionPhase = hash(this.seed, index, row, 5063) * Math.PI * 2;
      pack.add(fish);
      tunaActors.push(fish);
    }
    this.createActorInstances(this.marineRoot, tunaActors);
    pack.userData.baseScale = 1;
    return pack;
  }

  private updateMarineVisitors(time: number) {
    if (!this.marineRoot.visible) return;
    const entries = Object.entries(this.marineVisitors) as Array<[keyof typeof this.marineVisitors, MarineVisitor]>;
    for (const [kind, visitor] of entries) {
      const localTime = (time + visitor.scheduleOffset) % visitor.cycle;
      const active = localTime < visitor.duration;
      visitor.model.visible = active;
      if (!active) continue;
      const edge = Math.min(1, localTime / 2.4, (visitor.duration - localTime) / 2.4);
      const easedScale = THREE.MathUtils.smoothstep(edge, 0, 1);
      const progress = (time * visitor.speed + visitor.phase) % 1;
      const point = visitor.route.getPointAt(progress);
      const tangent = visitor.route.getTangentAt(progress);
      const lateralDrift = Math.sin(time * .21 + visitor.phase * 13) * .09;
      point.x += tangent.z * lateralDrift;
      point.z -= tangent.x * lateralDrift;
      visitor.model.position.copy(point);
      visitor.model.rotation.y = Math.atan2(tangent.x, tangent.z) - Math.PI / 2;
      visitor.model.scale.setScalar(easedScale);

      if (kind === 'whale') {
        const breath = time * .43 + visitor.phase * Math.PI * 2;
        const surface = THREE.MathUtils.smoothstep(Math.sin(breath), .05, .94);
        visitor.model.position.y = -.54 + surface * .34 - (1 - easedScale) * .45;
        visitor.model.rotation.x = Math.sin(time * .25) * .028;
        visitor.model.rotation.y += Math.sin(time * .19) * .024;
        visitor.model.rotation.z = Math.cos(breath) * .065;
        const tail = visitor.model.userData.tail as THREE.Group | undefined;
        if (tail) tail.rotation.z = Math.sin(time * 1.18 + visitor.phase * 5) * (.16 - surface * .055);
        const spout = visitor.model.getObjectByName('whale-spout');
        if (spout) {
          const pulse = surface * Math.pow(Math.max(0, Math.sin(breath * 2.7 + .55)), 2.4);
          spout.visible = pulse > .38;
          spout.scale.set(.52 + pulse * .68, .24 + pulse * 1.18, .52 + pulse * .68);
          spout.rotation.x = Math.sin(time * .7) * .035;
        }
      } else if (kind === 'dolphins') {
        visitor.model.position.y = -.3 - (1 - easedScale) * .36;
        visitor.model.rotation.z = Math.sin(time * .42) * .025;
        visitor.model.children.forEach((dolphin, index) => {
          const phase = time * 1.02 + dolphin.userData.motionPhase;
          const wave = Math.sin(phase);
          const leap = Math.pow(Math.max(0, wave), 1.55);
          const dive = Math.pow(Math.max(0, -wave), 1.25) * .2;
          const leapHeight = .7 + index * .055;
          dolphin.position.x = dolphin.userData.baseX + Math.sin(time * .58 + index) * .055;
          dolphin.position.y = -.055 + leap * leapHeight - dive;
          dolphin.position.z = dolphin.userData.baseZ + Math.sin(time * .66 + index * 1.9) * .07;
          dolphin.rotation.x = Math.sin(time * .72 + index * 1.5) * (.055 + leap * .055);
          dolphin.rotation.y = Math.sin(time * 1.18 + index * 2.2) * .075;
          dolphin.rotation.z = Math.cos(phase) * (wave > 0 ? .58 : .14);
        });
      } else if (kind === 'squids') {
        visitor.model.position.y = -.46 - (1 - easedScale) * .35 + Math.sin(time * .55) * .05;
        visitor.model.rotation.y += Math.sin(time * .17) * .12;
        visitor.model.children.forEach((squid, index) => {
          const phase = time * 2.05 + squid.userData.motionPhase;
          const pulse = .5 + Math.sin(phase) * .5;
          const baseScale = squid.userData.baseScale as number;
          squid.scale.set(baseScale * (.92 + pulse * .13), baseScale * (1.06 - pulse * .13), baseScale * (.92 + pulse * .13));
          squid.position.x = squid.userData.baseX + Math.sin(time * .46 + index) * .08;
          squid.position.y = Math.sin(time * .78 + squid.userData.motionPhase) * .14;
          squid.position.z = squid.userData.baseZ + Math.cos(time * .4 + index * 1.4) * .09;
          squid.rotation.x = Math.sin(time * .38 + index) * .09;
          squid.rotation.z = Math.cos(time * .33 + index * 1.7) * .08;
        });
      } else {
        visitor.model.position.y = -.31 - (1 - easedScale) * .32 + Math.sin(time * .72) * .025;
        visitor.model.rotation.x = Math.sin(time * .86) * .035;
        visitor.model.rotation.y += Math.sin(time * .3) * .035;
        visitor.model.children.forEach((fish, index) => {
          const phase = time * 3.4 + fish.userData.motionPhase;
          fish.position.x = fish.userData.baseX + Math.sin(phase * .45) * .045;
          fish.position.y = fish.userData.baseY + Math.sin(time * 1.4 + index * .7) * .035;
          fish.position.z = fish.userData.baseZ + Math.sin(time * 1.9 + index * 1.6) * .07;
          fish.rotation.y = Math.sin(phase) * .14;
          fish.rotation.z = Math.cos(phase * .55) * .055;
        });
      }
    }
  }

  private updateAmbientBirds(time: number) {
    const angle = time * .085;
    this.ambientBirds.position.set(
      this.townCenter.x + Math.cos(angle) * 8.6,
      6.9 + Math.sin(time * .35) * .55,
      this.townCenter.z + Math.sin(angle) * 8.6,
    );
    this.ambientBirds.rotation.y = -angle;
    this.ambientBirdActors.forEach((bird, index) => {
      const beat = time * (4.65 + index * .11) + bird.phase;
      const effort = THREE.MathUtils.smoothstep(Math.sin(time * .27 + bird.phase), -.35, .7);
      const flap = .1 + Math.sin(beat) * (.08 + effort * .43);
      bird.model.position.set(
        bird.baseX + Math.sin(time * .36 + bird.phase) * .075,
        bird.baseY + Math.sin(time * .72 + bird.phase) * .1,
        bird.baseZ + Math.cos(time * .31 + bird.phase) * .055,
      );
      bird.model.rotation.x = Math.cos(time * .34 + bird.phase) * .045;
      bird.model.rotation.y = Math.sin(time * .29 + bird.phase) * .1;
      bird.model.rotation.z = Math.sin(time * .41 + bird.phase) * .085;
      bird.leftWing.rotation.z = -flap;
      bird.rightWing.rotation.z = flap;
    });
  }

  private updateGulls(time: number, daylight: number, timeOfDay: number, absoluteHours: number, rainIntensity: number) {
    if (!this.gullRoot.visible) return;
    const routineFeedAnchor = this.gardenAnchors[0] ?? this.dockAnchors[0] ?? this.townCenter;
    const triggeredFeedAnchor = this.feedFocus ?? routineFeedAnchor;
    const scatterAnchor = this.scatterFocus ?? this.townCenter;
    for (let index = 0; index < this.gulls.length; index++) {
      const gull = this.gulls[index];
      const desired = new THREE.Vector3();
      const scattering = time < this.scatterUntil;
      const triggeredFeeding = time < this.feedUntil;
      const perching = !scattering && !triggeredFeeding && (rainIntensity > .32 || daylight < .24 || (this.discoveries.has('birds-nest') && (Math.floor(absoluteHours * 2) + index) % 8 === 0));
      const routineFeeding = !scattering && !perching && daylight > .35 && this.gardenAnchors.length > 0 && (Math.floor(absoluteHours * 3) + index) % 11 === 0;
      if (scattering) {
        gull.mode = 'scattering';
        const angle = gull.phase + index * 1.31;
        desired.copy(scatterAnchor).add(new THREE.Vector3(Math.cos(angle) * (3.5 + index * .35), 4.5 + index * .25, Math.sin(angle) * (3.5 + index * .35)));
      } else if (triggeredFeeding || routineFeeding) {
        gull.mode = 'feeding';
        const angle = gull.phase + index * 1.7;
        desired.copy(triggeredFeeding ? triggeredFeedAnchor : routineFeedAnchor).add(new THREE.Vector3(Math.cos(angle) * (.45 + index * .09), .02 + Math.sin(time * 5 + index) * .025, Math.sin(angle) * (.45 + index * .09)));
      } else if (perching) {
        gull.mode = 'perching';
        const anchor = this.towerAnchors[index % Math.max(1, this.towerAnchors.length)] ?? this.dockAnchors[index % Math.max(1, this.dockAnchors.length)] ?? this.townCenter;
        desired.copy(anchor).add(new THREE.Vector3((index % 3 - 1) * .24, 0, Math.floor(index / 3) * .18));
      } else {
        gull.mode = 'flying';
        const angle = time * (.16 + index * .009) + gull.phase;
        const radius = 4.5 + index * .62;
        desired.set(this.townCenter.x + Math.cos(angle) * radius, 3.2 + Math.sin(time * .7 + index) * .45 + index * .12, this.townCenter.z + Math.sin(angle) * radius * .78);
      }
      const dx = desired.x - gull.model.position.x;
      const dz = desired.z - gull.model.position.z;
      if (Math.abs(dx) + Math.abs(dz) > .01) gull.model.rotation.y = Math.atan2(dx, dz);
      gull.model.position.lerp(desired, gull.mode === 'scattering' ? .085 : .045);
      const flap = gull.mode === 'flying' || gull.mode === 'scattering' ? Math.sin(time * 7.5 + gull.phase) * .7 : .08;
      gull.leftWing.rotation.z = flap;
      gull.rightWing.rotation.z = -flap;
      gull.model.rotation.x = gull.mode === 'feeding' ? -.32 + Math.sin(time * 4 + index) * .18 : 0;
      if (timeOfDay >= 22 || timeOfDay < 5) gull.model.scale.setScalar(.72);
      else gull.model.scale.setScalar(.78);
    }
  }

  private updateFish(time: number) {
    if (!this.fishRoot.visible || !this.waterAnchors.length) return;
    this.fishSchools.forEach((school, schoolIndex) => {
      const anchor = this.waterAnchors[(schoolIndex * 3) % this.waterAnchors.length];
      const angle = time * (.2 + schoolIndex * .027) + school.phase;
      const orbitX = .62 + schoolIndex * .06;
      const orbitZ = .54 + schoolIndex * .045;
      const harmonic = angle * 2 + school.phase;
      const x = Math.cos(angle) * orbitX + Math.cos(harmonic) * .085;
      const z = Math.sin(angle) * orbitZ;
      const dx = -Math.sin(angle) * orbitX - Math.sin(harmonic) * .17;
      const dz = Math.cos(angle) * orbitZ;
      const nearSurface = Math.pow(Math.max(0, Math.sin(time * .23 + school.phase)), 8) * .075;
      school.model.position.set(anchor.x + x, -.305 + nearSurface + Math.sin(time * .9 + schoolIndex) * .016, anchor.z + z);
      school.model.rotation.y = Math.atan2(-dz, dx);
      school.model.rotation.z = Math.sin(time * .72 + school.phase) * .035;
      school.fish.forEach((fish, fishIndex) => {
        const beat = time * (7.2 + schoolIndex * .45) + fish.phase;
        const loosen = .84 + Math.sin(time * .72 + fish.phase) * .16;
        fish.model.position.set(
          fish.baseX + Math.sin(beat * .5) * .025,
          Math.sin(time * 1.6 + fish.phase) * .025,
          fish.baseZ * loosen + Math.sin(time * 1.2 + fishIndex) * .025,
        );
        fish.model.rotation.y = Math.sin(beat) * .105;
        fish.model.rotation.z = Math.cos(beat * .5) * .04;
        fish.tail.rotation.y = Math.sin(beat + .65) * .52;
      });
    });
  }

  private updateCrabs(time: number) {
    if (!this.crabRoot.visible || !this.dockAnchors.length) return;
    this.crabs.forEach((crab, index) => {
      const anchor = this.dockAnchors[index % Math.max(1, this.dockAnchors.length)];
      crab.visible = this.crabRoot.visible && Boolean(anchor);
      if (!anchor) return;
      const sway = Math.sin(time * .8 + index * 2.2);
      crab.position.set(anchor.x + sway * .22, anchor.y, anchor.z + Math.cos(time * .55 + index) * .16);
      crab.rotation.y = sway > 0 ? Math.PI / 2 : -Math.PI / 2;
    });
  }

  private updateCats(time: number, timeOfDay: number, absoluteHours: number, catColonyFoundedAt?: number, rainIntensity = 0) {
    const colonyAge = catColonyFoundedAt === undefined ? 0 : Math.max(0, absoluteHours - catColonyFoundedAt);
    const colony = catColonyAt(catColonyFoundedAt, absoluteHours, this.catCapacity);
    const familySize = colony.population;
    this.visibleCatCount = this.catRoot.visible ? familySize : 0;
    this.kittenCount = this.catRoot.visible ? colony.kittens : 0;
    if (!this.catRoot.visible) return;
    const migrationActive = timeBefore(time, this.migrationUntil);
    const migrationProgress = migrationActive ? THREE.MathUtils.clamp((time - this.migrationStartedAt) / Math.max(.01, this.migrationUntil - this.migrationStartedAt), 0, 1) : 1;
    if (!migrationActive) this.migratingCatCount = 0;
    const gathering = time < this.catGatherUntil && Boolean(this.catGatherCluster);
    const gatheredAnchors = gathering ? this.catAnchors.filter((anchor) => anchor.cluster === this.catGatherCluster) : [];
    this.cats.forEach((cat, index) => {
      const treeRest = !gathering && rainIntensity < .1 && timeOfDay >= 12 && timeOfDay < 17 && index % 4 === 0
        ? this.matureTreeAnchors[index % Math.max(1, this.matureTreeAnchors.length)]
        : undefined;
      const catAnchor = gathering
        ? gatheredAnchors[index % Math.max(1, gatheredAnchors.length)]
        : this.catAnchors[index % Math.max(1, this.catAnchors.length)];
      const anchor = treeRest ?? catAnchor?.position;
      const migrating = migrationActive && index >= familySize && index < familySize + this.migratingCatCount;
      cat.model.visible = this.catRoot.visible && (index < familySize || migrating) && Boolean(anchor ?? this.townCenter);
      if (migrating) {
        const departureAngle = index * 2.17 + this.seed * .001;
        const distance = .5 + migrationProgress * 10;
        const step = time * 8.2 + cat.phase;
        cat.model.position.set(this.townCenter.x + Math.cos(departureAngle) * distance, .2 + Math.abs(Math.sin(step)) * .025, this.townCenter.z + Math.sin(departureAngle) * distance);
        cat.model.rotation.y = -departureAngle;
        cat.model.scale.setScalar(.9 * (1 - migrationProgress * .45));
        cat.torso.rotation.z = Math.sin(step) * .025;
        cat.head.position.set(.225, .245, 0);
        cat.head.rotation.set(0, Math.sin(time * .8 + cat.phase) * .08, 0);
        cat.tail.rotation.set(Math.sin(time * 2.4 + cat.phase) * .3, 0, 0);
        return;
      }
      if (!anchor) return;
      const routineRest = rainIntensity > .3 || timeOfDay >= 22 || timeOfDay < 5.5 || Boolean(treeRest);
      const period = 14 + index % 4 * 2.3 + (routineRest ? 7 : 0);
      const cycle = ((time + cat.phase * 2.4) % period) / period;
      const firstWalkEnd = .37;
      const secondWalkStart = .65;
      let travel = Math.PI;
      let moving = !routineRest;
      if (cycle < firstWalkEnd) {
        const amount = cycle / firstWalkEnd;
        travel = amount * amount * (3 - amount * 2) * Math.PI;
      } else if (cycle >= secondWalkStart) {
        const amount = (cycle - secondWalkStart) / (1 - secondWalkStart);
        travel += amount * amount * (3 - amount * 2) * Math.PI;
      } else moving = false;
      const angle = cat.phase + travel;
      const gathered = gathering;
      const roam = (gathered ? .24 : .34 + index * .045) * (routineRest ? .28 : 1) * (1 - rainIntensity * .55);
      let x: number;
      let z: number;
      let dx: number;
      let dz: number;
      if (catAnchor?.outward && !treeRest) {
        // Shop cats pace along the apron instead of orbiting back through the
        // counter. Their bodies remain tangent to the façade at both rests.
        const [outwardX, outwardZ] = catAnchor.outward;
        const lateralX = outwardZ;
        const lateralZ = -outwardX;
        const storefrontRoam = (gathered ? .07 : .12) * (routineRest ? .35 : 1) * (1 - rainIntensity * .4);
        const sideMotion = Math.cos(angle) * storefrontRoam;
        const facing = Math.sin(angle) > 0 ? -1 : 1;
        x = lateralX * sideMotion;
        z = lateralZ * sideMotion;
        dx = lateralX * facing;
        dz = lateralZ * facing;
      } else {
        x = Math.cos(angle) * roam + Math.cos(angle * 2 + cat.phase) * roam * .08;
        z = Math.sin(angle) * roam * .78 + Math.sin(angle * 3 + cat.phase) * roam * .05;
        dx = -Math.sin(angle) * roam;
        dz = Math.cos(angle) * roam * .78;
      }
      const step = time * (7.4 + index * .08) + cat.phase;
      const walkBob = moving ? Math.abs(Math.sin(step)) * .018 : 0;
      cat.model.position.set(anchor.x + x, anchor.y + walkBob, anchor.z + z);
      cat.model.rotation.y = Math.atan2(-dz, dx);
      cat.model.rotation.x = moving ? Math.sin(step * .5) * .018 : 0;
      cat.model.rotation.z = moving ? Math.sin(step) * .012 : 0;

      const grooming = !moving && !routineRest && cycle > .46 && cycle < .57 && index % 3 !== 0;
      const napping = !moving && (routineRest || index % 3 === 0);
      cat.torso.position.y = moving ? Math.abs(Math.sin(step)) * .009 : .006;
      cat.torso.rotation.set(0, 0, moving ? Math.sin(step) * .024 : napping ? -.035 : .13);
      cat.torso.scale.set(1, napping ? .82 : 1, 1);
      if (grooming) {
        cat.head.position.set(.17, .205, Math.sin(time * 2.2 + cat.phase) * .035);
        cat.head.rotation.set(0, Math.sin(time * 2.8 + cat.phase) * .25, -.68 + Math.sin(time * 3.5 + cat.phase) * .12);
      } else if (napping) {
        cat.head.position.set(.075, .17, 0);
        cat.head.rotation.set(0, Math.sin(cat.phase) * .22, -.18);
      } else {
        cat.head.position.set(.215, moving ? .245 : .275, 0);
        cat.head.rotation.set(0, Math.sin(time * .72 + cat.phase) * (moving ? .08 : .32), moving ? Math.sin(step) * .018 : .04);
      }
      cat.tail.rotation.x = Math.sin(time * (moving ? 2.25 : 1.15) + cat.phase) * (moving ? .32 : .22);
      cat.tail.rotation.z = napping ? -.48 : moving ? 0 : -.24;

      if (index < 3) cat.model.scale.setScalar(.9);
      else {
        const bornAt = (index - 2) * KITTEN_INTERVAL_HOURS;
        const kittenAge = Math.max(0, colonyAge - bornAt);
        cat.model.scale.setScalar(.5 + THREE.MathUtils.clamp(kittenAge / KITTEN_GROWTH_HOURS, 0, 1) * .4);
      }
    });
  }

  private updateTurtles(time: number) {
    if (!this.turtleRoot.visible || !this.waterAnchors.length) return;
    const localTime = (time + hash(this.seed, 0, 0, 3629) * TURTLE_VISIT_CYCLE) % TURTLE_VISIT_CYCLE;
    const visiting = localTime < TURTLE_VISIT_DURATION;
    const edge = Math.min(1, localTime / 2.4, (TURTLE_VISIT_DURATION - localTime) / 2.4);
    const visitScale = THREE.MathUtils.smoothstep(edge, 0, 1);
    this.turtles.forEach((turtle, index) => {
      turtle.model.visible = visiting;
      if (!visiting) return;
      const anchor = this.waterAnchors[(index * 5 + 1) % this.waterAnchors.length];
      const strokePhase = time * (1.55 + index * .055) + turtle.phase;
      const powerStroke = Math.sin(strokePhase);
      const angle = time * (.088 + index * .009) + turtle.phase + powerStroke * .024;
      const radius = .72 + index * .11;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle * 2) * radius * .42;
      const dx = -Math.sin(angle) * radius;
      const dz = Math.cos(angle * 2) * radius * .84;
      const surfacing = THREE.MathUtils.smoothstep(Math.sin(time * .46 + turtle.phase), .2, .95);
      turtle.model.position.set(
        anchor.x + x,
        anchor.y - .06 + surfacing * .12 + Math.sin(time * .7 + turtle.phase) * .01,
        anchor.z + z,
      );
      turtle.model.scale.setScalar(TURTLE_SCALE * visitScale);
      turtle.model.rotation.y = Math.atan2(-dz, dx);
      turtle.model.rotation.x = Math.sin(strokePhase * .5) * .045;
      turtle.model.rotation.z = Math.cos(angle * .5 + turtle.phase) * .075 + Math.cos(strokePhase) * .018;
      turtle.frontFlippers.forEach((flipper, flipperIndex) => {
        const side = flipperIndex === 0 ? -1 : 1;
        const turnBias = Math.cos(angle * .5 + turtle.phase) * .08;
        flipper.rotation.x = side * (powerStroke * .66 + turnBias);
        flipper.rotation.y = -side * (.18 + Math.cos(strokePhase) * .07);
      });
    });
  }

  private updateButterflies(time: number, daylight: number, rainIntensity: number) {
    if (!this.butterflyRoot.visible || daylight <= .28 || rainIntensity >= .16 || !this.gardenAnchors.length) {
      this.butterflies.forEach((butterfly) => { butterfly.visible = false; });
      return;
    }
    this.butterflies.forEach((butterfly, index) => {
      const anchor = this.gardenAnchors[Math.floor(index / 3) % Math.max(1, this.gardenAnchors.length)];
      butterfly.visible = this.butterflyRoot.visible && daylight > .28 && rainIntensity < .16 && Boolean(anchor) && index < this.gardenAnchors.length * 3;
      if (!anchor) return;
      const angle = time * (.45 + index * .007) + index * 2.39;
      const radius = .42 + index % 3 * .18;
      butterfly.position.set(anchor.x + Math.cos(angle) * radius, anchor.y + .55 + Math.sin(time * 1.8 + index) * .28, anchor.z + Math.sin(angle) * radius);
      butterfly.rotation.y = -angle;
      butterfly.scale.x = .42 + Math.abs(Math.sin(time * 9 + index)) * .58;
    });
  }
}

function timeBefore(time: number, deadline: number) { return time < deadline; }
