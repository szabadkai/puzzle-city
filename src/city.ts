import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CARDINALS, type Cell, keyOf } from './types';
import { hash, pick } from './random';

const CELL = 2.45;
const FLOOR = 1.42;
const BASE_Y = 0.05;
const WALL_COLORS = [0xef9b72, 0xf2c66d, 0xe77969, 0x7ebeb3, 0x87a8c3, 0xd99bc0, 0xf0dfb1];
const ROOF_COLORS = [0xb44942, 0xd46c45, 0x4f7d79, 0x66758c, 0x934f58];

type Direction = 0 | 1 | 2 | 3;

function dispose(root: THREE.Object3D) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) object.geometry.dispose();
  });
}

function shadow(mesh: THREE.Mesh) {
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export class CityRenderer {
  readonly root = new THREE.Group();
  readonly cells = new Map<string, Cell>();
  private readonly pieces = new Map<string, THREE.Group>();
  private readonly seed: number;
  private readonly cream = new THREE.MeshStandardMaterial({ color: 0xfff0cc, roughness: .88 });
  private readonly stone = new THREE.MeshStandardMaterial({ color: 0xd8c9a9, roughness: .95 });
  private readonly stoneDark = new THREE.MeshStandardMaterial({ color: 0xa99477, roughness: 1 });
  private readonly window = new THREE.MeshStandardMaterial({ color: 0x244b58, roughness: .45, emissive: 0x10252b, emissiveIntensity: .15 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x563f39, roughness: .85 });
  private readonly green = new THREE.MeshStandardMaterial({ color: 0x5d9c68, roughness: 1 });
  private readonly leaf = new THREE.MeshStandardMaterial({ color: 0x70a95f, roughness: 1 });
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x9d6547, roughness: .95 });
  private readonly metal = new THREE.MeshStandardMaterial({ color: 0x3f6466, roughness: .7 });

  constructor(seed: number) {
    this.seed = seed;
    this.root.name = 'town';
  }

  static cellSize() { return CELL; }

  load(cells: Cell[]) {
    for (const cell of cells) this.cells.set(keyOf(cell.x, cell.z), { ...cell });
    this.rebuildAll(false);
  }

  get(x: number, z: number) { return this.cells.get(keyOf(x, z)); }

  worldPosition(x: number, z: number) {
    return new THREE.Vector3(x * CELL, 0, z * CELL);
  }

  isBuildable(x: number, z: number) {
    if (Math.hypot(x, z) > 8.8) return false;
    if (this.cells.size === 0) return true;
    return CARDINALS.some(([dx, dz]) => this.cells.has(keyOf(x + dx, z + dz)));
  }

  place(x: number, z: number) {
    const key = keyOf(x, z);
    const existing = this.cells.get(key);
    if (!existing && !this.isBuildable(x, z)) return false;
    if (existing) {
      if (existing.height >= 5) return false;
      existing.height += 1;
      existing.placedAt = performance.now();
    } else {
      this.cells.set(key, {
        x, z, height: 1,
        color: Math.floor(hash(this.seed, x, z, 91) * WALL_COLORS.length),
        placedAt: performance.now(),
      });
    }
    this.rebuildAround(x, z);
    return true;
  }

  remove(x: number, z: number) {
    const cell = this.get(x, z);
    if (!cell) return false;
    if (cell.height > 1) {
      cell.height -= 1;
      cell.placedAt = performance.now();
    } else {
      this.cells.delete(keyOf(x, z));
    }
    this.rebuildAround(x, z);
    return true;
  }

  serialize() { return [...this.cells.values()].map((cell) => ({ ...cell, placedAt: 0 })); }

  update(time: number) {
    for (const [key, group] of this.pieces) {
      const cell = this.cells.get(key);
      if (cell && cell.placedAt > 0) {
        const age = Math.min(1, (performance.now() - cell.placedAt) / 430);
        const eased = 1 - Math.pow(1 - age, 3);
        group.scale.y = .04 + eased * .96;
        if (age >= 1) cell.placedAt = 0;
      } else {
        group.scale.y = 1;
      }
      const tree = group.getObjectByName('swaying-tree');
      if (tree) tree.rotation.z = Math.sin(time * 1.35 + group.position.x) * .025;
      const flag = group.getObjectByName('flag');
      if (flag) flag.rotation.y = Math.sin(time * 3 + group.position.z) * .15;
    }
  }

  topologyLabel(x: number, z: number) {
    const cell = this.get(x, z);
    if (!cell) return this.emptyFeature(x, z) ?? 'open water';
    const neighbors = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz));
    const count = neighbors.filter(Boolean).length;
    if (cell.height >= 3 && count <= 1) return 'tower';
    if (count === 2 && ((neighbors[0] && neighbors[1]) || (neighbors[1] && neighbors[2]) || (neighbors[2] && neighbors[3]) || (neighbors[3] && neighbors[0]))) return 'corner house';
    if (count === 2) return 'connected row';
    if (count >= 3) return 'apartment cluster';
    return count === 1 ? 'waterfront house' : 'little sea house';
  }

  private rebuildAll(animate: boolean) {
    for (const piece of this.pieces.values()) {
      this.root.remove(piece);
      dispose(piece);
    }
    this.pieces.clear();
    for (const cell of this.cells.values()) {
      if (animate) cell.placedAt = performance.now();
      this.buildAt(cell.x, cell.z);
    }
    for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
      if (!this.get(x, z) && this.emptyFeature(x, z)) this.buildAt(x, z);
    }
  }

  private rebuildAround(x: number, z: number) {
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
      const px = x + dx;
      const pz = z + dz;
      const key = keyOf(px, pz);
      const old = this.pieces.get(key);
      if (old) {
        this.root.remove(old);
        dispose(old);
        this.pieces.delete(key);
      }
      if (this.get(px, pz) || this.emptyFeature(px, pz)) this.buildAt(px, pz);
    }
  }

  private buildAt(x: number, z: number) {
    const group = new THREE.Group();
    group.position.set(x * CELL, 0, z * CELL);
    const cell = this.get(x, z);
    if (cell) this.buildCell(group, cell);
    else this.buildFeature(group, x, z);
    this.root.add(group);
    this.pieces.set(keyOf(x, z), group);
  }

  private neighborHeight(cell: Cell, dir: Direction) {
    const [dx, dz] = CARDINALS[dir];
    return this.get(cell.x + dx, cell.z + dz)?.height ?? 0;
  }

  private buildCell(group: THREE.Group, cell: Cell) {
    const neighborHeights = CARDINALS.map((_, i) => this.neighborHeight(cell, i as Direction));
    const count = neighborHeights.filter((height) => height > 0).length;
    const wallColor = WALL_COLORS[cell.color % WALL_COLORS.length];
    const walls = new THREE.MeshStandardMaterial({ color: wallColor, roughness: .92 });
    const roof = new THREE.MeshStandardMaterial({ color: pick(ROOF_COLORS, hash(this.seed, cell.x, cell.z, 13)), roughness: .82 });

    const foundation = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .97, .34, CELL * .97, 3, .12), this.stone));
    foundation.position.y = BASE_Y;
    group.add(foundation);

    for (let level = 0; level < cell.height; level++) {
      const body = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * 1.005, FLOOR + .04, CELL * 1.005, 3, .09), walls));
      body.position.y = .34 + FLOOR * level + FLOOR / 2;
      group.add(body);

      for (let dir = 0; dir < 4; dir++) {
        if (neighborHeights[dir] > level) continue;
        this.addFacade(group, cell, dir as Direction, level, count);
      }
    }

    const topY = .38 + FLOOR * cell.height;
    const isolated = count <= 1;
    if (cell.height >= 3 && isolated) {
      const towerRoof = shadow(new THREE.Mesh(new THREE.ConeGeometry(CELL * .76, 1.42, 8), roof));
      towerRoof.position.y = topY + .7;
      towerRoof.rotation.y = Math.PI / 8;
      group.add(towerRoof);
      this.addChimney(group, topY + .25, -.58, .38);
      this.addFlag(group, topY + 1.55);
    } else if (count <= 2) {
      const cap = shadow(new THREE.Mesh(new THREE.ConeGeometry(CELL * .82, .88, 4), roof));
      cap.position.y = topY + .43;
      cap.rotation.y = Math.PI / 4;
      group.add(cap);
      if (hash(this.seed, cell.x, cell.z, 44) > .48) this.addChimney(group, topY + .2, -.55, .34);
    } else {
      const roofDeck = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .91, .18, CELL * .91, 2, .05), roof));
      roofDeck.position.y = topY + .07;
      group.add(roofDeck);
      for (let dir = 0; dir < 4; dir++) {
        if (neighborHeights[dir] >= cell.height) continue;
        const parapet = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .12 : CELL * .9, .28, dir % 2 ? CELL * .9 : .12), this.cream));
        const [px, pz] = this.edgePosition(dir as Direction, CELL * .42);
        parapet.position.set(px, topY + .22, pz);
        group.add(parapet);
      }
      if (count === 4) this.addRoofGarden(group, topY + .2, cell);
    }

    if (count === 2 && this.isCorner(neighborHeights)) this.addBalcony(group, cell, topY);
    this.addWaterEdges(group, cell, neighborHeights);
  }

  private addFacade(group: THREE.Group, cell: Cell, dir: Direction, level: number, neighborCount: number) {
    const y = .48 + level * FLOOR + FLOOR * .47;
    const windowCount = neighborCount === 0 ? 1 : 2;
    const isDoor = level === 0 && dir === this.doorDirection(cell);
    const lateral = new THREE.Vector3(CARDINALS[dir][1], 0, -CARDINALS[dir][0]);
    const [px, pz] = this.edgePosition(dir, CELL * .507);
    if (isDoor) {
      const door = shadow(new THREE.Mesh(new RoundedBoxGeometry(.46, .82, .08, 3, .07), this.dark));
      door.position.set(px, .34 + .43, pz);
      door.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(door);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(.075, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffd58a, emissive: 0xffb852, emissiveIntensity: .7 }));
      lamp.position.set(px + lateral.x * .36, 1.16, pz + lateral.z * .36);
      group.add(lamp);
    }
    for (let i = 0; i < windowCount; i++) {
      if (isDoor && i === 0) continue;
      const offset = windowCount === 1 ? 0 : (i - .5) * .72;
      const windowMesh = shadow(new THREE.Mesh(new RoundedBoxGeometry(.39, .48, .055, 2, .035), this.window));
      windowMesh.position.set(px + lateral.x * offset, y, pz + lateral.z * offset);
      windowMesh.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(windowMesh);
      const sill = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .09 : .5, .06, dir % 2 ? .5 : .09), this.cream));
      sill.position.set(px + lateral.x * offset, y - .29, pz + lateral.z * offset);
      group.add(sill);
    }
  }

  private doorDirection(cell: Cell): Direction {
    const open = CARDINALS.map((_, i) => this.neighborHeight(cell, i as Direction) === 0);
    const preferred = Math.floor(hash(this.seed, cell.x, cell.z, 27) * 4) as Direction;
    if (open[preferred]) return preferred;
    const first = open.findIndex(Boolean);
    return (first < 0 ? preferred : first) as Direction;
  }

  private edgePosition(dir: Direction, distance: number): [number, number] {
    const [dx, dz] = CARDINALS[dir];
    return [dx * distance, dz * distance];
  }

  private addWaterEdges(group: THREE.Group, cell: Cell, heights: number[]) {
    heights.forEach((height, index) => {
      if (height > 0) return;
      const dir = index as Direction;
      const [px, pz] = this.edgePosition(dir, CELL * .51);
      const quay = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .24 : CELL * .98, .68, dir % 2 ? CELL * .98 : .24), this.stoneDark));
      quay.position.set(px, -.17, pz);
      group.add(quay);
      if (cell.height === 1 && hash(this.seed, cell.x, cell.z, 200 + dir) > .74) {
        const dock = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? 1.1 : .82, .12, dir % 2 ? .82 : 1.1), this.wood));
        const [dx, dz] = CARDINALS[dir];
        dock.position.set(dx * (CELL * .78), -.03, dz * (CELL * .78));
        group.add(dock);
        for (const side of [-1, 1]) {
          const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.055, .07, .55, 7), this.wood));
          post.position.set(dock.position.x + (dir % 2 === 0 ? side * .28 : 0), .06, dock.position.z + (dir % 2 ? side * .28 : 0));
          group.add(post);
        }
      }
    });
  }

  private isCorner(heights: number[]) {
    return (heights[0] > 0 && heights[1] > 0) || (heights[1] > 0 && heights[2] > 0) || (heights[2] > 0 && heights[3] > 0) || (heights[3] > 0 && heights[0] > 0);
  }

  private addBalcony(group: THREE.Group, cell: Cell, topY: number) {
    const dir = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[dir];
    const deck = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .5 : 1.3, .1, dir % 2 ? 1.3 : .5), this.wood));
    deck.position.set(dx * 1.24, topY - .7, dz * 1.24);
    group.add(deck);
    const rail = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .06 : 1.26, .28, dir % 2 ? 1.26 : .06), this.metal));
    rail.position.set(dx * 1.47, topY - .52, dz * 1.47);
    group.add(rail);
  }

  private addChimney(group: THREE.Group, y: number, x: number, z: number) {
    const chimney = shadow(new THREE.Mesh(new RoundedBoxGeometry(.32, .68, .32, 2, .035), this.dark));
    chimney.position.set(x, y + .28, z);
    group.add(chimney);
    const smoke = new THREE.Group();
    smoke.name = 'smoke-source';
    smoke.position.set(x, y + .78, z);
    group.add(smoke);
  }

  private addFlag(group: THREE.Group, y: number) {
    const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.05, 6), this.metal));
    pole.position.y = y + .45;
    group.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(.56, .3), new THREE.MeshStandardMaterial({ color: 0xf3cc62, side: THREE.DoubleSide }));
    flag.name = 'flag';
    flag.position.set(.28, y + .72, 0);
    group.add(flag);
  }

  private addRoofGarden(group: THREE.Group, y: number, cell: Cell) {
    const planter = shadow(new THREE.Mesh(new RoundedBoxGeometry(.82, .24, .56, 2, .05), this.stone));
    planter.position.set(-.3, y + .12, .1);
    group.add(planter);
    for (let i = 0; i < 3; i++) {
      const plant = shadow(new THREE.Mesh(new THREE.SphereGeometry(.17 + hash(this.seed, cell.x, cell.z, 300 + i) * .08, 7, 5), this.green));
      plant.position.set(-.56 + i * .27, y + .35, .1);
      group.add(plant);
    }
  }

  private emptyFeature(x: number, z: number): string | null {
    const h = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz)?.height ?? 0);
    const count = h.filter((value) => value > 0).length;
    if (count >= 3) return 'courtyard garden';
    if (h[0] >= 3 && h[2] >= 3 && h[1] === 0 && h[3] === 0) return 'high bridge';
    if (h[1] >= 3 && h[3] >= 3 && h[0] === 0 && h[2] === 0) return 'high bridge';
    if (h[0] >= 2 && h[2] >= 2 && h[1] === 0 && h[3] === 0) return 'sea arch';
    if (h[1] >= 2 && h[3] >= 2 && h[0] === 0 && h[2] === 0) return 'sea arch';
    return null;
  }

  private buildFeature(group: THREE.Group, x: number, z: number) {
    const feature = this.emptyFeature(x, z);
    if (feature === 'courtyard garden') this.buildCourtyard(group, x, z);
    else if (feature) this.buildCrossing(group, x, z, feature === 'high bridge');
  }

  private buildCourtyard(group: THREE.Group, x: number, z: number) {
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .83, .2, CELL * .83, 4, .18), this.stone));
    platform.position.y = .05;
    group.add(platform);
    const patch = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.72, .78, .12, 12), this.green));
    patch.position.y = .18;
    group.add(patch);
    const trunk = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.1, .15, 1.25, 7), this.wood));
    trunk.position.y = .83;
    const canopy = new THREE.Group();
    canopy.name = 'swaying-tree';
    canopy.position.y = 1.28;
    for (let i = 0; i < 5; i++) {
      const crown = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(.48 + (i % 2) * .1, 1), this.leaf));
      const angle = i * Math.PI * .4 + hash(this.seed, x, z, 410) * 2;
      crown.position.set(Math.cos(angle) * .34, (i % 2) * .28, Math.sin(angle) * .34);
      canopy.add(crown);
    }
    group.add(trunk, canopy);
    for (const side of [-1, 1]) {
      const bench = shadow(new THREE.Mesh(new THREE.BoxGeometry(.68, .12, .22), this.wood));
      bench.position.set(side * .8, .34, .18);
      group.add(bench);
    }
  }

  private buildCrossing(group: THREE.Group, x: number, z: number, high: boolean) {
    const h = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz)?.height ?? 0);
    const northSouth = h[0] > 0 && h[2] > 0;
    const y = high ? FLOOR * 2.28 : FLOOR * 1.42;
    const walls = new THREE.MeshStandardMaterial({ color: pick(WALL_COLORS, hash(this.seed, x, z, 500)), roughness: .9 });
    const span = shadow(new THREE.Mesh(new RoundedBoxGeometry(northSouth ? 1.25 : CELL * 1.08, .58, northSouth ? CELL * 1.08 : 1.25, 4, .16), walls));
    span.position.y = y;
    group.add(span);
    const walk = shadow(new THREE.Mesh(new THREE.BoxGeometry(northSouth ? .95 : CELL, .12, northSouth ? CELL : .95), this.stone));
    walk.position.y = y + .34;
    group.add(walk);
    if (!high) {
      const archTop = shadow(new THREE.Mesh(new THREE.TorusGeometry(.68, .2, 7, 16, Math.PI), this.cream));
      archTop.rotation.y = northSouth ? 0 : Math.PI / 2;
      archTop.position.y = y - .2;
      group.add(archTop);
    } else {
      for (const side of [-1, 1]) {
        const rail = shadow(new THREE.Mesh(new THREE.BoxGeometry(northSouth ? .08 : CELL, .34, northSouth ? CELL : .08), this.metal));
        rail.position.set(northSouth ? side * .55 : 0, y + .52, northSouth ? 0 : side * .55);
        group.add(rail);
      }
    }
  }
}
