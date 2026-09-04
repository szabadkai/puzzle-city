import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CARDINALS, type Cell, keyOf } from './types';
import { hash, pick } from './random';

const CELL = 2.45;
const FLOOR = 1.42;
const BASE_Y = 0.05;
const WALL_COLORS = [0xd88966, 0xd9b967, 0xbc6c5c, 0x73a69a, 0x7390a1, 0xb9828d, 0xd8c99f, 0x9f9a7e];
const ROOF_COLORS = [0x733e38, 0xa6533c, 0x315f5b, 0x3f5260, 0x5b4748, 0x354747];
const SIGN_COLORS = [0xb63d32, 0x236d67, 0xd38b38, 0x314d66];
const SIGN_TEXT = ['茶', '花', '本', '湯', '魚', '宿'];

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
  private readonly signMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly seed: number;
  private readonly cream = new THREE.MeshStandardMaterial({ color: 0xe8d7ad, roughness: .94 });
  private readonly stone = new THREE.MeshStandardMaterial({ color: 0xb9ad91, roughness: 1 });
  private readonly stoneDark = new THREE.MeshStandardMaterial({ color: 0x786f63, roughness: 1 });
  private readonly window = new THREE.MeshStandardMaterial({ color: 0x294b52, roughness: .35, emissive: 0xffa347, emissiveIntensity: .08 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x443633, roughness: .9 });
  private readonly green = new THREE.MeshStandardMaterial({ color: 0x4f855d, roughness: 1 });
  private readonly leaf = new THREE.MeshStandardMaterial({ color: 0x648d51, roughness: 1 });
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x774b38, roughness: 1 });
  private readonly metal = new THREE.MeshStandardMaterial({ color: 0x3c5657, roughness: .8 });
  private readonly warmLight = new THREE.MeshStandardMaterial({ color: 0xffcf72, emissive: 0xff9d3d, emissiveIntensity: 1.25 });

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
      group.traverse((object) => {
        if (object.name.startsWith('laundry-')) object.rotation.z = Math.sin(time * 2.2 + object.id) * .045;
      });
    }
  }

  setDaylight(daylight: number) {
    const night = 1 - daylight;
    this.window.emissiveIntensity = .06 + night * 2.15;
    this.warmLight.emissiveIntensity = .4 + night * 3.8;
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
      this.addRoofEaves(group, topY, roof, cell);
      this.addChimney(group, topY + .25, -.58, .38);
      this.addFlag(group, topY + 1.55);
    } else if (count <= 2) {
      const cap = shadow(new THREE.Mesh(new THREE.ConeGeometry(CELL * .82, .88, 4), roof));
      cap.position.y = topY + .43;
      cap.rotation.y = Math.PI / 4;
      group.add(cap);
      this.addRoofEaves(group, topY, roof, cell);
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
      else if (cell.height >= 2 && hash(this.seed, cell.x, cell.z, 146) > .5) this.addWaterTank(group, topY + .18);
    }

    if ((count === 2 && this.isCorner(neighborHeights)) || (cell.height >= 2 && count <= 1)) this.addBalcony(group, cell, topY);
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
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(.075, 8, 6), this.warmLight);
      lamp.position.set(px + lateral.x * .36, 1.16, pz + lateral.z * .36);
      group.add(lamp);
      this.addAwning(group, cell, dir, lateral, px, pz);
      if (hash(this.seed, cell.x, cell.z, 710 + dir) > .18) this.addHangingSign(group, cell, dir, lateral, px, pz);
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
    if (level > 0 && hash(this.seed, cell.x, cell.z, 810 + dir * 11 + level) > .77) {
      this.addAirConditioner(group, dir, lateral, px, pz, y - .2);
    }
    if (level === 0 && hash(this.seed, cell.x, cell.z, 850 + dir) > .8) this.addPipe(group, dir, lateral, px, pz);
  }

  private addAwning(group: THREE.Group, cell: Cell, dir: Direction, lateral: THREE.Vector3, px: number, pz: number) {
    const [dx, dz] = CARDINALS[dir];
    const colors = [0xb5463e, 0x3f7770, 0xd08b3e];
    const awningMaterial = new THREE.MeshStandardMaterial({ color: pick(colors, hash(this.seed, cell.x, cell.z, 690 + dir)), roughness: .9 });
    for (let i = 0; i < 5; i++) {
      const strip = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .42 : .24, .08, dir % 2 ? .24 : .42), i % 2 ? this.cream : awningMaterial));
      const offset = (i - 2) * .21;
      strip.position.set(px + dx * .21 + lateral.x * offset, 1.25, pz + dz * .21 + lateral.z * offset);
      strip.rotation.set(lateral.z * -.13, 0, lateral.x * .13);
      group.add(strip);
    }
  }

  private addHangingSign(group: THREE.Group, cell: Cell, dir: Direction, lateral: THREE.Vector3, px: number, pz: number) {
    const signIndex = Math.floor(hash(this.seed, cell.x, cell.z, 722 + dir) * SIGN_TEXT.length);
    const text = SIGN_TEXT[signIndex];
    const color = SIGN_COLORS[signIndex % SIGN_COLORS.length];
    const materialKey = `${text}-${color}`;
    let material = this.signMaterials.get(materialKey);
    if (!material) {
      const canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 192;
      const context = canvas.getContext('2d')!;
      context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      context.fillRect(4, 4, 88, 184);
      context.strokeStyle = '#ead9ad';
      context.lineWidth = 5;
      context.strokeRect(8, 8, 80, 176);
      context.fillStyle = '#fff1c7';
      context.font = 'bold 66px serif';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 48, 98);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: .78, emissive: color, emissiveIntensity: .08 });
      this.signMaterials.set(materialKey, material);
    }
    const [dx, dz] = CARDINALS[dir];
    const sign = shadow(new THREE.Mesh(new THREE.PlaneGeometry(.42, .86), material));
    sign.position.set(px + dx * .13 + lateral.x * .73, 1.31, pz + dz * .13 + lateral.z * .73);
    sign.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(sign);
    const bracket = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .22 : .03, .03, dir % 2 ? .03 : .22), this.metal));
    bracket.position.set(px + dx * .08 + lateral.x * .73, 1.79, pz + dz * .08 + lateral.z * .73);
    group.add(bracket);
  }

  private addAirConditioner(group: THREE.Group, dir: Direction, lateral: THREE.Vector3, px: number, pz: number, y: number) {
    const [dx, dz] = CARDINALS[dir];
    const unit = shadow(new THREE.Mesh(new RoundedBoxGeometry(dir % 2 ? .18 : .5, .32, dir % 2 ? .5 : .18, 2, .03), this.cream));
    unit.position.set(px + dx * .12 + lateral.x * .52, y, pz + dz * .12 + lateral.z * .52);
    group.add(unit);
    const fan = new THREE.Mesh(new THREE.TorusGeometry(.09, .018, 5, 10), this.metal);
    fan.position.set(unit.position.x + dx * .1, y, unit.position.z + dz * .1);
    fan.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(fan);
  }

  private addPipe(group: THREE.Group, dir: Direction, lateral: THREE.Vector3, px: number, pz: number) {
    const [dx, dz] = CARDINALS[dir];
    const pipe = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, 1.18, 6), this.metal));
    pipe.position.set(px + dx * .08 + lateral.x * .94, .92, pz + dz * .08 + lateral.z * .94);
    group.add(pipe);
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
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const line = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.04, 5), this.dark));
    line.position.set(dx * 1.53, topY - .32, dz * 1.53);
    line.rotation.z = Math.PI / 2;
    line.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(line);
    const laundryColors = [0xe9cf9d, 0xb7514a, 0x547f86];
    for (let i = 0; i < 3; i++) {
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.27, .31 + i * .03), new THREE.MeshStandardMaterial({ color: laundryColors[i], side: THREE.DoubleSide, roughness: 1 }));
      cloth.position.set(dx * 1.55 + lateral.x * (i - 1) * .34, topY - .5, dz * 1.55 + lateral.z * (i - 1) * .34);
      cloth.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      cloth.name = `laundry-${i}`;
      group.add(cloth);
    }
  }

  private addRoofEaves(group: THREE.Group, y: number, roofMaterial: THREE.Material, cell: Cell) {
    const eave = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * 1.13, .11, CELL * 1.13, 2, .04), roofMaterial));
    eave.position.y = y + .04;
    group.add(eave);
    const ridge = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.065, .065, CELL * .9, 8), this.dark));
    ridge.position.y = y + .88;
    ridge.rotation.z = Math.PI / 2;
    ridge.rotation.y = hash(this.seed, cell.x, cell.z, 126) > .5 ? Math.PI / 2 : 0;
    group.add(ridge);
    for (const side of [-1, 1]) {
      const cap = shadow(new THREE.Mesh(new THREE.SphereGeometry(.09, 7, 5), this.dark));
      cap.position.set(side * .49 * (ridge.rotation.y ? 0 : 1), y + .88, side * .49 * (ridge.rotation.y ? 1 : 0));
      group.add(cap);
    }
  }

  private addWaterTank(group: THREE.Group, y: number) {
    const tank = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.36, .4, .62, 10), this.metal));
    tank.position.set(.3, y + .38, -.25);
    group.add(tank);
    for (const x of [.05, .55]) {
      const leg = shadow(new THREE.Mesh(new THREE.BoxGeometry(.05, .25, .05), this.dark));
      leg.position.set(x, y + .1, -.25);
      group.add(leg);
    }
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
