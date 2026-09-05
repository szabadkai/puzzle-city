import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { hash } from './random';
import { findPlazaAnchors } from './topology';
import { CARDINALS, type BusinessSave, type Cell, keyOf } from './types';
import { analyzeWaterTopology, createShorelineRoute, WORLD_CELL_SIZE } from './water';
import { ageInHours, catColonyAt, describeAge, KITTEN_GROWTH_HOURS, KITTEN_INTERVAL_HOURS } from './memory';
import { FLOOR_HEIGHT } from './spatial';

export type WildlifeKind = 'gulls' | 'fish' | 'crabs' | 'cats' | 'butterflies';
export type WildlifeAction = 'reveal' | 'gather' | 'scatter';

export type CatMemoryInspection = Readonly<{
  kind: 'cat';
  title: string;
  ageLabel: string;
  detail: string;
  note: string;
}>;

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

const CELL = WORLD_CELL_SIZE;

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

export class FaunaSystem {
  readonly root = new THREE.Group();
  private readonly ambientBirds = new THREE.Group();
  private readonly gullRoot = new THREE.Group();
  private readonly fishRoot = new THREE.Group();
  private readonly crabRoot = new THREE.Group();
  private readonly catRoot = new THREE.Group();
  private readonly butterflyRoot = new THREE.Group();
  private readonly marineRoot = new THREE.Group();
  private readonly gulls: GullActor[] = [];
  private readonly fishSchools: THREE.Group[] = [];
  private readonly crabs: THREE.Group[] = [];
  private readonly cats: THREE.Group[] = [];
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
  private catAnchors: THREE.Vector3[] = [];
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
  private catGatherFocus: THREE.Vector3 | null = null;

  constructor(private readonly seed: number) {
    this.root.name = 'fauna';
    this.ambientBirds.name = 'ambient-birds';
    this.gullRoot.name = 'gulls';
    this.fishRoot.name = 'fish-schools';
    this.crabRoot.name = 'dock-crabs';
    this.catRoot.name = 'harbor-cats';
    this.butterflyRoot.name = 'garden-butterflies';
    this.marineRoot.name = 'passing-sea-life';
    this.createAmbientBirds();
    this.createGulls();
    this.createFishSchools();
    this.createCrabs();
    this.createCats();
    this.createButterflies();
    this.marineVisitors = this.createMarineVisitors();
    this.root.add(this.ambientBirds, this.gullRoot, this.fishRoot, this.crabRoot, this.catRoot, this.butterflyRoot, this.marineRoot);
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
    const workingCatAnchors = this.businesses
      .filter((business) => business.type === 'fishmonger' || business.type === 'inn')
      .map((business) => {
        const cell = parseCellKey(business.cellKey);
        return this.exteriorAnchor(cell.x, cell.z, occupied, .62);
      });
    this.catAnchors = [...workingCatAnchors, ...this.gardenAnchors.slice(0, 2).map((anchor) => anchor.clone().setY(.28))];
    const fishmongers = this.businesses.filter((business) => business.type === 'fishmonger').length;
    const inns = this.businesses.filter((business) => business.type === 'inn').length;
    const nextCapacity = Math.min(this.cats.length, fishmongers * 3 + inns * 2 + Math.min(2, this.gardenAnchors.length));
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
      this.catGatherFocus = worldFocus && this.catAnchors.length
        ? this.catAnchors.reduce((nearest, anchor) => anchor.distanceToSquared(worldFocus) < nearest.distanceToSquared(worldFocus) ? anchor : nearest).clone()
        : this.catAnchors[0]?.clone() ?? this.townCenter.clone();
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

  private exteriorAnchor(x: number, z: number, occupied: ReadonlyMap<string, Cell>, distance: number) {
    const direction = CARDINALS.findIndex(([dx, dz]) => !occupied.has(keyOf(x + dx, z + dz)));
    const [dx, dz] = CARDINALS[direction < 0 ? 0 : direction];
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
   * Their hidden source meshes remain in place for cat picking and simulation.
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
      mesh.raycast = () => {};
      parent.add(mesh);
      this.actorInstanceBatches.push({ mesh, parent, sources: layout.sources });
    }
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
      for (const source of batch.sources) {
        if (!source.visible || !source.parent?.visible) continue;
        source.updateWorldMatrix(true, false);
        batch.mesh.setMatrixAt(count++, this.instanceMatrix.multiplyMatrices(this.inverseParentMatrix, source.matrixWorld));
      }
      batch.mesh.count = count;
      if (count) batch.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  private createAmbientBirds() {
    const material = new THREE.MeshBasicMaterial({ color: 0x47676b, side: THREE.DoubleSide });
    for (let index = 0; index < 6; index++) {
      const bird = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-.18, 0, 0), new THREE.Vector3(0, -.06, 0), new THREE.Vector3(.18, 0, 0),
      ]), material);
      bird.position.set(index * .6, Math.sin(index) * .34, Math.cos(index * 2) * .5);
      this.ambientBirds.add(bird);
    }
    consolidateActor(this.ambientBirds);
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
    const materials = [0x315f65, 0x5b7c78, 0x8b7553].map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .58, depthWrite: false }));
    const fishActors: THREE.Group[] = [];
    for (let schoolIndex = 0; schoolIndex < 3; schoolIndex++) {
      const school = new THREE.Group();
      for (let fishIndex = 0; fishIndex < 5; fishIndex++) {
        const fish = new THREE.Group();
        const body = new THREE.Mesh(new THREE.SphereGeometry(.09, 7, 5), materials[(schoolIndex + fishIndex) % materials.length]);
        body.scale.set(1.8, .45, .68);
        const tail = new THREE.Mesh(new THREE.ConeGeometry(.08, .16, 3), materials[(schoolIndex + fishIndex) % materials.length]);
        tail.rotation.z = -Math.PI / 2;
        tail.position.x = -.2;
        fish.add(body, tail);
        consolidateActor(fish);
        fish.position.set((fishIndex - 2) * .25, 0, Math.sin(fishIndex * 2) * .18);
        school.add(fish);
        fishActors.push(fish);
      }
      this.fishRoot.add(school);
      this.fishSchools.push(school);
    }
    this.createActorInstances(this.fishRoot, fishActors);
  }

  private createCrabs() {
    const shellMaterial = new THREE.MeshStandardMaterial({ color: 0xb84f3e, roughness: .92 });
    const legMaterial = new THREE.MeshStandardMaterial({ color: 0x783c35, roughness: 1 });
    for (let index = 0; index < 5; index++) {
      const crab = new THREE.Group();
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
    const coats = [0xc58b51, 0x4b4a4c, 0xe1c6a0].map((color) => new THREE.MeshStandardMaterial({ color, roughness: .94 }));
    const markingMaterial = new THREE.MeshStandardMaterial({ color: 0xeee0c2, roughness: .96 });
    for (let index = 0; index < 12; index++) {
      // Later kittens deterministically inherit one of the founding coats.
      const family = index < 3 ? index : Math.floor(hash(this.seed, index, 0, 2840) * 3);
      const coat = coats[family];
      const cat = new THREE.Group();
      cat.userData.catIndex = index;
      cat.userData.catFamily = family;
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(.09, .25, 3, 7), coat);
      body.rotation.z = Math.PI / 2;
      body.position.y = .13;
      const head = new THREE.Mesh(new THREE.SphereGeometry(.11, 8, 6), coat);
      head.position.set(.2, .19, 0);
      for (const z of [-.06, .06]) {
        const ear = new THREE.Mesh(new THREE.ConeGeometry(.045, .11, 4), coat);
        ear.position.set(.18, .3, z);
        cat.add(ear);
      }
      const tail = new THREE.Mesh(new THREE.TorusGeometry(.16, .025, 5, 10, Math.PI * 1.35), coat);
      tail.name = 'cat-tail';
      tail.rotation.x = Math.PI / 2;
      tail.position.set(-.25, .18, 0);
      cat.add(body, head, tail);
      if (index >= 3 && hash(this.seed, index, family, 2841) > .42) {
        const marking = new THREE.Mesh(new THREE.SphereGeometry(.061, 7, 5), markingMaterial);
        marking.scale.set(1.15, .45, .8);
        marking.position.set(.205, .215, .085);
        cat.add(marking);
      }
      consolidateActor(cat);
      cat.scale.setScalar(.9);
      this.catRoot.add(cat);
      this.cats.push(cat);
    }
    this.createActorInstances(this.catRoot, this.cats);
  }

  private createButterflies() {
    const colors = [0xe9ad42, 0x74a5a0, 0xd4737d];
    const materials = colors.map((color) => new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    for (let index = 0; index < 12; index++) {
      const butterfly = new THREE.Group();
      const material = materials[index % materials.length];
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
    const blue = new THREE.MeshStandardMaterial({ color: 0x3d6871, roughness: .8 });
    const pale = new THREE.MeshStandardMaterial({ color: 0x91aaa5, roughness: .88 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(.5, 12, 7), blue);
    body.scale.set(2.4, .58, .72);
    const belly = new THREE.Mesh(new THREE.SphereGeometry(.46, 10, 6), pale);
    belly.scale.set(2.15, .3, .55);
    belly.position.set(.08, -.22, 0);
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(.18, .48, 5), blue);
    dorsal.position.set(-.18, .37, 0);
    dorsal.rotation.z = -.18;
    for (const side of [-1, 1]) {
      const fluke = new THREE.Mesh(new THREE.SphereGeometry(.28, 7, 5), blue);
      fluke.scale.set(.95, .13, .62);
      fluke.position.set(-1.28, .02, side * .2);
      fluke.rotation.y = side * .42;
      whale.add(fluke);
      const fin = new THREE.Mesh(new THREE.ConeGeometry(.13, .62, 5), blue);
      fin.scale.z = .48;
      fin.position.set(.05, -.08, side * .38);
      fin.rotation.x = side * Math.PI / 2;
      whale.add(fin);
    }
    const spout = new THREE.Group();
    spout.name = 'whale-spout';
    const spray = new THREE.MeshBasicMaterial({ color: 0xc5e2dd, transparent: true, opacity: .72, depthWrite: false });
    for (let index = 0; index < 4; index++) {
      const drop = new THREE.Mesh(new THREE.SphereGeometry(.035 + index * .008, 5, 4), spray);
      drop.position.set(index * .025, index * .13, (index % 2 ? -1 : 1) * index * .025);
      spout.add(drop);
    }
    spout.position.set(.86, .22, 0);
    whale.add(body, belly, dorsal, spout);
    consolidateActor(whale, new Set([spout]));
    whale.userData.baseScale = 1;
    return whale;
  }

  private createDolphinPod() {
    const pod = new THREE.Group();
    pod.name = 'dolphin-pod';
    const blue = new THREE.MeshStandardMaterial({ color: 0x56828a, roughness: .76 });
    const pale = new THREE.MeshStandardMaterial({ color: 0xa8bbb2, roughness: .86 });
    const dolphinActors: THREE.Group[] = [];
    for (let index = 0; index < 3; index++) {
      const dolphin = new THREE.Group();
      dolphin.userData.podIndex = index;
      const body = new THREE.Mesh(new THREE.SphereGeometry(.25, 9, 6), blue);
      body.scale.set(2.15, .55, .62);
      const belly = new THREE.Mesh(new THREE.SphereGeometry(.2, 8, 5), pale);
      belly.scale.set(1.8, .26, .48);
      belly.position.set(.05, -.1, 0);
      const beak = new THREE.Mesh(new THREE.CylinderGeometry(.045, .075, .3, 7), blue);
      beak.rotation.z = Math.PI / 2;
      beak.position.x = .62;
      const dorsal = new THREE.Mesh(new THREE.ConeGeometry(.1, .29, 5), blue);
      dorsal.position.set(-.08, .2, 0);
      for (const side of [-1, 1]) {
        const fluke = new THREE.Mesh(new THREE.SphereGeometry(.12, 6, 4), blue);
        fluke.scale.set(.8, .13, .7);
        fluke.position.set(-.62, 0, side * .09);
        fluke.rotation.y = side * .4;
        dolphin.add(fluke);
      }
      dolphin.add(body, belly, beak, dorsal);
      consolidateActor(dolphin);
      dolphin.position.set(-index * .48, 0, (index - 1) * .55);
      dolphin.scale.setScalar(.84 + index * .06);
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
    const colors = [0xaa6f79, 0xc28782, 0x8d6e88, 0xb77c68];
    for (let index = 0; index < 4; index++) {
      const squid = new THREE.Group();
      const material = new THREE.MeshStandardMaterial({
        color: colors[index], transparent: true, opacity: .72, roughness: .8, depthWrite: false,
      });
      const bell = new THREE.Mesh(new THREE.ConeGeometry(.2, .5, 7), material);
      bell.rotation.z = -Math.PI / 2;
      for (let tentacle = 0; tentacle < 4; tentacle++) {
        const arm = new THREE.Mesh(new THREE.CylinderGeometry(.018, .028, .36 + tentacle * .025, 5), material);
        arm.rotation.z = Math.PI / 2;
        arm.position.set(-.33, (tentacle - 1.5) * .045, (tentacle % 2 ? -1 : 1) * .07);
        squid.add(arm);
      }
      squid.add(bell);
      consolidateActor(squid);
      squid.position.set(-index * .34, Math.sin(index) * .12, (index - 1.5) * .33);
      squid.scale.setScalar(.8 + index * .055);
      group.add(squid);
    }
    group.userData.baseScale = 1;
    return group;
  }

  private createTunaPack() {
    const pack = new THREE.Group();
    pack.name = 'tuna-pack';
    const silver = new THREE.MeshStandardMaterial({ color: 0x78999a, roughness: .7, metalness: .08, transparent: true, opacity: .78, depthWrite: false });
    const tunaActors: THREE.Group[] = [];
    for (let index = 0; index < 11; index++) {
      const fish = new THREE.Group();
      fish.userData.schoolIndex = index;
      const body = new THREE.Mesh(new THREE.SphereGeometry(.11, 7, 5), silver);
      body.scale.set(2.4, .55, .72);
      const tail = new THREE.Mesh(new THREE.ConeGeometry(.1, .22, 3), silver);
      tail.rotation.z = -Math.PI / 2;
      tail.position.x = -.31;
      fish.add(body, tail);
      consolidateActor(fish);
      const row = Math.floor(index / 4);
      fish.position.set(-row * .36 - index % 4 * .18, (index % 3 - 1) * .08, (index % 4 - 1.5) * .25);
      fish.userData.baseZ = fish.position.z;
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
      visitor.model.position.copy(point);
      visitor.model.rotation.y = Math.atan2(tangent.x, tangent.z) - Math.PI / 2;
      visitor.model.scale.setScalar(easedScale);

      if (kind === 'whale') {
        visitor.model.position.y = -.31 + Math.sin(time * .55) * .045 - (1 - easedScale) * .45;
        visitor.model.rotation.z = Math.sin(time * .55) * .018;
        const spout = visitor.model.getObjectByName('whale-spout');
        if (spout) {
          const pulse = Math.max(0, Math.sin(time * .72));
          spout.visible = pulse > .78;
          spout.scale.setScalar(.45 + pulse * .75);
        }
      } else if (kind === 'dolphins') {
        visitor.model.position.y = -.28 - (1 - easedScale) * .36;
        visitor.model.children.forEach((dolphin, index) => {
          const leap = Math.max(0, Math.sin(time * 1.25 + index * 1.4));
          dolphin.position.y = -.04 + leap * .58;
          dolphin.rotation.z = (leap - .35) * .28;
        });
      } else if (kind === 'squids') {
        visitor.model.position.y = -.38 - (1 - easedScale) * .35 + Math.sin(time * .9) * .06;
        visitor.model.children.forEach((squid, index) => {
          squid.scale.x = .78 + Math.sin(time * 2.2 + index) * .13;
          squid.position.y = Math.sin(time * 1.15 + index * 1.7) * .12;
        });
      } else {
        visitor.model.position.y = -.29 - (1 - easedScale) * .32 + Math.sin(time * 1.3) * .018;
        visitor.model.children.forEach((fish, index) => {
          fish.position.z = fish.userData.baseZ + Math.sin(time * 2.5 + index * 1.6) * .055;
          fish.rotation.y = Math.sin(time * 3 + index) * .11;
        });
      }
    }
  }

  private updateAmbientBirds(time: number) {
    const angle = time * .085;
    this.ambientBirds.position.set(this.townCenter.x + Math.cos(angle) * 9, 7.5 + Math.sin(time * .35), this.townCenter.z + Math.sin(angle) * 9);
    this.ambientBirds.rotation.y = -angle;
    this.ambientBirds.children.forEach((bird, index) => { bird.rotation.z = Math.sin(time * 5 + index) * .22; });
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
      const angle = time * (.18 + schoolIndex * .03) + schoolIndex * 2.1;
      school.position.set(anchor.x + Math.cos(angle) * .7, -.275 + Math.sin(time * 1.2 + schoolIndex) * .012, anchor.z + Math.sin(angle) * .7);
      school.rotation.y = -angle;
      school.children.forEach((fish, fishIndex) => {
        fish.position.z = Math.sin(time * 1.8 + fishIndex * 1.7) * .18;
        fish.rotation.y = Math.sin(time * 2.5 + fishIndex) * .16;
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
    this.cats.forEach((cat, index) => {
      const treeRest = rainIntensity < .1 && timeOfDay >= 12 && timeOfDay < 17 && index % 4 === 0
        ? this.matureTreeAnchors[index % Math.max(1, this.matureTreeAnchors.length)]
        : undefined;
      const anchor = time < this.catGatherUntil && this.catGatherFocus ? this.catGatherFocus : treeRest ?? this.catAnchors[index % Math.max(1, this.catAnchors.length)];
      const migrating = migrationActive && index >= familySize && index < familySize + this.migratingCatCount;
      cat.visible = this.catRoot.visible && (index < familySize || migrating) && Boolean(anchor ?? this.townCenter);
      if (migrating) {
        const departureAngle = index * 2.17 + this.seed * .001;
        const distance = .5 + migrationProgress * 10;
        cat.position.set(this.townCenter.x + Math.cos(departureAngle) * distance, .2, this.townCenter.z + Math.sin(departureAngle) * distance);
        cat.rotation.y = -departureAngle;
        cat.scale.setScalar(.9 * (1 - migrationProgress * .45));
        return;
      }
      if (!anchor) return;
      const angle = time * (.16 + index * .03) + index * 2.5;
      const roam = (1 - rainIntensity * .72) * (.32 + index * .06);
      cat.position.set(anchor.x + Math.cos(angle) * roam, anchor.y, anchor.z + Math.sin(angle) * roam * .8);
      cat.rotation.y = -angle - Math.PI / 2;
      if (index < 3) cat.scale.setScalar(.9);
      else {
        const bornAt = (index - 2) * KITTEN_INTERVAL_HOURS;
        const kittenAge = Math.max(0, colonyAge - bornAt);
        cat.scale.setScalar(.5 + THREE.MathUtils.clamp(kittenAge / KITTEN_GROWTH_HOURS, 0, 1) * .4);
      }
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
