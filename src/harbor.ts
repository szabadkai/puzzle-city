import * as THREE from 'three';
import type { Cell } from './types';
import { hash } from './random';

const CELL = 2.45;

export function createWaterRoute(cells: Iterable<Cell>, seed: number) {
  const occupied = [...cells].map((cell) => new THREE.Vector2(cell.x * CELL, cell.z * CELL));
  const furthest = occupied.reduce((radius, point) => Math.max(radius, point.length()), 0);
  const baseRadius = THREE.MathUtils.clamp(furthest + 4.8, 11, 27);
  const points: THREE.Vector3[] = [];
  for (let index = 0; index < 36; index++) {
    const angle = index / 36 * Math.PI * 2;
    let radius = baseRadius + (hash(seed, index, 0, 1601) - .5) * 2.6;
    let x = Math.cos(angle) * radius;
    let z = Math.sin(angle) * radius * .84;
    for (let attempt = 0; attempt < 12 && occupied.some((point) => point.distanceToSquared(new THREE.Vector2(x, z)) < 13); attempt++) {
      radius += .7;
      x = Math.cos(angle) * radius;
      z = Math.sin(angle) * radius * .84;
    }
    points.push(new THREE.Vector3(x, -.12, z));
  }
  return new THREE.CatmullRomCurve3(points, true, 'catmullrom', .35);
}

export class HarborAmbience {
  readonly root = new THREE.Group();
  private readonly boat = new THREE.Group();
  private readonly skiff = new THREE.Group();
  private readonly birds = new THREE.Group();
  private readonly gulls = new THREE.Group();
  private readonly clouds = new THREE.Group();
  private readonly petals: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly fireflies: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private readonly cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xffe2bc, transparent: true, opacity: .42, roughness: 1, depthWrite: false });
  private readonly starMaterial = new THREE.PointsMaterial({ color: 0xffe4a3, size: .13, transparent: true, opacity: 0, depthWrite: false });
  private readonly sunDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private route: THREE.CatmullRomCurve3;

  constructor(private readonly seed: number, camera: THREE.Camera, cells: Iterable<Cell>) {
    this.root.name = 'harbor-ambience';
    this.route = createWaterRoute(cells, seed);
    this.createBoat();
    this.createSkiff();
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
    this.sunDisc = new THREE.Mesh(
      new THREE.CircleGeometry(2.2, 32),
      new THREE.MeshBasicMaterial({ color: 0xffc36f, transparent: true, opacity: .65, depthWrite: false }),
    );
    this.sunDisc.position.set(-17, 14, -28);
    this.sunDisc.lookAt(camera.position);
    this.root.add(this.sunDisc);
  }

  setTown(cells: Iterable<Cell>) {
    this.route = createWaterRoute(cells, this.seed);
  }

  setDiscoveryState(discoveries: readonly string[]) {
    const known = new Set(discoveries);
    this.gulls.visible = known.has('gulls-return');
    this.petals.visible = known.has('blossom-tide');
    this.fireflies.visible = known.has('evening-chorus');
  }

  update(time: number, daylight: number) {
    const progress = (time * .009) % 1;
    const point = this.route.getPointAt(progress);
    const tangent = this.route.getTangentAt(progress);
    this.boat.position.copy(point);
    this.boat.position.y += Math.sin(time * 1.4) * .07;
    this.boat.rotation.y = Math.atan2(tangent.x, tangent.z);
    this.boat.rotation.z = Math.sin(time * 1.1) * .035;
    const skiffProgress = (progress + .47) % 1;
    const skiffPoint = this.route.getPointAt(skiffProgress);
    const skiffTangent = this.route.getTangentAt(skiffProgress);
    this.skiff.position.copy(skiffPoint);
    this.skiff.position.y += Math.sin(time * 1.15 + 2) * .055;
    this.skiff.rotation.y = Math.atan2(skiffTangent.x, skiffTangent.z);
    this.skiff.rotation.z = Math.sin(time * .95 + 1) * .028;
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
  }

  private createBoat() {
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
    this.boat.add(hull, mast, sail, canopy);
    this.root.add(this.boat);
  }

  private createSkiff() {
    const wood = new THREE.MeshStandardMaterial({ color: 0x685045, roughness: 1 });
    const cloth = new THREE.MeshStandardMaterial({ color: 0xd5bd7d, roughness: 1 });
    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.18, .55, 3, 7), wood);
    hull.rotation.z = Math.PI / 2;
    hull.scale.y = .5;
    const cover = new THREE.Mesh(new THREE.BoxGeometry(.38, .04, .27), cloth);
    cover.position.y = .2;
    this.skiff.add(hull, cover);
    this.skiff.scale.setScalar(.84);
    this.root.add(this.skiff);
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
}
