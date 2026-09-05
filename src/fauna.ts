import * as THREE from 'three';
import { hash } from './random';
import { findPlazaAnchors } from './topology';
import { CARDINALS, type BusinessSave, type Cell, keyOf } from './types';
import { analyzeWaterTopology, WORLD_CELL_SIZE } from './water';

export type WildlifeKind = 'gulls' | 'fish' | 'crabs' | 'cats' | 'butterflies';
export type WildlifeAction = 'reveal' | 'gather' | 'scatter';

type GullActor = {
  model: THREE.Group;
  leftWing: THREE.Object3D;
  rightWing: THREE.Object3D;
  phase: number;
  mode: 'flying' | 'feeding' | 'perching' | 'scattering';
};

const CELL = WORLD_CELL_SIZE;

function parseCellKey(cellKey: string) {
  const [x, z] = cellKey.split(',').map(Number);
  return { x, z };
}

export class FaunaSystem {
  readonly root = new THREE.Group();
  private readonly ambientBirds = new THREE.Group();
  private readonly gullRoot = new THREE.Group();
  private readonly fishRoot = new THREE.Group();
  private readonly crabRoot = new THREE.Group();
  private readonly catRoot = new THREE.Group();
  private readonly butterflyRoot = new THREE.Group();
  private readonly gulls: GullActor[] = [];
  private readonly fishSchools: THREE.Group[] = [];
  private readonly crabs: THREE.Group[] = [];
  private readonly cats: THREE.Group[] = [];
  private readonly butterflies: THREE.Group[] = [];
  private cells: Cell[] = [];
  private businesses: BusinessSave[] = [];
  private discoveries = new Set<string>();
  private dockAnchors: THREE.Vector3[] = [];
  private waterAnchors: THREE.Vector3[] = [];
  private gardenAnchors: THREE.Vector3[] = [];
  private towerAnchors: THREE.Vector3[] = [];
  private catAnchors: THREE.Vector3[] = [];
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
    this.createAmbientBirds();
    this.createGulls();
    this.createFishSchools();
    this.createCrabs();
    this.createCats();
    this.createButterflies();
    this.root.add(this.ambientBirds, this.gullRoot, this.fishRoot, this.crabRoot, this.catRoot, this.butterflyRoot);
    this.setDiscoveryState([]);
  }

  setTown(cells: Iterable<Cell>, businesses: readonly BusinessSave[]) {
    this.cells = [...cells].map((cell) => ({ ...cell }));
    this.businesses = businesses.map((business) => ({ ...business }));
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
      .map((cell) => new THREE.Vector3(cell.x * CELL, cell.height * 1.42 + 1.25, cell.z * CELL));
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
    this.catAnchors = this.businesses
      .filter((business) => business.type === 'fishmonger' || business.type === 'inn')
      .map((business) => {
        const cell = parseCellKey(business.cellKey);
        return this.exteriorAnchor(cell.x, cell.z, occupied, .62);
      });
    if (this.cells.length) {
      this.townCenter.set(
        this.cells.reduce((sum, cell) => sum + cell.x * CELL, 0) / this.cells.length,
        0,
        this.cells.reduce((sum, cell) => sum + cell.z * CELL, 0) / this.cells.length,
      );
    } else this.townCenter.set(0, 0, 0);
    this.ambientBirds.visible = this.cells.length > 0;
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

  update(time: number, daylight: number, timeOfDay: number, absoluteHours: number) {
    this.lastRealTime = time;
    this.updateAmbientBirds(time);
    this.updateGulls(time, daylight, timeOfDay, absoluteHours);
    this.updateFish(time);
    this.updateCrabs(time);
    this.updateCats(time);
    this.updateButterflies(time, daylight);
  }

  stats() {
    const modes = this.gulls.reduce((counts, gull) => {
      counts[gull.mode] += 1;
      return counts;
    }, { flying: 0, feeding: 0, perching: 0, scattering: 0 });
    return {
      birds: this.ambientBirds.visible ? this.ambientBirds.children.length : 0,
      gulls: this.gullRoot.visible ? this.gulls.length : 0,
      gullModes: modes,
      fish: this.fishRoot.visible && this.waterAnchors.length ? this.fishSchools.length * 5 : 0,
      crabs: this.crabRoot.visible ? Math.min(this.crabs.length, this.dockAnchors.length) : 0,
      cats: this.catRoot.visible ? Math.min(this.cats.length, this.catAnchors.length) : 0,
      butterflies: this.butterflyRoot.visible ? Math.min(this.butterflies.length, Math.max(0, this.gardenAnchors.length * 3)) : 0,
    };
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

  private createAmbientBirds() {
    const material = new THREE.MeshBasicMaterial({ color: 0x47676b, side: THREE.DoubleSide });
    for (let index = 0; index < 6; index++) {
      const bird = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-.18, 0, 0), new THREE.Vector3(0, -.06, 0), new THREE.Vector3(.18, 0, 0),
      ]), material);
      bird.position.set(index * .6, Math.sin(index) * .34, Math.cos(index * 2) * .5);
      this.ambientBirds.add(bird);
    }
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
      model.scale.setScalar(.78);
      model.position.copy(this.townCenter).setY(4 + index * .12);
      this.gullRoot.add(model);
      this.gulls.push({ model, leftWing, rightWing, phase: hash(this.seed, index, 0, 2301) * Math.PI * 2, mode: 'flying' });
    }
  }

  private createFishSchools() {
    const materials = [0x315f65, 0x5b7c78, 0x8b7553].map((color) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .58, depthWrite: false }));
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
        fish.position.set((fishIndex - 2) * .25, 0, Math.sin(fishIndex * 2) * .18);
        school.add(fish);
      }
      this.fishRoot.add(school);
      this.fishSchools.push(school);
    }
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
      crab.scale.setScalar(.85);
      this.crabRoot.add(crab);
      this.crabs.push(crab);
    }
  }

  private createCats() {
    const coats = [0xc58b51, 0x4b4a4c, 0xe1c6a0];
    for (let index = 0; index < 3; index++) {
      const coat = new THREE.MeshStandardMaterial({ color: coats[index], roughness: .94 });
      const cat = new THREE.Group();
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
      tail.rotation.x = Math.PI / 2;
      tail.position.set(-.25, .18, 0);
      cat.add(body, head, tail);
      cat.scale.setScalar(.9);
      this.catRoot.add(cat);
      this.cats.push(cat);
    }
  }

  private createButterflies() {
    const colors = [0xe9ad42, 0x74a5a0, 0xd4737d];
    for (let index = 0; index < 12; index++) {
      const butterfly = new THREE.Group();
      const material = new THREE.MeshBasicMaterial({ color: colors[index % colors.length], side: THREE.DoubleSide });
      const left = new THREE.Mesh(new THREE.CircleGeometry(.07, 5, 0, Math.PI), material);
      const right = new THREE.Mesh(new THREE.CircleGeometry(.07, 5, 0, Math.PI), material);
      left.position.x = -.045;
      right.position.x = .045;
      left.userData.wingSide = -1;
      right.userData.wingSide = 1;
      butterfly.add(left, right);
      this.butterflyRoot.add(butterfly);
      this.butterflies.push(butterfly);
    }
  }

  private updateAmbientBirds(time: number) {
    const angle = time * .085;
    this.ambientBirds.position.set(this.townCenter.x + Math.cos(angle) * 9, 7.5 + Math.sin(time * .35), this.townCenter.z + Math.sin(angle) * 9);
    this.ambientBirds.rotation.y = -angle;
    this.ambientBirds.children.forEach((bird, index) => { bird.rotation.z = Math.sin(time * 5 + index) * .22; });
  }

  private updateGulls(time: number, daylight: number, timeOfDay: number, absoluteHours: number) {
    if (!this.gullRoot.visible) return;
    const routineFeedAnchor = this.gardenAnchors[0] ?? this.dockAnchors[0] ?? this.townCenter;
    const triggeredFeedAnchor = this.feedFocus ?? routineFeedAnchor;
    const scatterAnchor = this.scatterFocus ?? this.townCenter;
    for (let index = 0; index < this.gulls.length; index++) {
      const gull = this.gulls[index];
      const desired = new THREE.Vector3();
      const scattering = time < this.scatterUntil;
      const triggeredFeeding = time < this.feedUntil;
      const perching = !scattering && !triggeredFeeding && (daylight < .24 || (this.discoveries.has('birds-nest') && (Math.floor(absoluteHours * 2) + index) % 8 === 0));
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
    this.crabs.forEach((crab, index) => {
      const anchor = this.dockAnchors[index % Math.max(1, this.dockAnchors.length)];
      crab.visible = this.crabRoot.visible && Boolean(anchor);
      if (!anchor) return;
      const sway = Math.sin(time * .8 + index * 2.2);
      crab.position.set(anchor.x + sway * .22, anchor.y, anchor.z + Math.cos(time * .55 + index) * .16);
      crab.rotation.y = sway > 0 ? Math.PI / 2 : -Math.PI / 2;
    });
  }

  private updateCats(time: number) {
    this.cats.forEach((cat, index) => {
      const anchor = time < this.catGatherUntil && this.catGatherFocus ? this.catGatherFocus : this.catAnchors[index % Math.max(1, this.catAnchors.length)];
      cat.visible = this.catRoot.visible && Boolean(anchor);
      if (!anchor) return;
      const angle = time * (.16 + index * .03) + index * 2.5;
      cat.position.set(anchor.x + Math.cos(angle) * (.32 + index * .06), anchor.y, anchor.z + Math.sin(angle) * (.25 + index * .05));
      cat.rotation.y = -angle - Math.PI / 2;
      cat.children.at(-1)!.rotation.z = Math.sin(time * 2.4 + index) * .18;
    });
  }

  private updateButterflies(time: number, daylight: number) {
    this.butterflies.forEach((butterfly, index) => {
      const anchor = this.gardenAnchors[Math.floor(index / 3) % Math.max(1, this.gardenAnchors.length)];
      butterfly.visible = this.butterflyRoot.visible && daylight > .28 && Boolean(anchor) && index < this.gardenAnchors.length * 3;
      if (!anchor) return;
      const angle = time * (.45 + index * .007) + index * 2.39;
      const radius = .42 + index % 3 * .18;
      butterfly.position.set(anchor.x + Math.cos(angle) * radius, anchor.y + .55 + Math.sin(time * 1.8 + index) * .28, anchor.z + Math.sin(angle) * radius);
      butterfly.rotation.y = -angle;
      butterfly.children.forEach((wing) => { wing.rotation.y = Math.sin(time * 9 + index) * .8 * (wing.userData.wingSide as number); });
    });
  }
}
