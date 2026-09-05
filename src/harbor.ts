import * as THREE from 'three';
import type { BusinessSave, Cell, CitizenSave } from './types';
import { hash } from './random';
import { analyzeWaterTopology, createShorelineRoute, type WaterTopology } from './water';

export function createWaterRoute(cells: Iterable<Cell>, seed: number, lane = 0) {
  return createShorelineRoute(cells, seed, lane);
}

type BoatKind = 'rowboat' | 'fishing boat' | 'merchant boat' | 'ferry';

type BoatActor = {
  kind: BoatKind;
  model: THREE.Group;
  route: THREE.CatmullRomCurve3;
  phase: number;
  speed: number;
  bobSpeed: number;
};

export class HarborAmbience {
  readonly root = new THREE.Group();
  private readonly fleet: BoatActor[] = [];
  private readonly birds = new THREE.Group();
  private readonly gulls = new THREE.Group();
  private readonly clouds = new THREE.Group();
  private readonly petals: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly fireflies: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly floatingLanterns: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly fireworks: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xffe2bc, transparent: true, opacity: .42, roughness: 1, depthWrite: false });
  private readonly starMaterial = new THREE.PointsMaterial({ color: 0xffe4a3, size: .13, transparent: true, opacity: 0, depthWrite: false });
  private readonly sunDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private cells: Cell[] = [];
  private businesses: BusinessSave[] = [];
  private citizens: CitizenSave[] = [];
  private discoveries = new Set<string>();
  private topology!: WaterTopology;

  constructor(private readonly seed: number, camera: THREE.Camera, cells: Iterable<Cell>) {
    this.root.name = 'harbor-ambience';
    this.createFleet();
    this.setTown(cells);
    this.createBirds();
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
    this.sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xffc36f, transparent: true, opacity: .65, depthWrite: false }),
    );
    this.sunDisc.position.set(-17, 14, -28);
    this.sunDisc.lookAt(camera.position);
    this.root.add(this.sunDisc);
  }

  setTown(cells: Iterable<Cell>, businesses: readonly BusinessSave[] = this.businesses, citizens: readonly CitizenSave[] = this.citizens) {
    this.cells = [...cells].map((cell) => ({ ...cell }));
    this.businesses = businesses.map((business) => ({ ...business }));
    this.citizens = citizens.map((citizen) => ({ ...citizen, traits: [...citizen.traits], relationships: [...citizen.relationships] }));
    this.topology = analyzeWaterTopology(this.cells, this.seed);
    this.fleet.forEach((boat, index) => { boat.route = createWaterRoute(this.cells, this.seed, index * .42); });
    this.refreshFleetVisibility();
  }

  setDiscoveryState(discoveries: readonly string[]) {
    this.discoveries = new Set(discoveries);
    this.gulls.visible = this.discoveries.has('gulls-return');
    this.petals.visible = this.discoveries.has('blossom-tide');
    this.fireflies.visible = this.discoveries.has('evening-chorus');
    this.floatingLanterns.visible = this.discoveries.has('lantern-finale');
    this.fireworks.visible = this.discoveries.has('lantern-finale');
    this.refreshFleetVisibility();
  }

  waterTopology() { return this.topology; }

  activeFleet() { return this.fleet.filter((boat) => boat.model.visible).map((boat) => boat.kind); }

  update(time: number, daylight: number) {
    for (const boat of this.fleet) {
      if (!boat.model.visible) continue;
      const progress = (time * boat.speed + boat.phase) % 1;
      const point = boat.route.getPointAt(progress);
      const tangent = boat.route.getTangentAt(progress);
      boat.model.position.copy(point);
      boat.model.position.y += Math.sin(time * boat.bobSpeed + boat.phase * 8) * .055;
      boat.model.rotation.y = Math.atan2(tangent.x, tangent.z);
      boat.model.rotation.z = Math.sin(time * boat.bobSpeed * .78 + boat.phase * 5) * .028;
    }
    const birdAngle = time * .085;
    this.birds.position.set(Math.cos(birdAngle) * 9, 7.5 + Math.sin(time * .35), Math.sin(birdAngle) * 9);
    this.birds.rotation.y = -birdAngle;
    this.birds.children.forEach((bird, index) => { bird.rotation.z = Math.sin(time * 5 + index) * .22; });
    const gullAngle = time * .055;
    this.gulls.position.set(Math.cos(gullAngle) * 12, 3.2 + Math.sin(time * .4) * .6, Math.sin(gullAngle) * 10);
    this.gulls.rotation.y = -gullAngle;
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
  }

  private createFleet() {
    const emptyRoute = createWaterRoute([], this.seed);
    const rowboat = this.createRowboat();
    const fishingBoat = this.createFishingBoat();
    const merchantBoat = this.createMerchantBoat();
    const ferry = this.createFerry();
    this.fleet.push(
      { kind: 'rowboat', model: rowboat, route: emptyRoute, phase: .08, speed: .012, bobSpeed: 1.15 },
      { kind: 'fishing boat', model: fishingBoat, route: emptyRoute, phase: .42, speed: .009, bobSpeed: 1.4 },
      { kind: 'merchant boat', model: merchantBoat, route: emptyRoute, phase: .68, speed: .0065, bobSpeed: 1.05 },
      { kind: 'ferry', model: ferry, route: emptyRoute, phase: .87, speed: .0075, bobSpeed: .92 },
    );
    for (const boat of this.fleet) {
      boat.model.name = boat.kind.replaceAll(' ', '-');
      boat.model.visible = false;
      this.root.add(boat.model);
    }
  }

  private refreshFleetVisibility() {
    if (!this.topology) return;
    const hasDock = this.topology.docks.length > 0;
    const hasInn = this.businesses.some((business) => business.type === 'inn');
    const hasFisher = this.citizens.some((citizen) => citizen.occupation === 'Fisher');
    for (const boat of this.fleet) {
      if (boat.kind === 'rowboat') boat.model.visible = this.cells.length > 0;
      if (boat.kind === 'fishing boat') boat.model.visible = hasDock && hasFisher && this.discoveries.has('fishing-boat');
      if (boat.kind === 'merchant boat') boat.model.visible = hasDock && this.discoveries.has('merchant-arrival');
      if (boat.kind === 'ferry') boat.model.visible = hasDock && hasInn && this.discoveries.has('ferry-route');
    }
  }

  private createFishingBoat() {
    const boat = new THREE.Group();
    const sailMaterial = new THREE.MeshStandardMaterial({ color: 0xb9493e, side: THREE.DoubleSide, roughness: .9 });
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x593e34, roughness: .95 });
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.25, .78, 4, 8), hullMaterial);
    hull.rotation.z = Math.PI / 2;
    hull.scale.y = .55;
    hull.castShadow = true;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(.018, .022, .9, 6), hullMaterial);
    mast.position.y = .48;
    const sail = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(.02, .83, 0), new THREE.Vector3(.02, .12, 0), new THREE.Vector3(.52, .18, 0),
    ]), sailMaterial);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(.45, .05, .34), new THREE.MeshStandardMaterial({ color: 0xd7b260, roughness: 1 }));
    canopy.position.set(-.22, .28, 0);
    const nets = new THREE.Mesh(new THREE.TorusGeometry(.2, .025, 5, 12), new THREE.MeshStandardMaterial({ color: 0xbfae83, roughness: 1 }));
    nets.position.set(-.35, .18, .22);
    nets.rotation.x = Math.PI / 2;
    boat.add(hull, mast, sail, canopy, nets);
    return boat;
  }

  private createRowboat() {
    const boat = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: 0x685045, roughness: 1 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xd5bd7d, roughness: 1 });
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.18, .55, 3, 7), wood);
    hull.rotation.z = Math.PI / 2;
    hull.scale.y = .5;
    const cover = new THREE.Mesh(new THREE.BoxGeometry(.38, .04, .27), cloth);
    cover.position.y = .2;
    boat.add(hull, cover);
    boat.scale.setScalar(.84);
    return boat;
  }

  private createMerchantBoat() {
    const boat = new THREE.Group();
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x385e63, roughness: .92 });
    const deckMaterial = new THREE.MeshStandardMaterial({ color: 0xb7834d, roughness: 1 });
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.3, 1.15, 4, 10), hullMaterial);
    hull.rotation.z = Math.PI / 2;
    hull.scale.y = .58;
    hull.castShadow = true;
    const deck = new THREE.Mesh(new THREE.BoxGeometry(.92, .08, .48), deckMaterial);
    deck.position.y = .2;
    boat.add(hull, deck);
    for (const x of [-.28, .05, .35]) {
      const crate = new THREE.Mesh(new THREE.BoxGeometry(.23, .22, .23), deckMaterial);
      crate.position.set(x, .35, x === .05 ? -.1 : .08);
      boat.add(crate);
    }
    boat.scale.setScalar(1.08);
    return boat;
  }

  private createFerry() {
    const boat = new THREE.Group();
    const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x4c4b54, roughness: .9 });
    const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0xe2cf9f, roughness: .95 });
    const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8d403a, roughness: .86 });
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.32, 1.42, 4, 10), hullMaterial);
    hull.rotation.z = Math.PI / 2;
    hull.scale.y = .58;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(.9, .36, .48), cabinMaterial);
    cabin.position.y = .34;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.08, .08, .62), roofMaterial);
    roof.position.y = .56;
    boat.add(hull, cabin, roof);
    for (const x of [-.34, 0, .34]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(.17, .14, .015), new THREE.MeshStandardMaterial({ color: 0xffc66d, emissive: 0xff9d3d, emissiveIntensity: .8 }));
      window.position.set(x, .38, .25);
      boat.add(window);
    }
    boat.scale.setScalar(1.12);
    return boat;
  }

  private createBirds() {
    const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x47676b, side: THREE.DoubleSide });
    for (let index = 0; index < 7; index++) {
      const bird = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-.18, 0, 0), new THREE.Vector3(0, -.06, 0), new THREE.Vector3(.18, 0, 0),
      ]), birdMaterial);
      bird.position.set(index * .6, Math.sin(index) * .34, Math.cos(index * 2) * .5);
      this.birds.add(bird);
    }
    const gullMaterial = new THREE.MeshBasicMaterial({ color: 0xe8e2cf, side: THREE.DoubleSide });
    for (let index = 0; index < 5; index++) {
      const gull = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-.22, 0, 0), new THREE.Vector3(0, -.08, 0), new THREE.Vector3(.22, 0, 0),
      ]), gullMaterial);
      gull.position.set((index - 2) * .7, Math.sin(index * 2) * .25, Math.cos(index) * .55);
      this.gulls.add(gull);
    }
    this.gulls.visible = false;
    this.root.add(this.birds, this.gulls);
  }

  private createClouds() {
    for (let cloudIndex = 0; cloudIndex < 5; cloudIndex++) {
      const cloud = new THREE.Group();
      for (let puff = 0; puff < 4; puff++) {
        const shape = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + (puff % 2) * .45, 1), this.cloudMaterial);
        shape.scale.set(1.65, .55, .7);
        shape.position.set(puff * 1.25, Math.sin(puff) * .32, 0);
        cloud.add(shape);
      }
      cloud.position.set(-24 + cloudIndex * 11, 10 + (cloudIndex % 2) * 2.5, -20 - cloudIndex * 2);
      this.clouds.add(cloud);
    }
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
