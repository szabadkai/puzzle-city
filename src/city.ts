import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARDINALS, type BusinessSave, type BusinessType, type Cell, keyOf } from './types';
import { hash, pick } from './random';
import { plazaAnchorAt } from './topology';
import { hasDock, hasWaterStairs } from './water';
import {
  arcadeFeature, courtyardFeature, emptyCrossingFeature, roofCourtAnchor, roofCourtFeature, steppedTerrace,
  type CourtyardFeature, type EmptyArchitectureFeature, type RoofCourtFeature, type TerraceFeature,
} from './architecture';

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

function shadow(mesh: THREE.Mesh, casts = true) {
  mesh.castShadow = casts;
  mesh.receiveShadow = true;
  return mesh;
}

export class CityRenderer {
  readonly root = new THREE.Group();
  readonly cells = new Map<string, Cell>();
  private readonly pieces = new Map<string, THREE.Group>();
  private readonly businesses = new Map<string, BusinessSave>();
  private readonly discoveries = new Set<string>();
  private readonly nightLightRoot = new THREE.Group();
  private readonly nightLights: THREE.PointLight[] = [];
  private readonly signMaterials = new Map<string, THREE.MeshStandardMaterial>();
  private readonly wallMaterials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly roofMaterials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly colorMaterials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly seed: number;
  private discoveryGlow: { mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>; startedAt: number } | null = null;
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
  private readonly blossom = new THREE.MeshStandardMaterial({ color: 0xe9a0a6, roughness: 1 });
  private readonly silverLeaf = new THREE.MeshStandardMaterial({ color: 0x9ab7a1, roughness: .82, emissive: 0x315b51, emissiveIntensity: .12 });
  private readonly saltPatina = new THREE.MeshStandardMaterial({ color: 0xd8d0b3, transparent: true, opacity: .42, roughness: 1, depthWrite: false, side: THREE.DoubleSide });
  private readonly mossPatina = new THREE.MeshStandardMaterial({ color: 0x526c45, transparent: true, opacity: .5, roughness: 1, depthWrite: false, side: THREE.DoubleSide });
  private readonly sootPatina = new THREE.MeshStandardMaterial({ color: 0x443f3b, transparent: true, opacity: .38, roughness: 1, depthWrite: false, side: THREE.DoubleSide });
  private readonly rustPatina = new THREE.MeshStandardMaterial({ color: 0x985a3f, transparent: true, opacity: .46, roughness: 1, depthWrite: false, side: THREE.DoubleSide });

  constructor(seed: number) {
    this.seed = seed;
    this.root.name = 'town';
    this.nightLightRoot.name = 'night-lights';
    this.root.add(this.nightLightRoot);
  }

  static cellSize() { return CELL; }

  load(cells: Cell[], absoluteHours = 0) {
    for (const cell of cells) {
      // Older saves did not remember construction time. Give their buildings a
      // deterministic history so an established town does not reload pristine.
      const inheritedAge = 30 + hash(this.seed, cell.x, cell.z, 6060) * 66;
      this.cells.set(keyOf(cell.x, cell.z), {
        ...cell,
        foundedAt: cell.foundedAt ?? Math.max(0, absoluteHours - inheritedAge),
        renovatedAt: cell.renovatedAt ?? cell.foundedAt ?? Math.max(0, absoluteHours - inheritedAge),
      });
    }
    this.rebuildAll(false);
  }

  setBusinesses(businesses: BusinessSave[]) {
    const previous = new Map(this.businesses);
    this.businesses.clear();
    for (const business of businesses) this.businesses.set(business.cellKey, { ...business });
    const affected = new Set([...previous.keys(), ...this.businesses.keys()]);
    for (const key of affected) {
      const before = previous.get(key);
      const after = this.businesses.get(key);
      if (before?.type === after?.type && before?.name === after?.name) continue;
      const [x, z] = key.split(',').map(Number);
      this.rebuildPiece(x, z);
    }
    this.syncNightLights();
  }

  setDiscoveryState(discoveries: readonly string[]) {
    const next = new Set(discoveries);
    if (next.size === this.discoveries.size && [...next].every((id) => this.discoveries.has(id))) return;
    this.discoveries.clear();
    for (const id of next) this.discoveries.add(id);
    this.rebuildAll(false);
    this.syncNightLights();
  }

  get(x: number, z: number) { return this.cells.get(keyOf(x, z)); }

  worldPosition(x: number, z: number) {
    return new THREE.Vector3(x * CELL, 0, z * CELL);
  }

  cellFromObject(object: THREE.Object3D | null) {
    for (let current = object; current && current !== this.root; current = current.parent) {
      const x = current.userData.cellX;
      const z = current.userData.cellZ;
      if (Number.isInteger(x) && Number.isInteger(z)) return { x, z };
    }
    return null;
  }

  celebrateAt(x: number, z: number) {
    if (this.discoveryGlow) {
      this.root.remove(this.discoveryGlow.mesh);
      this.discoveryGlow.mesh.geometry.dispose();
      this.discoveryGlow.mesh.material.dispose();
    }
    const cell = this.get(x, z);
    const material = new THREE.MeshBasicMaterial({ color: 0xffd477, transparent: true, opacity: .8, depthWrite: false });
    const mesh = new THREE.Mesh(new THREE.TorusGeometry(.62, .035, 8, 40), material);
    mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x * CELL, cell ? .5 + cell.height * FLOOR : .42, z * CELL);
    mesh.renderOrder = 4;
    this.root.add(mesh);
    this.discoveryGlow = { mesh, startedAt: performance.now() };
  }

  isBuildable(x: number, z: number) {
    return Math.hypot(x, z) <= 8.8;
  }

  place(x: number, z: number, absoluteHours = 0) {
    const key = keyOf(x, z);
    const existing = this.cells.get(key);
    if (!existing && !this.isBuildable(x, z)) return false;
    if (existing) {
      if (existing.height >= 5) return false;
      existing.height += 1;
      existing.placedAt = performance.now();
      existing.renovatedAt = absoluteHours;
    } else {
      this.cells.set(key, {
        x, z, height: 1,
        color: Math.floor(hash(this.seed, x, z, 91) * WALL_COLORS.length),
        placedAt: performance.now(),
        foundedAt: absoluteHours,
        renovatedAt: absoluteHours,
      });
    }
    this.rebuildAround(x, z);
    return true;
  }

  remove(x: number, z: number, absoluteHours = 0) {
    const cell = this.get(x, z);
    if (!cell) return false;
    if (cell.height > 1) {
      cell.height -= 1;
      cell.placedAt = performance.now();
      cell.renovatedAt = absoluteHours;
    } else {
      this.cells.delete(keyOf(x, z));
    }
    this.rebuildAround(x, z);
    return true;
  }

  serialize() { return [...this.cells.values()].map((cell) => ({ ...cell, placedAt: 0 })); }

  update(time: number, absoluteHours = 0) {
    if (this.discoveryGlow) {
      const age = (performance.now() - this.discoveryGlow.startedAt) / 1000;
      const scale = 1 + age * 1.35;
      this.discoveryGlow.mesh.scale.setScalar(scale);
      this.discoveryGlow.mesh.position.y += .0025;
      this.discoveryGlow.mesh.material.opacity = Math.max(0, .8 * (1 - age / 2.2));
      if (age >= 2.2) {
        this.root.remove(this.discoveryGlow.mesh);
        this.discoveryGlow.mesh.geometry.dispose();
        this.discoveryGlow.mesh.material.dispose();
        this.discoveryGlow = null;
      }
    }
    for (const [key, group] of this.pieces) {
      const cell = this.cells.get(key);
      const morphStartedAt = group.userData.morphStartedAt as number | undefined;
      if (morphStartedAt !== undefined || (cell && cell.placedAt > 0)) {
        const startedAt = morphStartedAt ?? cell!.placedAt;
        const age = Math.min(1, (performance.now() - startedAt) / 430);
        const eased = 1 - Math.pow(1 - age, 3);
        group.scale.y = .04 + eased * .96;
        if (age >= 1) {
          if (cell) cell.placedAt = 0;
          delete group.userData.morphStartedAt;
        }
      } else {
        group.scale.y = 1;
      }
      const tree = group.userData.tree as THREE.Object3D | undefined;
      if (tree) tree.rotation.z = Math.sin(time * 1.35 + group.position.x) * .025;
      const growingTree = group.userData.growingTree as THREE.Object3D | undefined;
      if (growingTree) {
        const age = Math.max(0, absoluteHours - ((group.userData.treeBornAt as number | undefined) ?? absoluteHours));
        const progress = THREE.MathUtils.smoothstep(age, 0, 72);
        const scale = .24 + progress * .76;
        growingTree.scale.set(scale, .32 + progress * .68, scale);
      }
      const patina = group.userData.patina as THREE.Object3D[] | undefined;
      if (patina?.length) {
        const foundedAt = (group.userData.foundedAt as number | undefined) ?? absoluteHours;
        const renovatedAt = (group.userData.renovatedAt as number | undefined) ?? foundedAt;
        const age = Math.max(0, absoluteHours - foundedAt);
        const sinceRenovation = Math.max(0, absoluteHours - renovatedAt);
        const renovationRecovery = .3 + THREE.MathUtils.clamp(sinceRenovation / 28, 0, 1) * .7;
        for (const stain of patina) {
          const threshold = stain.userData.ageThreshold as number;
          const span = stain.userData.ageSpan as number;
          const strength = THREE.MathUtils.smoothstep(age, threshold, threshold + span) * renovationRecovery;
          stain.visible = strength > .015;
          const width = stain.userData.patinaWidth as number;
          const height = stain.userData.patinaHeight as number;
          stain.scale.set(width * (.25 + strength * .75), height * (.05 + strength * .95), 1);
        }
      }
      const flag = group.userData.flag as THREE.Object3D | undefined;
      if (flag) flag.rotation.y = Math.sin(time * 3 + group.position.z) * .15;
      const laundry = group.userData.laundry as THREE.Object3D[] | undefined;
      if (laundry) for (const cloth of laundry) cloth.rotation.z = Math.sin(time * 2.2 + cloth.id) * .045;
      const smoke = group.getObjectByName('smoke-source');
      smoke?.children.forEach((puff, index) => {
        const phase = (time * .14 + index * .31 + hash(this.seed, group.position.x, group.position.z, index + 730)) % 1;
        puff.position.set(Math.sin(time * .55 + index) * .11 * phase, phase * 1.35, Math.cos(time * .43 + index) * .08 * phase);
        puff.scale.setScalar(.45 + phase * .95);
        if (puff instanceof THREE.Mesh && puff.material instanceof THREE.MeshStandardMaterial) puff.material.opacity = Math.sin(phase * Math.PI) * .3;
      });
    }
  }

  setDaylight(daylight: number) {
    const night = 1 - daylight;
    this.window.emissiveIntensity = .06 + night * 2.15;
    this.warmLight.emissiveIntensity = .4 + night * 3.8;
    for (const light of this.nightLights) light.intensity = Math.max(0, night * 1.8 - .32);
  }

  topologyLabel(x: number, z: number) {
    const cell = this.get(x, z);
    if (!cell) return this.emptyFeature(x, z) ?? 'open water';
    const neighbors = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz));
    const count = neighbors.filter(Boolean).length;
    const court = roofCourtFeature(cell, this.cells);
    const terrace = steppedTerrace(cell, this.cells);
    const arcade = arcadeFeature(cell, this.cells);
    if (court) return court;
    if (terrace) return terrace.feature;
    if (arcade) return arcade;
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
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const px = x + dx;
      const pz = z + dz;
      const key = keyOf(px, pz);
      const old = this.pieces.get(key);
      if (old) {
        this.root.remove(old);
        dispose(old);
        this.pieces.delete(key);
      }
      if (this.get(px, pz) || this.emptyFeature(px, pz)) this.buildAt(px, pz, true);
    }
  }

  private rebuildPiece(x: number, z: number) {
    const key = keyOf(x, z);
    const old = this.pieces.get(key);
    if (old) {
      this.root.remove(old);
      dispose(old);
      this.pieces.delete(key);
    }
    if (this.get(x, z) || this.emptyFeature(x, z)) this.buildAt(x, z, true);
  }

  private buildAt(x: number, z: number, animate = false) {
    const group = new THREE.Group();
    group.position.set(x * CELL, 0, z * CELL);
    group.userData.cellX = x;
    group.userData.cellZ = z;
    if (animate) {
      group.userData.morphStartedAt = performance.now();
      group.scale.y = .04;
    }
    const cell = this.get(x, z);
    if (cell) this.buildCell(group, cell);
    else this.buildFeature(group, x, z);
    this.consolidateStaticMeshes(group);
    this.root.add(group);
    this.pieces.set(keyOf(x, z), group);
  }

  private consolidateStaticMeshes(group: THREE.Group) {
    const buckets = new Map<string, THREE.Mesh[]>();
    for (const child of [...group.children]) {
      if (!(child instanceof THREE.Mesh) || child.name === 'flag' || child.name.startsWith('laundry-') || child.name.startsWith('patina-')) continue;
      if (Array.isArray(child.material)) continue;
      const key = `${child.material.uuid}:${child.castShadow ? 1 : 0}:${child.receiveShadow ? 1 : 0}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(child);
      buckets.set(key, bucket);
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const geometries = meshes.map((mesh) => {
        mesh.updateMatrix();
        const geometry = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
        geometry.applyMatrix4(mesh.matrix);
        return geometry;
      });
      const mergedGeometry = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!mergedGeometry) continue;
      const merged = new THREE.Mesh(mergedGeometry, meshes[0].material);
      merged.castShadow = meshes[0].castShadow;
      merged.receiveShadow = meshes[0].receiveShadow;
      for (const mesh of meshes) {
        group.remove(mesh);
        mesh.geometry.dispose();
      }
      group.add(merged);
    }
  }

  private neighborHeight(cell: Cell, dir: Direction) {
    const [dx, dz] = CARDINALS[dir];
    return this.get(cell.x + dx, cell.z + dz)?.height ?? 0;
  }

  private buildCell(group: THREE.Group, cell: Cell) {
    const neighborHeights = CARDINALS.map((_, i) => this.neighborHeight(cell, i as Direction));
    const diagonalHeights = [[-1, -1], [1, -1], [1, 1], [-1, 1]]
      .map(([dx, dz]) => this.get(cell.x + dx, cell.z + dz)?.height ?? 0);
    const count = neighborHeights.filter((height) => height > 0).length;
    const diagonalCount = diagonalHeights.filter((height) => height > 0).length;
    const wallColor = WALL_COLORS[cell.color % WALL_COLORS.length];
    const walls = this.cachedMaterial(this.wallMaterials, wallColor, .92);
    const roofColor = pick(ROOF_COLORS, hash(this.seed, cell.x, cell.z, 13));
    const roof = this.cachedMaterial(this.roofMaterials, roofColor, .82);
    const courtAnchor = roofCourtAnchor(cell, this.cells);
    const courtFeature = roofCourtFeature(cell, this.cells);
    const terrace = steppedTerrace(cell, this.cells);
    const arcade = arcadeFeature(cell, this.cells);
    group.userData.foundedAt = cell.foundedAt ?? 0;
    group.userData.renovatedAt = cell.renovatedAt ?? cell.foundedAt ?? 0;

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
      if (this.discoveries.has('tower-bell')) this.addTowerBell(group, topY + .18);
      if (this.discoveries.has('birds-nest')) this.addBirdNest(group, topY + 1.18);
      if (this.discoveries.has('clock-tower')) this.addClockFaces(group, topY - .22);
    } else if (!courtAnchor && !terrace && arcade !== 'roof promenade' && count <= 2 && diagonalCount < 3) {
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
      if (count === 4 || (count >= 2 && diagonalCount >= 3)) this.addRoofGarden(group, topY + .2, cell);
      else if (cell.height >= 2 && hash(this.seed, cell.x, cell.z, 146) > .5) this.addWaterTank(group, topY + .18);
    }

    if (courtAnchor && courtFeature && courtAnchor.x === cell.x && courtAnchor.z === cell.z) this.addRoofCourt(group, topY, courtFeature);
    if (terrace) this.addSteppedTerrace(group, terrace.direction, topY, terrace.feature);
    if (arcade) this.addArcadeRow(group, neighborHeights, topY, arcade === 'roof promenade');
    if ((count === 2 && this.isCorner(neighborHeights)) || (cell.height >= 2 && count <= 1)) this.addBalcony(group, cell, topY);
    if (this.discoveries.has('rooftop-gardens') && count === 3 && hash(this.seed, cell.x, cell.z, 1910) > .38) this.addHerbPots(group, topY, cell);
    if (this.discoveries.has('festival-ribbons') && hash(this.seed, cell.x, cell.z, 1920) > .55) this.addFestivalRibbon(group, cell, topY);
    if (this.discoveries.has('lantern-finale') && count > 0 && hash(this.seed, cell.x, cell.z, 1930) > .46) this.addFinaleLanterns(group, cell, topY);
    this.addPatina(group, cell, neighborHeights, count);
    this.addWaterEdges(group, cell, neighborHeights);
    const business = this.businesses.get(keyOf(cell.x, cell.z));
    if (business) this.addBusinessFacade(group, cell, business);
  }

  private addPatina(group: THREE.Group, cell: Cell, neighborHeights: number[], neighborCount: number) {
    const stains: THREE.Object3D[] = [];
    const business = this.businesses.get(keyOf(cell.x, cell.z));
    const workingBuilding = business?.type === 'bakery' || business?.type === 'workshop' || business?.type === 'restaurant';
    for (let dir = 0; dir < 4; dir++) {
      if (neighborHeights[dir] > 0) continue;
      const direction = dir as Direction;
      const [dx, dz] = CARDINALS[direction];
      const lateral = new THREE.Vector3(dz, 0, -dx);
      const [px, pz] = this.edgePosition(direction, CELL * .514);
      const variation = hash(this.seed, cell.x, cell.z, 6200 + dir);

      const addStain = (kind: string, material: THREE.Material, width: number, height: number, y: number, side: number, threshold: number, span: number) => {
        const stain = new THREE.Mesh(new THREE.CircleGeometry(.5, 7), material);
        stain.name = `patina-${kind}`;
        stain.position.set(px + dx * .012 + lateral.x * side, y, pz + dz * .012 + lateral.z * side);
        stain.rotation.y = direction % 2 ? Math.PI / 2 : 0;
        stain.scale.set(width * .25, height * .05, 1);
        stain.renderOrder = 1;
        stain.userData.ageThreshold = threshold;
        stain.userData.ageSpan = span;
        stain.userData.patinaWidth = width;
        stain.userData.patinaHeight = height;
        group.add(stain);
        stains.push(stain);
      };

      // Sea-facing ground floors bloom pale with salt. Sheltered corners green
      // instead, while working buildings slowly smoke-darken above their doors.
      if (neighborCount >= 2 && variation > .24) {
        addStain('moss', this.mossPatina, .55 + variation * .28, .38, .52, (variation - .5) * .9, 22, 54);
      } else if (variation > .12) {
        addStain('salt', this.saltPatina, .72 + variation * .36, .42, .48, (variation - .5) * .58, 14, 42);
      }
      if (workingBuilding && dir === this.doorDirection(cell)) {
        addStain('soot', this.sootPatina, .44, .78, Math.max(1.45, cell.height * FLOOR - .12), -.48, 9, 34);
      } else if (cell.height >= 2 && variation > .73) {
        addStain('rust', this.rustPatina, .22, .82, 1.65, .58, 34, 62);
      }
    }
    group.userData.patina = stains;
  }

  private addFacade(group: THREE.Group, cell: Cell, dir: Direction, level: number, neighborCount: number) {
    const y = .48 + level * FLOOR + FLOOR * .47;
    const windowCount = neighborCount === 0 ? 1 : 2;
    const isDoor = level === 0 && dir === this.doorDirection(cell);
    const lateral = new THREE.Vector3(CARDINALS[dir][1], 0, -CARDINALS[dir][0]);
    const [px, pz] = this.edgePosition(dir, CELL * .507);
    if (isDoor) {
      const door = shadow(new THREE.Mesh(new RoundedBoxGeometry(.46, .82, .08, 3, .07), this.dark), false);
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
      const windowMesh = shadow(new THREE.Mesh(new RoundedBoxGeometry(.39, .48, .055, 2, .035), this.window), false);
      windowMesh.position.set(px + lateral.x * offset, y, pz + lateral.z * offset);
      windowMesh.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(windowMesh);
      const sill = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .09 : .5, .06, dir % 2 ? .5 : .09), this.cream), false);
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
    const awningColor = pick(colors, hash(this.seed, cell.x, cell.z, 690 + dir));
    const awningMaterial = this.cachedMaterial(this.colorMaterials, awningColor, .9);
    for (let i = 0; i < 5; i++) {
      const strip = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .42 : .24, .08, dir % 2 ? .24 : .42), i % 2 ? this.cream : awningMaterial), false);
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
    this.addVerticalSign(group, dir, lateral, px, pz, text, color);
  }

  private signMaterial(text: string, color: number) {
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
      context.font = `bold ${text.length > 1 ? 43 : 66}px serif`;
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(text, 48, 98);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      material = new THREE.MeshStandardMaterial({ map: texture, side: THREE.DoubleSide, roughness: .78, emissive: color, emissiveIntensity: .08 });
      this.signMaterials.set(materialKey, material);
    }
    return material;
  }

  private addVerticalSign(group: THREE.Group, dir: Direction, lateral: THREE.Vector3, px: number, pz: number, text: string, color: number) {
    const material = this.signMaterial(text, color);
    const [dx, dz] = CARDINALS[dir];
    const sign = shadow(new THREE.Mesh(new THREE.PlaneGeometry(.42, .86), material), false);
    sign.position.set(px + dx * .13 + lateral.x * .73, 1.31, pz + dz * .13 + lateral.z * .73);
    sign.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(sign);
    const bracket = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .22 : .03, .03, dir % 2 ? .03 : .22), this.metal), false);
    bracket.position.set(px + dx * .08 + lateral.x * .73, 1.79, pz + dz * .08 + lateral.z * .73);
    group.add(bracket);
  }

  private addBusinessFacade(group: THREE.Group, cell: Cell, business: BusinessSave) {
    const dir = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const [px, pz] = this.edgePosition(dir, CELL * .507);
    const colors: Record<BusinessType, number> = {
      bakery: 0xb84b3e,
      cafe: 0x397c73,
      'flower-shop': 0x668e55,
      workshop: 0xc18438,
      bookstore: 0x59688c,
      fishmonger: 0x3d7185,
      restaurant: 0xa54f3f,
      'tea-house': 0x768653,
      inn: 0x914858,
      pottery: 0xb36f4d,
    };
    const symbols: Record<BusinessType, string> = {
      bakery: 'パン',
      cafe: '茶',
      'flower-shop': '花',
      workshop: '工',
      bookstore: '本',
      fishmonger: '魚',
      restaurant: '食',
      'tea-house': '茶屋',
      inn: '宿',
      pottery: '陶',
    };
    const accent = this.cachedMaterial(this.colorMaterials, colors[business.type], .88);
    accent.side = THREE.DoubleSide;

    // A small noren curtain makes an ordinary residence visibly become a shop.
    for (let i = 0; i < 3; i++) {
      const curtain = new THREE.Mesh(new THREE.PlaneGeometry(.22, .34 + (i % 2) * .06), accent);
      curtain.position.set(px + dx * .075 + lateral.x * (i - 1) * .23, 1.08, pz + dz * .075 + lateral.z * (i - 1) * .23);
      curtain.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(curtain);
    }
    this.addVerticalSign(group, dir, lateral.clone().multiplyScalar(-1), px, pz, symbols[business.type], colors[business.type]);

    if (business.type === 'bakery') this.addBakeryDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'cafe') this.addCafeDetails(group, dx, dz, lateral, accent);
    if (business.type === 'flower-shop') this.addFlowerShopDetails(group, dx, dz, lateral, accent);
    if (business.type === 'workshop') this.addWorkshopDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'bookstore') this.addBookstoreDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'fishmonger') this.addFishmongerDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'restaurant') this.addRestaurantDetails(group, dx, dz, lateral, accent);
    if (business.type === 'tea-house') this.addTeaHouseDetails(group, dx, dz, lateral, accent);
    if (business.type === 'inn') this.addInnDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'pottery') this.addPotteryDetails(group, dx, dz, lateral, accent);
  }

  private orientedBox(width: number, height: number, depth: number, dir: Direction, material: THREE.Material) {
    return new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? depth : width, height, dir % 2 ? width : depth), material);
  }

  private detailPosition(mesh: THREE.Object3D, dx: number, dz: number, lateral: THREE.Vector3, side: number, outward: number, y: number) {
    mesh.position.set(dx * outward + lateral.x * side, y, dz * outward + lateral.z * side);
  }

  private addBakeryDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    const shelf = this.orientedBox(.72, .38, .24, dir, this.wood);
    this.detailPosition(shelf, dx, dz, lateral, .72, 1.38, .32);
    group.add(shelf);
    for (let i = 0; i < 3; i++) {
      const bread = new THREE.Mesh(new THREE.CapsuleGeometry(.055, .13, 2, 6), this.cream);
      this.detailPosition(bread, dx, dz, lateral, .5 + i * .2, 1.43, .57);
      bread.rotation.z = Math.PI / 2;
      bread.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(bread);
    }
    const basket = new THREE.Mesh(new THREE.CylinderGeometry(.16, .13, .18, 8), accent);
    this.detailPosition(basket, dx, dz, lateral, -.68, 1.39, .2);
    group.add(basket);
  }

  private addCafeDetails(group: THREE.Group, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (const side of [-.72, .72]) {
      const table = new THREE.Mesh(new THREE.CylinderGeometry(.22, .25, .08, 10), accent);
      this.detailPosition(table, dx, dz, lateral, side, 1.48, .38);
      group.add(table);
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(.035, .05, .34, 7), this.metal);
      this.detailPosition(stem, dx, dz, lateral, side, 1.48, .19);
      group.add(stem);
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(.045, .04, .08, 8), this.cream);
      this.detailPosition(cup, dx, dz, lateral, side, 1.48, .47);
      group.add(cup);
    }
  }

  private addFlowerShopDetails(group: THREE.Group, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (let index = 0; index < 5; index++) {
      const side = -.72 + index * .35;
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(.09, .12, .18, 7), accent);
      this.detailPosition(pot, dx, dz, lateral, side, 1.42, .16);
      const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(.1 + index % 2 * .025, 1), index % 2 ? this.blossom : this.silverLeaf);
      this.detailPosition(flower, dx, dz, lateral, side, 1.42, .38 + index % 2 * .06);
      group.add(pot, flower);
    }
  }

  private addBookstoreDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    const shelf = this.orientedBox(1.1, .62, .18, dir, this.wood);
    this.detailPosition(shelf, dx, dz, lateral, .48, 1.36, .38);
    group.add(shelf);
    for (let index = 0; index < 6; index++) {
      const book = this.orientedBox(.1, .25 + index % 3 * .035, .08, dir, index % 2 ? accent : this.cream);
      this.detailPosition(book, dx, dz, lateral, .1 + index * .15, 1.47, .45);
      group.add(book);
    }
  }

  private addWorkshopDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (let i = 0; i < 2; i++) {
      const crate = this.orientedBox(.34 + i * .08, .32, .31, dir, i ? accent : this.wood);
      this.detailPosition(crate, dx, dz, lateral, .62, 1.38, .18 + i * .3);
      group.add(crate);
    }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(.21, .045, 6, 12), this.metal);
    this.detailPosition(wheel, dx, dz, lateral, -.66, 1.3, .62);
    wheel.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(wheel);
  }

  private addFishmongerDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    const counter = this.orientedBox(.92, .34, .3, dir, accent);
    this.detailPosition(counter, dx, dz, lateral, .56, 1.4, .25);
    group.add(counter);
    for (let i = 0; i < 2; i++) {
      const fish = new THREE.Mesh(new THREE.SphereGeometry(.11, 8, 6), this.metal);
      fish.scale.set(1.7, .55, .55);
      this.detailPosition(fish, dx, dz, lateral, .35 + i * .35, 1.43, .48);
      fish.rotation.y = dir % 2 ? 0 : Math.PI / 2;
      group.add(fish);
    }
    const tub = new THREE.Mesh(new THREE.CylinderGeometry(.18, .2, .22, 9), this.stone);
    this.detailPosition(tub, dx, dz, lateral, -.7, 1.38, .18);
    group.add(tub);
  }

  private addInnDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (const side of [-.58, .58]) {
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(.12, 10, 8), this.warmLight);
      lantern.scale.y = 1.35;
      this.detailPosition(lantern, dx, dz, lateral, side, 1.34, 1.16);
      group.add(lantern);
      const tassel = new THREE.Mesh(new THREE.CylinderGeometry(.018, .025, .18, 6), accent);
      this.detailPosition(tassel, dx, dz, lateral, side, 1.34, .98);
      group.add(tassel);
    }
    const bench = this.orientedBox(.82, .13, .26, dir, this.wood);
    this.detailPosition(bench, dx, dz, lateral, .65, 1.4, .25);
    group.add(bench);
  }

  private addRestaurantDetails(group: THREE.Group, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (const side of [-.62, .62]) {
      const table = new THREE.Mesh(new THREE.CylinderGeometry(.24, .27, .1, 10), this.wood);
      this.detailPosition(table, dx, dz, lateral, side, 1.48, .36);
      const bowl = new THREE.Mesh(new THREE.TorusGeometry(.075, .025, 5, 10), accent);
      this.detailPosition(bowl, dx, dz, lateral, side, 1.48, .46);
      bowl.rotation.x = Math.PI / 2;
      group.add(table, bowl);
    }
  }

  private addTeaHouseDetails(group: THREE.Group, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    const table = new THREE.Mesh(new THREE.CylinderGeometry(.34, .38, .12, 12), this.wood);
    this.detailPosition(table, dx, dz, lateral, .48, 1.48, .28);
    const kettle = new THREE.Mesh(new THREE.SphereGeometry(.13, 9, 7), accent);
    kettle.scale.y = .78;
    this.detailPosition(kettle, dx, dz, lateral, .48, 1.48, .43);
    group.add(table, kettle);
    for (const side of [-.68, -.42, -.16]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(.045, .04, .07, 8), this.cream);
      this.detailPosition(cup, dx, dz, lateral, side, 1.42, .12);
      group.add(cup);
    }
  }

  private addPotteryDetails(group: THREE.Group, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (let index = 0; index < 4; index++) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(.08 + index * .018, .13 + index * .012, .2 + index * .05, 9), index % 2 ? accent : this.cream);
      this.detailPosition(pot, dx, dz, lateral, -.65 + index * .37, 1.4, .14 + index * .03);
      group.add(pot);
    }
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .07, 12), this.wood);
    this.detailPosition(wheel, dx, dz, lateral, .64, 1.46, .18);
    group.add(wheel);
  }

  private addAirConditioner(group: THREE.Group, dir: Direction, lateral: THREE.Vector3, px: number, pz: number, y: number) {
    const [dx, dz] = CARDINALS[dir];
    const unit = shadow(new THREE.Mesh(new RoundedBoxGeometry(dir % 2 ? .18 : .5, .32, dir % 2 ? .5 : .18, 2, .03), this.cream), false);
    unit.position.set(px + dx * .12 + lateral.x * .52, y, pz + dz * .12 + lateral.z * .52);
    group.add(unit);
    const fan = new THREE.Mesh(new THREE.TorusGeometry(.09, .018, 5, 10), this.metal);
    fan.position.set(unit.position.x + dx * .1, y, unit.position.z + dz * .1);
    fan.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(fan);
  }

  private addPipe(group: THREE.Group, dir: Direction, lateral: THREE.Vector3, px: number, pz: number) {
    const [dx, dz] = CARDINALS[dir];
    const pipe = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, 1.18, 6), this.metal), false);
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

  private cachedMaterial(cache: Map<number, THREE.MeshStandardMaterial>, color: number, roughness: number) {
    let material = cache.get(color);
    if (!material) {
      material = new THREE.MeshStandardMaterial({ color, roughness });
      cache.set(color, material);
    }
    return material;
  }

  private addWaterEdges(group: THREE.Group, cell: Cell, heights: number[]) {
    heights.forEach((height, index) => {
      if (height > 0) return;
      const dir = index as Direction;
      const [dx, dz] = CARDINALS[dir];
      const adjacentFeature = this.emptyFeature(cell.x + dx, cell.z + dz);
      if (adjacentFeature?.includes('courtyard') || adjacentFeature === 'cloister garden' || adjacentFeature === 'harbor plaza') return;
      const [px, pz] = this.edgePosition(dir, CELL * .51);
      const quay = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .24 : CELL * .98, .68, dir % 2 ? CELL * .98 : .24), this.stoneDark));
      quay.position.set(px, -.17, pz);
      group.add(quay);
      if (hasDock(cell, dir, this.seed)) {
        const dock = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? 1.1 : .82, .12, dir % 2 ? .82 : 1.1), this.wood));
        dock.position.set(dx * (CELL * .78), -.03, dz * (CELL * .78));
        group.add(dock);
        for (const side of [-1, 1]) {
          const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.055, .07, .55, 7), this.wood), false);
          post.position.set(dock.position.x + (dir % 2 === 0 ? side * .28 : 0), .06, dock.position.z + (dir % 2 ? side * .28 : 0));
          group.add(post);
        }
      } else if (hasWaterStairs(cell, dir, this.seed)) {
        for (let step = 0; step < 3; step++) {
          const stair = shadow(new THREE.Mesh(
            new THREE.BoxGeometry(dir % 2 ? .62 : .32, .1, dir % 2 ? .32 : .62),
            this.stone,
          ));
          stair.position.set(dx * (CELL * .59 + step * .25), -.02 - step * .09, dz * (CELL * .59 + step * .25));
          group.add(stair);
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
    const rail = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .06 : 1.26, .28, dir % 2 ? 1.26 : .06), this.metal), false);
    rail.position.set(dx * 1.47, topY - .52, dz * 1.47);
    group.add(rail);
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const line = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.04, 5), this.dark), false);
    line.position.set(dx * 1.53, topY - .32, dz * 1.53);
    line.rotation.z = Math.PI / 2;
    line.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(line);
    const laundryColors = [0xe9cf9d, 0xb7514a, 0x547f86];
    for (let i = 0; i < 3; i++) {
      const clothMaterial = this.cachedMaterial(this.colorMaterials, laundryColors[i], 1);
      clothMaterial.side = THREE.DoubleSide;
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.27, .31 + i * .03), clothMaterial);
      cloth.position.set(dx * 1.55 + lateral.x * (i - 1) * .34, topY - .5, dz * 1.55 + lateral.z * (i - 1) * .34);
      cloth.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      cloth.name = `laundry-${i}`;
      group.add(cloth);
      (group.userData.laundry ??= []).push(cloth);
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

  private addRoofCourt(group: THREE.Group, y: number, feature: RoofCourtFeature) {
    const center = CELL / 2;
    const postHeight = .9;
    for (const x of [center - .7, center + .7]) for (const z of [center - .7, center + .7]) {
      const post = shadow(new THREE.Mesh(new THREE.BoxGeometry(.075, postHeight, .075), this.wood), false);
      post.position.set(x, y + postHeight / 2 + .18, z);
      group.add(post);
    }
    if (feature === 'rooftop court') {
      for (let index = -3; index <= 3; index++) {
        const slat = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.72, .07, .1), this.wood), false);
        slat.position.set(center, y + 1.1, center + index * .23);
        group.add(slat);
      }
    } else {
      const pavilionRoof = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.28, .55, 4), this.cream));
      pavilionRoof.position.set(center, y + 1.35, center);
      pavilionRoof.rotation.y = Math.PI / 4;
      group.add(pavilionRoof);
      for (const side of [-.6, .6]) {
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), this.warmLight);
        lantern.scale.y = 1.3;
        lantern.position.set(center + side, y + .92, center + .62);
        group.add(lantern);
      }
    }
    const planter = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.35, .42, .25, 10), this.stone));
    planter.position.set(center, y + .27, center);
    const shrub = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(.37, 1), this.green), false);
    shrub.position.set(center, y + .65, center);
    group.add(planter, shrub);
    if (feature === 'hanging roof garden') {
      for (let index = 0; index < 8; index++) {
        const angle = index / 8 * Math.PI * 2;
        const vine = new THREE.Mesh(new THREE.SphereGeometry(.14 + index % 2 * .04, 7, 5), index % 3 ? this.green : this.blossom);
        vine.position.set(center + Math.cos(angle) * .88, y + .72 + index % 2 * .22, center + Math.sin(angle) * .88);
        group.add(vine);
      }
    }
  }

  private addSteppedTerrace(group: THREE.Group, dir: Direction, y: number, feature: TerraceFeature) {
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    for (let index = 0; index < 6; index++) {
      const step = this.orientedBox(.82, .12, .34, dir, this.stone);
      const outward = .48 + index * .25;
      step.position.set(dx * outward, y - index * .21, dz * outward);
      group.add(step);
    }
    for (const side of [-.58, .58]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(.1, .14, .2, 7), this.wood);
      pot.position.set(dx * .45 + lateral.x * side, y + .27, dz * .45 + lateral.z * side);
      const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(.14, 0), this.green);
      plant.position.set(pot.position.x, y + .46, pot.position.z);
      group.add(pot, plant);
    }
    if (feature !== 'stepped terrace') {
      for (let index = 1; index < 6; index += 2) {
        const outward = .48 + index * .25;
        const planter = new THREE.Mesh(new THREE.CylinderGeometry(.08, .11, .16, 7), this.wood);
        planter.position.set(dx * outward + lateral.x * .34, y - index * .21 + .14, dz * outward + lateral.z * .34);
        const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(.12, 0), index % 4 ? this.green : this.blossom);
        flower.position.copy(planter.position).setY(planter.position.y + .17);
        group.add(planter, flower);
      }
    }
    if (feature === 'lantern stair') {
      for (const side of [-.5, .5]) {
        const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .72, 6), this.metal), false);
        pole.position.set(dx * .72 + lateral.x * side, y + .42, dz * .72 + lateral.z * side);
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(.1, 8, 6), this.warmLight);
        lantern.scale.y = 1.35;
        lantern.position.copy(pole.position).setY(y + .78);
        group.add(pole, lantern);
      }
    }
  }

  private addArcadeRow(group: THREE.Group, heights: number[], y: number, promenade: boolean) {
    const rowRunsNorthSouth = heights[0] >= 2 && heights[2] >= 2;
    const facades: Direction[] = rowRunsNorthSouth ? [1, 3] : [0, 2];
    for (const dir of facades) {
      if (heights[dir] > 0) continue;
      const [dx, dz] = CARDINALS[dir];
      const lateral = new THREE.Vector3(dz, 0, -dx);
      const [px, pz] = this.edgePosition(dir, CELL * .55);
      for (const side of [-.64, .64]) {
        const column = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.075, .095, 1.25, 8), this.cream));
        column.position.set(px + lateral.x * side, .96, pz + lateral.z * side);
        group.add(column);
      }
      const arch = shadow(new THREE.Mesh(new THREE.TorusGeometry(.64, .075, 6, 16, Math.PI), this.cream), false);
      arch.position.set(px + dx * .025, 1.25, pz + dz * .025);
      arch.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(arch);
      const canopy = this.orientedBox(1.55, .09, .42, dir, this.wood);
      canopy.position.set(px + dx * .22, 1.5, pz + dz * .22);
      group.add(canopy);
      if (promenade) {
        const rail = this.orientedBox(1.48, .3, .07, dir, this.metal);
        rail.position.set(dx * CELL * .42, y + .3, dz * CELL * .42);
        group.add(rail);
        for (const side of [-.55, .55]) {
          const lantern = new THREE.Mesh(new THREE.SphereGeometry(.085, 8, 6), this.warmLight);
          lantern.scale.y = 1.25;
          lantern.position.set(dx * CELL * .39 + lateral.x * side, y + .5, dz * CELL * .39 + lateral.z * side);
          group.add(lantern);
        }
      }
    }
  }

  private addChimney(group: THREE.Group, y: number, x: number, z: number) {
    const chimney = shadow(new THREE.Mesh(new RoundedBoxGeometry(.32, .68, .32, 2, .035), this.dark));
    chimney.position.set(x, y + .28, z);
    group.add(chimney);
    const smoke = new THREE.Group();
    smoke.name = 'smoke-source';
    smoke.position.set(x, y + .78, z);
    for (let index = 0; index < 3; index++) {
      const material = new THREE.MeshStandardMaterial({ color: 0xd8d1c4, transparent: true, opacity: 0, roughness: 1, depthWrite: false });
      const puff = new THREE.Mesh(new THREE.SphereGeometry(.12 + index * .025, 7, 5), material);
      puff.castShadow = false;
      smoke.add(puff);
    }
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
    group.userData.flag = flag;
  }

  private addTowerBell(group: THREE.Group, y: number) {
    const frame = shadow(new THREE.Mesh(new THREE.BoxGeometry(.72, .06, .08), this.wood));
    frame.position.set(0, y + .82, .76);
    const bell = shadow(new THREE.Mesh(new THREE.ConeGeometry(.18, .3, 10, 1, true), this.warmLight), false);
    bell.position.set(0, y + .62, .76);
    bell.rotation.x = Math.PI;
    const clapper = shadow(new THREE.Mesh(new THREE.SphereGeometry(.055, 7, 5), this.dark), false);
    clapper.position.set(0, y + .45, .76);
    group.add(frame, bell, clapper);
  }

  private addBirdNest(group: THREE.Group, y: number) {
    const nest = shadow(new THREE.Mesh(new THREE.TorusGeometry(.22, .055, 5, 12), this.wood), false);
    nest.name = 'bird-nest';
    nest.position.set(.42, y, .2);
    nest.rotation.x = Math.PI / 2;
    const egg = shadow(new THREE.Mesh(new THREE.SphereGeometry(.055, 7, 5), this.cream), false);
    egg.scale.y = 1.35;
    egg.position.set(.42, y + .05, .2);
    group.add(nest, egg);
  }

  private addClockFaces(group: THREE.Group, y: number) {
    for (const [x, z, rotationY] of [[0, 1.24, 0], [1.24, 0, Math.PI / 2]] as const) {
      const face = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.34, .34, .055, 20), this.cream), false);
      face.name = 'clock-face';
      face.position.set(x, y, z);
      face.rotation.x = Math.PI / 2;
      face.rotation.z = rotationY;
      const hand = shadow(new THREE.Mesh(new THREE.BoxGeometry(.035, .26, .035), this.dark), false);
      hand.position.set(x + (rotationY ? .03 : 0), y + .04, z + (rotationY ? 0 : .03));
      hand.rotation.z = -.45;
      group.add(face, hand);
    }
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

  private addHerbPots(group: THREE.Group, y: number, cell: Cell) {
    for (let index = 0; index < 3; index++) {
      const angle = hash(this.seed, cell.x, cell.z, 1940 + index) * Math.PI * 2;
      const radius = .25 + index * .17;
      const pot = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.1, .13, .16, 7), this.wood), false);
      pot.position.set(Math.cos(angle) * radius, y + .18, Math.sin(angle) * radius);
      const herb = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(.13, 0), this.green), false);
      herb.position.set(pot.position.x, y + .34, pot.position.z);
      group.add(pot, herb);
    }
  }

  private addFestivalRibbon(group: THREE.Group, cell: Cell, y: number) {
    const dir = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const colors = [0xb94d45, 0xe2b750, 0x4e8580];
    for (let index = 0; index < 5; index++) {
      const material = this.cachedMaterial(this.colorMaterials, colors[index % colors.length], 1);
      const ribbon = new THREE.Mesh(new THREE.ConeGeometry(.11, .3, 3), material);
      const offset = (index - 2) * .38;
      ribbon.position.set(dx * 1.29 + lateral.x * offset, y - .5 + Math.sin(index) * .06, dz * 1.29 + lateral.z * offset);
      ribbon.rotation.z = Math.PI;
      group.add(ribbon);
    }
  }

  private addFinaleLanterns(group: THREE.Group, cell: Cell, y: number) {
    const dir = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    for (const side of [-.62, .62]) {
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(.105, 9, 7), this.warmLight);
      lantern.scale.y = 1.35;
      lantern.position.set(dx * 1.3 + lateral.x * side, y - .45, dz * 1.3 + lateral.z * side);
      group.add(lantern);
    }
  }

  private syncNightLights() {
    this.nightLightRoot.clear();
    this.nightLights.length = 0;
    const lightCells = [...this.businesses.values()].slice(0, 5).map((business) => business.cellKey);
    if (this.discoveries.has('lantern-finale')) {
      for (const cell of this.cells.values()) {
        if (lightCells.length >= 9) break;
        if (hash(this.seed, cell.x, cell.z, 1950) > .72) lightCells.push(keyOf(cell.x, cell.z));
      }
    }
    for (const cellKey of new Set(lightCells)) {
      const [x, z] = cellKey.split(',').map(Number);
      const cell = this.get(x, z);
      if (!cell) continue;
      const light = new THREE.PointLight(0xffaa58, 0, 5.4, 2);
      light.position.set(x * CELL, Math.min(2.4, .9 + cell.height * .65), z * CELL);
      this.nightLightRoot.add(light);
      this.nightLights.push(light);
    }
  }

  private emptyFeature(x: number, z: number): string | null {
    if (plazaAnchorAt(x, z, this.cells)) return 'harbor plaza';
    const courtyard = courtyardFeature(x, z, this.cells);
    if (courtyard) return courtyard;
    return emptyCrossingFeature(x, z, this.cells);
  }

  private buildFeature(group: THREE.Group, x: number, z: number) {
    const feature = this.emptyFeature(x, z);
    if (feature === 'harbor plaza') this.buildPlaza(group, x, z);
    else if (feature?.includes('courtyard') || feature === 'cloister garden') this.buildCourtyard(group, x, z, feature as CourtyardFeature);
    else if (feature === 'narrow canal') this.buildCanal(group, x, z);
    else if (feature) this.buildCrossing(group, x, z, feature as EmptyArchitectureFeature);
  }

  private buildCanal(group: THREE.Group, x: number, z: number) {
    const h = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz)?.height ?? 0);
    const northSouthBanks = h[0] > 0 && h[2] > 0;
    for (const side of [-1, 1]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.055, .07, .48, 7), this.wood), false);
      post.position.set(northSouthBanks ? side * .72 : 0, .02, northSouthBanks ? 0 : side * .72);
      group.add(post);
    }
  }

  private buildPlaza(group: THREE.Group, x: number, z: number) {
    const anchor = plazaAnchorAt(x, z, this.cells);
    if (!anchor) return;
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .96, .18, CELL * .96, 2, .06), this.stone));
    platform.position.y = .08;
    group.add(platform);
    for (const offset of [-.52, .52]) {
      const inlay = shadow(new THREE.Mesh(new THREE.BoxGeometry(CELL * .78, .025, .035), this.stoneDark), false);
      inlay.position.set(0, .185, offset);
      group.add(inlay);
    }
    if (x === anchor.x && z === anchor.z) {
      const basin = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.5, .58, .18, 16), this.stoneDark));
      basin.position.set(CELL / 2, .27, CELL / 2);
      const water = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .025, 16), new THREE.MeshStandardMaterial({ color: 0x69a7a3, roughness: .35 }));
      water.position.set(CELL / 2, .375, CELL / 2);
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, .65, 9), this.stone));
      post.position.set(CELL / 2, .62, CELL / 2);
      group.add(basin, water, post);
    }
  }

  private buildCourtyard(group: THREE.Group, x: number, z: number, feature: CourtyardFeature) {
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .83, .2, CELL * .83, 4, .18), this.stone));
    platform.position.y = .05;
    group.add(platform);
    const patch = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.72, .78, .12, 12), this.green));
    patch.position.y = .18;
    group.add(patch);
    const treeGrowth = new THREE.Group();
    treeGrowth.name = 'growing-courtyard-tree';
    const trunk = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.1, .15, 1.25, 7), this.wood));
    trunk.position.y = .83;
    const canopy = new THREE.Group();
    canopy.name = 'swaying-tree';
    canopy.position.y = 1.28;
    for (let i = 0; i < 5; i++) {
      const crown = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(.48 + (i % 2) * .1, 1), this.discoveries.has('rare-tree') ? this.silverLeaf : this.leaf));
      const angle = i * Math.PI * .4 + hash(this.seed, x, z, 410) * 2;
      crown.position.set(Math.cos(angle) * .34, (i % 2) * .28, Math.sin(angle) * .34);
      canopy.add(crown);
      if (this.discoveries.has('blossom-tide') || this.discoveries.has('rare-tree')) {
        const blooms = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(.19 + (i % 2) * .035, 1), this.blossom), false);
        blooms.position.copy(crown.position).add(new THREE.Vector3(i % 2 ? .18 : -.12, .16, i % 3 ? .1 : -.14));
        canopy.add(blooms);
      }
    }
    treeGrowth.add(trunk, canopy);
    group.add(treeGrowth);
    group.userData.tree = canopy;
    group.userData.growingTree = treeGrowth;
    group.userData.treeBornAt = Math.max(0, ...CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz)?.foundedAt ?? 0));
    for (const side of [-1, 1]) {
      const bench = shadow(new THREE.Mesh(new THREE.BoxGeometry(.68, .12, .22), this.wood));
      bench.position.set(side * .8, .34, .18);
      group.add(bench);
    }
    if (feature !== 'courtyard garden') {
      for (const xOffset of [-.72, .72]) for (const zOffset of [-.72, .72]) {
        const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.045, .06, 1.25, 7), this.wood), false);
        post.position.set(xOffset, .88, zOffset);
        group.add(post);
      }
      for (const offset of [-.76, .76]) {
        const beamX = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.62, .09, .16), this.cream), false);
        beamX.position.set(0, 1.52, offset);
        const beamZ = shadow(new THREE.Mesh(new THREE.BoxGeometry(.16, .09, 1.62), this.cream), false);
        beamZ.position.set(offset, 1.52, 0);
        group.add(beamX, beamZ);
      }
    }
    if (feature === 'courtyard pavilion') {
      const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.18, .52, 4), this.cream));
      roof.position.y = 2.2;
      roof.rotation.y = Math.PI / 4;
      group.add(roof);
      for (const side of [-.58, .58]) {
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(.095, 8, 6), this.warmLight);
        lantern.scale.y = 1.3;
        lantern.position.set(side, 1.72, .64);
        group.add(lantern);
      }
    }
  }

  private buildCrossing(group: THREE.Group, x: number, z: number, feature: EmptyArchitectureFeature) {
    const h = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz)?.height ?? 0);
    const northSouth = h[0] > 0 && h[2] > 0;
    const high = feature !== 'sea arch';
    const covered = feature === 'covered skybridge' || feature === 'lantern gate';
    const grand = feature === 'lantern gate';
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
      const deckY = y + .34;
      const ladderHeight = deckY - .27;
      for (const end of [-1, 1]) {
        for (const side of [-1, 1]) {
          const upright = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, ladderHeight, 6), this.metal), false);
          upright.position.set(
            northSouth ? side * .18 : end * (CELL - (CELL / 2 + .24)),
            .27 + ladderHeight / 2,
            northSouth ? end * (CELL - (CELL / 2 + .24)) : side * .18,
          );
          group.add(upright);
        }
        for (let rung = 0; rung < 8; rung++) {
          const step = shadow(new THREE.Mesh(new THREE.BoxGeometry(northSouth ? .42 : .045, .035, northSouth ? .045 : .42), this.wood), false);
          step.position.set(
            northSouth ? 0 : end * (CELL - (CELL / 2 + .24)),
            .48 + rung * (ladderHeight - .35) / 7,
            northSouth ? end * (CELL - (CELL / 2 + .24)) : 0,
          );
          group.add(step);
        }
      }
      if (covered) {
        for (const end of [-.82, .82]) for (const side of [-.48, .48]) {
          const post = shadow(new THREE.Mesh(new THREE.BoxGeometry(.065, .9, .065), this.wood), false);
          post.position.set(northSouth ? side : end, y + .85, northSouth ? end : side);
          group.add(post);
        }
        const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.05, .52, 4), this.cream));
        roof.position.y = y + 1.48;
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(northSouth ? .72 : 1.32, 1, northSouth ? 1.32 : .72);
        group.add(roof);
        for (const end of [-.72, .72]) {
          const lantern = new THREE.Mesh(new THREE.SphereGeometry(.095, 9, 7), this.warmLight);
          lantern.scale.y = 1.3;
          lantern.position.set(northSouth ? .42 : end, y + .82, northSouth ? end : .42);
          group.add(lantern);
        }
        if (grand) {
          for (const end of [-.72, .72]) {
            const finial = shadow(new THREE.Mesh(new THREE.ConeGeometry(.12, .5, 6), this.metal), false);
            finial.position.set(northSouth ? 0 : end, y + 1.82, northSouth ? end : 0);
            group.add(finial);
          }
        }
      }
    }
  }
}
