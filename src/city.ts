import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CARDINALS, type BusinessSave, type BusinessType, type Cell, type PlaceIdentityId, keyOf } from './types';
import { hash, pick } from './random';
import { ageInHours, describeAge, TREE_MATURE_HOURS, treeGrowthAt } from './memory';
import { facadeDirectionAt, plazaAnchorAt, type CardinalDirection as Direction } from './topology';
import { hasDock, hasWaterStairs } from './water';
import {
  CELL_SIZE, FLOOR_HEIGHT, GROUND_WALK_Y, HIGH_CROSSING_SPAN_Y, HIGH_CROSSING_WALK_Y,
  QUAY_PATH_OFFSET, TERRACE_STEP_COUNT,
  STOREFRONT_APRON_CENTER, STOREFRONT_APRON_DEPTH, STOREFRONT_APRON_TOP_Y,
  TERRACE_STEP_HEIGHT, terraceStepOutward, terraceTreadTopY,
} from './spatial';
import {
  arcadeFeature, courtyardFeature, emptyCrossingFeature, isRoofAccessCell, isWalkableRoof,
  roofAccessDirection, roofCourtAnchor, roofCourtFeature, walkableSteppedTerrace,
  vegetationPlotFeature,
  type CourtyardFeature, type EmptyArchitectureFeature, type RoofCourtFeature, type TerraceFeature,
  type VegetationPlotFeature,
} from './architecture';
import {
  PLACE_IDENTITY_BY_ID,
  placeLandmarkSocket,
  type PlaceIdentityOccurrence,
  type PlaceLandmarkKind,
  type PlaceLandmarkSocket,
} from './place-identities';
import {
  CONFLUENCE_BY_ID,
  confluenceLandmarkSocket,
  type ConfluenceLandmarkKind,
  type ConfluenceLandmarkSocket,
  type ConfluenceOccurrence,
} from './confluences';
import {
  HARBOR_LANTERN_BY_ID,
  harborLanternStates,
  type HarborLanternDefinition,
  type HarborLanternId,
} from './lanterns';

const CELL = CELL_SIZE;
const FLOOR = FLOOR_HEIGHT;
const BASE_Y = 0.05;
const WALL_COLORS = [0xd88966, 0xd9b967, 0xbc6c5c, 0x73a69a, 0x7390a1, 0xb9828d, 0xd8c99f, 0x9f9a7e];
const ROOF_COLORS = [0x733e38, 0xa6533c, 0x315f5b, 0x3f5260, 0x5b4748, 0x354747];

type FacadeLayer = 'opening' | 'composition' | 'equipment';
type FacadeBounds = Readonly<{ sideMin: number; sideMax: number; yMin: number; yMax: number }>;
type FacadeClaim = Readonly<{ direction: Direction; kind: string; layer: FacadeLayer; bounds: FacadeBounds }>;
type HarborLanternWorldAnchor = Readonly<{ id: HarborLanternId; x: number; y: number; z: number }>;

class HarborLanternHitTarget extends THREE.Object3D {
  private readonly hitCenter = new THREE.Vector3();
  private readonly hitPoint = new THREE.Vector3();
  private readonly hitSphere = new THREE.Sphere(this.hitCenter, .42);

  constructor(id: HarborLanternId) {
    super();
    this.name = `earned-lantern-${id}-target`;
    this.userData.harborLanternId = id;
  }

  raycast(raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
    this.hitCenter.setFromMatrixPosition(this.matrixWorld);
    const point = raycaster.ray.intersectSphere(this.hitSphere, this.hitPoint);
    if (!point) return;
    const distance = raycaster.ray.origin.distanceTo(point);
    if (distance < raycaster.near || distance > raycaster.far) return;
    intersects.push({ distance, point: point.clone(), object: this });
  }
}

/**
 * A small 2D occupancy map for each wall. Openings may sit behind an authored
 * composition (a balcony belongs in front of windows), but equipment must fit
 * clear of both and two independent compositions never share the same band.
 */
class FacadeDecorationLayout {
  readonly claims: FacadeClaim[] = [];

  reserve(direction: Direction, kind: string, layer: FacadeLayer, bounds: FacadeBounds) {
    const conflicts = this.claims.some((claim) => {
      if (claim.direction !== direction) return false;
      const horizontalOverlap = bounds.sideMin < claim.bounds.sideMax + .04 && bounds.sideMax > claim.bounds.sideMin - .04;
      const verticalOverlap = bounds.yMin < claim.bounds.yMax + .04 && bounds.yMax > claim.bounds.yMin - .04;
      if (!horizontalOverlap || !verticalOverlap) return false;
      if (layer === 'opening' && claim.layer === 'opening') return false;
      if ((layer === 'opening' && claim.layer === 'composition') || (layer === 'composition' && claim.layer === 'opening')) return false;
      return true;
    });
    if (conflicts) return false;
    this.claims.push(Object.freeze({ direction, kind, layer, bounds: Object.freeze({ ...bounds }) }));
    return true;
  }
}

export type CityMemoryInspection = Readonly<{
  kind: 'building' | 'tree' | 'landmark';
  title: string;
  ageHours: number;
  ageLabel: string;
  detail: string;
  note: string;
}>;

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

function createGlowTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(.28, 'rgba(255,235,174,.72)');
  gradient.addColorStop(1, 'rgba(255,190,92,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createSmokeTexture() {
  const size = 32;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d')!;
  const gradient = context.createRadialGradient(size / 2, size / 2, size * .04, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,.8)');
  gradient.addColorStop(.5, 'rgba(255,255,255,.32)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function createSurfaceTexture(kind: 'plaster' | 'roof' | 'stone') {
  const size = 128;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const index = (y * size + x) * 4;
    const rawGrain = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453;
    const grain = rawGrain - Math.floor(rawGrain);
    const softMottle = (Math.sin(x * .19 + y * .07) + Math.cos(y * .23 - x * .05)) * .5;
    const plaster = 239 + Math.round(softMottle * 4 + grain * 9) - (grain > .975 ? 13 : 0);

    const roofMortar = y % 18 <= 1 || (x + (Math.floor(y / 18) % 2) * 11) % 28 <= 1;
    const roof = roofMortar ? 220 : 241 + Math.round(softMottle * 3 + grain * 9);

    const stoneRow = Math.floor(y / 24);
    const stoneX = (x + (stoneRow % 2) * 16) % 32;
    const stoneMortar = y % 24 <= 1 || stoneX <= 1;
    const stone = stoneMortar ? 211 + Math.round(grain * 5) : 237 + Math.round(softMottle * 4 + grain * 10);
    const value = kind === 'roof' ? roof : kind === 'stone' ? stone : plaster;
    data[index] = data[index + 1] = data[index + 2] = value;
    data[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  const repeat = kind === 'roof' ? 1.8 : kind === 'stone' ? 1.15 : 1.35;
  texture.repeat.set(repeat, repeat);
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function createSignAtlas() {
  const tileWidth = 128;
  const tileHeight = 160;
  const columns = 8;
  const rows = 4;
  const canvas = document.createElement('canvas');
  canvas.width = tileWidth * columns;
  canvas.height = tileHeight * rows;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    side: THREE.DoubleSide,
    roughness: .78,
    emissive: 0x3b2b1e,
    emissiveIntensity: .16,
  });
  return { canvas, texture, material, tileWidth, tileHeight, columns, rows, tiles: new Map<string, number>() };
}

function drawBusinessPictogram(context: CanvasRenderingContext2D, type: BusinessType, x: number, y: number, width: number, height: number) {
  const cx = x + width / 2;
  const cy = y + height / 2 + 3;
  const unit = Math.min(width, height) / 100;
  const line = (points: Array<[number, number]>, close = false) => {
    context.beginPath();
    points.forEach(([px, py], index) => index ? context.lineTo(cx + px * unit, cy + py * unit) : context.moveTo(cx + px * unit, cy + py * unit));
    if (close) context.closePath();
    context.stroke();
  };
  const ellipse = (px: number, py: number, rx: number, ry: number, fill = false) => {
    context.beginPath();
    context.ellipse(cx + px * unit, cy + py * unit, rx * unit, ry * unit, 0, 0, Math.PI * 2);
    fill ? context.fill() : context.stroke();
  };
  context.save();
  context.strokeStyle = '#fff1c7';
  context.fillStyle = '#fff1c7';
  context.lineWidth = 7 * unit;
  context.lineCap = 'round';
  context.lineJoin = 'round';

  if (type === 'bakery') {
    ellipse(0, 2, 31, 20);
    line([[-17, -13], [-11, -2]]); line([[0, -18], [4, -5]]); line([[17, -13], [14, -1]]);
  } else if (type === 'cafe') {
    line([[-28, -19], [-25, 15], [14, 15], [18, -19]], true);
    context.beginPath(); context.arc(cx + 20 * unit, cy - 2 * unit, 14 * unit, -Math.PI / 2, Math.PI / 2); context.stroke();
    line([[-32, 25], [29, 25]]);
  } else if (type === 'flower-shop') {
    for (let index = 0; index < 5; index++) {
      const angle = index / 5 * Math.PI * 2 - Math.PI / 2;
      ellipse(Math.cos(angle) * 21, Math.sin(angle) * 21 - 4, 12, 16, true);
    }
    ellipse(0, -4, 8, 8, true);
    line([[0, 10], [0, 36]]); line([[0, 23], [-16, 17]]); line([[0, 28], [15, 21]]);
  } else if (type === 'workshop') {
    line([[-25, 28], [18, -24]]);
    line([[-34, 19], [-18, 33]]); line([[8, -28], [25, -13], [16, -4]]);
    ellipse(-25, 25, 7, 7);
  } else if (type === 'bookstore') {
    line([[0, -25], [0, 28]]);
    line([[0, -20], [-12, -28], [-34, -25], [-34, 22], [-13, 19], [0, 28]]);
    line([[0, -20], [12, -28], [34, -25], [34, 22], [13, 19], [0, 28]]);
  } else if (type === 'fishmonger') {
    ellipse(-5, 0, 28, 17);
    line([[22, 0], [38, -18], [38, 18], [22, 0]], true);
    ellipse(-18, -4, 2.6, 2.6, true);
  } else if (type === 'restaurant') {
    context.beginPath(); context.arc(cx, cy - 2 * unit, 29 * unit, 0, Math.PI); context.stroke();
    line([[-34, -2], [34, -2]]); line([[-19, 28], [19, 28]]);
    line([[-14, -15], [-18, -34]]); line([[0, -15], [0, -37]]); line([[14, -15], [18, -34]]);
  } else if (type === 'tea-house') {
    ellipse(-4, 5, 23, 19);
    line([[-18, -14], [9, -14], [16, -5]]); line([[18, -3], [36, -11], [27, 5]]);
    context.beginPath(); context.arc(cx - 6 * unit, cy - 9 * unit, 22 * unit, Math.PI, Math.PI * 2); context.stroke();
  } else if (type === 'inn') {
    line([[-34, 24], [-34, -20], [34, -20], [34, 24]]);
    line([[-34, 4], [34, 4]]); line([[-19, -8], [-4, -8]]); line([[-34, 24], [-34, 33]]); line([[34, 24], [34, 33]]);
  } else if (type === 'pottery') {
    line([[-15, -31], [-13, -18], [-26, -5], [-25, 19], [-15, 31], [15, 31], [25, 19], [26, -5], [13, -18], [15, -31]], true);
    line([[-15, -31], [15, -31]]); line([[-19, 14], [19, 14]]);
  } else if (type === 'mill') {
    ellipse(0, 0, 30, 30); ellipse(0, 0, 6, 6, true);
    line([[-22, -22], [22, 22]]); line([[22, -22], [-22, 22]]);
  } else if (type === 'smokehouse') {
    line([[-33, 28], [-33, -6], [0, -28], [33, -6], [33, 28]], true);
    line([[18, -18], [18, -36], [29, -36], [29, -10]]);
    line([[-16, 28], [-16, 7], [16, 7], [16, 28]]);
  } else if (type === 'weaver') {
    line([[-31, -31], [-31, 31], [31, 31], [31, -31]], true);
    for (const offset of [-16, 0, 16]) { line([[offset, -31], [offset, 31]]); line([[-31, offset], [31, offset]]); }
  } else if (type === 'shipyard') {
    line([[-36, 4], [-25, 25], [23, 25], [37, 4]], true);
    line([[0, 4], [0, -33]]); line([[0, -29], [27, -8], [0, -8]], true); line([[-34, 34], [34, 34]]);
  }
  context.restore();
}

export class CityRenderer {
  readonly root = new THREE.Group();
  readonly cells = new Map<string, Cell>();
  private readonly pieces = new Map<string, THREE.Group>();
  private readonly staticBatchRoot = new THREE.Group();
  private readonly businesses = new Map<string, BusinessSave>();
  private readonly facadeLayouts = new WeakMap<THREE.Group, FacadeDecorationLayout>();
  private readonly discoveries = new Set<string>();
  private readonly placeLandmarks = new Map<string, readonly PlaceLandmarkSocket[]>();
  private readonly confluenceLandmarks = new Map<string, ConfluenceLandmarkSocket>();
  private readonly harborLanternRoot = new THREE.Group();
  private harborLanternAnchors: HarborLanternWorldAnchor[] = [];
  private lanternFinaleRevealed = true;
  private readonly nightGlowGeometry = new THREE.BufferGeometry();
  private readonly nightGlowMaterial = new THREE.PointsMaterial({
    color: 0xffb45f,
    map: createGlowTexture(),
    size: 1.65,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  private readonly nightGlows = new THREE.Points(this.nightGlowGeometry, this.nightGlowMaterial);
  private nightGlowCount = 0;
  private readonly smokeGeometry = new THREE.BufferGeometry();
  private readonly smokeMaterial = new THREE.PointsMaterial({
    color: 0xd8d1c4,
    map: createSmokeTexture(),
    size: .34,
    sizeAttenuation: true,
    transparent: true,
    opacity: .34,
    depthWrite: false,
  });
  private readonly smokePoints = new THREE.Points(this.smokeGeometry, this.smokeMaterial);
  private smokeAnchors: Array<{ x: number; y: number; z: number; phase: number; index: number; use: BusinessType | 'home' }> = [];
  private readonly signAtlas = createSignAtlas();
  private readonly wallMaterials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly roofMaterials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly colorMaterials = new Map<number, THREE.MeshStandardMaterial>();
  private readonly plasterTexture = createSurfaceTexture('plaster');
  private readonly roofTexture = createSurfaceTexture('roof');
  private readonly stoneTexture = createSurfaceTexture('stone');
  private readonly wallVertexMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: this.plasterTexture, bumpMap: this.plasterTexture, bumpScale: .028, roughness: .92, roughnessMap: this.plasterTexture });
  private readonly roofVertexMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: this.roofTexture, bumpMap: this.roofTexture, bumpScale: .035, roughness: .82, roughnessMap: this.roofTexture });
  private readonly accentVertexMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: .92, side: THREE.DoubleSide });
  private readonly seed: number;
  private rainIntensity = -1;
  private materialDetail = true;
  private readonly wetTint = new THREE.Color(0x355c5b);
  private discoveryGlow: { mesh: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial>; startedAt: number } | null = null;
  private readonly cream = new THREE.MeshStandardMaterial({ color: 0xe8d7ad, roughness: .94 });
  private readonly stone = new THREE.MeshStandardMaterial({ color: 0xb9ad91, map: this.stoneTexture, bumpMap: this.stoneTexture, bumpScale: .045, roughness: 1, roughnessMap: this.stoneTexture });
  private readonly stoneDark = new THREE.MeshStandardMaterial({ color: 0x786f63, map: this.stoneTexture, bumpMap: this.stoneTexture, bumpScale: .04, roughness: 1, roughnessMap: this.stoneTexture });
  private readonly window = new THREE.MeshStandardMaterial({ color: 0x294b52, roughness: .35, emissive: 0xffa347, emissiveIntensity: .08 });
  private readonly dark = new THREE.MeshStandardMaterial({ color: 0x443633, roughness: .9 });
  private readonly green = new THREE.MeshStandardMaterial({ color: 0x4f855d, roughness: 1 });
  private readonly leaf = new THREE.MeshStandardMaterial({ color: 0x648d51, roughness: 1 });
  private readonly wood = new THREE.MeshStandardMaterial({ color: 0x774b38, roughness: 1 });
  private readonly metal = new THREE.MeshStandardMaterial({ color: 0x3c5657, roughness: .8 });
  private readonly warmLight = new THREE.MeshStandardMaterial({ color: 0xffcf72, emissive: 0xff9d3d, emissiveIntensity: 1.25 });
  private readonly flagMaterial = new THREE.MeshStandardMaterial({ color: 0xf3cc62, side: THREE.DoubleSide, roughness: .9 });
  private readonly featureWaterMaterial = new THREE.MeshStandardMaterial({ color: 0x69a7a3, roughness: .35 });
  private readonly blossom = new THREE.MeshStandardMaterial({ color: 0xe9a0a6, roughness: 1 });
  private readonly silverLeaf = new THREE.MeshStandardMaterial({ color: 0x9ab7a1, roughness: .82, emissive: 0x315b51, emissiveIntensity: .12 });
  private readonly glass = new THREE.MeshStandardMaterial({ color: 0x9bc7bd, transparent: true, opacity: .46, roughness: .24, metalness: .04, side: THREE.DoubleSide });

  constructor(seed: number) {
    this.seed = seed;
    this.root.name = 'town';
    this.staticBatchRoot.name = 'town-static-batches';
    this.nightGlowGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    this.smokeGeometry.setAttribute('position', new THREE.Float32BufferAttribute([], 3));
    this.nightGlows.name = 'night-glows';
    this.nightGlows.renderOrder = 2;
    this.smokePoints.name = 'town-smoke-points';
    this.smokePoints.frustumCulled = false;
    this.harborLanternRoot.name = 'earned-harbor-lanterns';
    this.root.add(this.staticBatchRoot, this.harborLanternRoot, this.nightGlows, this.smokePoints);
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
    this.syncHarborLanterns();
    this.syncNightLights();
  }

  setDiscoveryState(discoveries: readonly string[]) {
    const next = new Set(discoveries);
    if (next.size === this.discoveries.size && [...next].every((id) => this.discoveries.has(id))) return;
    this.discoveries.clear();
    for (const id of next) this.discoveries.add(id);
    this.rebuildAll(false);
    this.syncHarborLanterns();
    this.syncNightLights();
  }

  setPlaceIdentities(identities: readonly PlaceIdentityOccurrence[], animateNew = false) {
    const next = new Map<string, PlaceLandmarkSocket[]>();
    for (const identity of identities) {
      const socket = placeLandmarkSocket(identity);
      const key = keyOf(socket.x, socket.z);
      const sockets = next.get(key) ?? [];
      if (!sockets.some((candidate) => candidate.kind === socket.kind)) sockets.push(socket);
      next.set(key, sockets);
    }
    const influencedCellKeys = (landmarks: ReadonlyMap<string, readonly PlaceLandmarkSocket[]>) => {
      const keys = new Set<string>();
      for (const sockets of landmarks.values()) for (const socket of sockets) {
        const radius = PLACE_IDENTITY_BY_ID.get(socket.identityId)?.influenceRadius ?? 3;
        for (const cell of this.cells.values()) {
          if (Math.abs(cell.x - socket.x) + Math.abs(cell.z - socket.z) <= radius) keys.add(keyOf(cell.x, cell.z));
        }
      }
      return keys;
    };
    const added = new Set<string>();
    for (const [key, sockets] of next) {
      const before = this.placeLandmarks.get(key) ?? [];
      if (sockets.some((socket) => !before.some((candidate) => candidate.kind === socket.kind))) added.add(key);
    }
    const affected = new Set([
      ...this.placeLandmarks.keys(), ...next.keys(),
      ...influencedCellKeys(this.placeLandmarks), ...influencedCellKeys(next),
    ]);
    const unchanged = [...affected].every((key) => {
      const before = this.placeLandmarks.get(key) ?? [];
      const after = next.get(key) ?? [];
      return before.length === after.length && before.every((socket, index) => socket.kind === after[index]?.kind);
    });
    if (unchanged) return;
    this.placeLandmarks.clear();
    for (const [key, sockets] of next) this.placeLandmarks.set(key, Object.freeze([...sockets]));
    this.clearGlobalStaticBatch();
    for (const key of affected) {
      const [x, z] = key.split(',').map(Number);
      const old = this.pieces.get(key);
      if (old) {
        this.root.remove(old);
        dispose(old);
        this.pieces.delete(key);
      }
      if (this.get(x, z) || this.shouldBuildEmptyAt(x, z)) this.buildAt(x, z, animateNew && added.has(key));
    }
    this.rebuildGlobalStaticBatch();
    this.syncHarborLanterns();
    this.syncNightLights();
  }

  setConfluences(confluences: readonly ConfluenceOccurrence[], animateNew = false) {
    const next = new Map<string, ConfluenceLandmarkSocket>();
    for (const confluence of confluences) {
      const socket = confluenceLandmarkSocket(confluence);
      next.set(keyOf(socket.x, socket.z), socket);
    }
    const affected = new Set([...this.confluenceLandmarks.keys(), ...next.keys()]);
    const unchanged = [...affected].every((key) => this.confluenceLandmarks.get(key)?.kind === next.get(key)?.kind);
    if (unchanged) return;
    const added = new Set([...next].filter(([key, socket]) => this.confluenceLandmarks.get(key)?.kind !== socket.kind).map(([key]) => key));
    this.confluenceLandmarks.clear();
    for (const [key, socket] of next) this.confluenceLandmarks.set(key, socket);
    this.clearGlobalStaticBatch();
    for (const key of affected) {
      const [x, z] = key.split(',').map(Number);
      const old = this.pieces.get(key);
      if (old) {
        this.root.remove(old);
        dispose(old);
        this.pieces.delete(key);
      }
      if (this.get(x, z) || this.shouldBuildEmptyAt(x, z)) this.buildAt(x, z, animateNew && added.has(key));
    }
    this.rebuildGlobalStaticBatch();
    this.syncHarborLanterns();
    this.syncNightLights();
  }

  private landmarkAt(x: number, z: number, kind?: PlaceLandmarkKind) {
    const landmarks = this.placeLandmarks.get(keyOf(x, z)) ?? [];
    return kind ? landmarks.find((landmark) => landmark.kind === kind) : landmarks[0];
  }

  private confluenceAt(x: number, z: number, kind?: ConfluenceLandmarkKind) {
    const landmark = this.confluenceLandmarks.get(keyOf(x, z));
    return !kind || landmark?.kind === kind ? landmark : undefined;
  }

  private neighborhoodInfluenceAt(x: number, z: number) {
    let best: { landmark: PlaceLandmarkSocket; distance: number; strength: number } | null = null;
    for (const sockets of this.placeLandmarks.values()) for (const landmark of sockets) {
      const definition = PLACE_IDENTITY_BY_ID.get(landmark.identityId);
      if (!definition) continue;
      const distance = Math.abs(landmark.x - x) + Math.abs(landmark.z - z);
      if (distance > definition.influenceRadius) continue;
      const strength = 1 - distance / (definition.influenceRadius + 1);
      if (!best || strength > best.strength || (strength === best.strength && landmark.identityId < best.landmark.identityId)) {
        best = { landmark, distance, strength };
      }
    }
    return best;
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

  memoryFromObject(object: THREE.Object3D | null): CityMemoryInspection | null {
    for (let current = object; current && current !== this.root; current = current.parent) {
      const id = current.userData.harborLanternId as HarborLanternId | undefined;
      const lantern = id ? HARBOR_LANTERN_BY_ID.get(id) : undefined;
      if (!lantern) continue;
      return {
        kind: 'landmark',
        title: lantern.title,
        ageHours: 0,
        ageLabel: 'One of five harbor lanterns',
        detail: `This light remembers "${lantern.promise}"`,
        note: 'When all five lanterns are lit, they will need a Lantern Square in which to gather.',
      };
    }
    return null;
  }

  harborLanternGatherPoints() {
    return this.harborLanternAnchors.map((lantern) => Object.freeze({
      id: lantern.id,
      x: lantern.x / CELL,
      z: lantern.z / CELL,
    }));
  }

  setLanternFinaleRevealed(revealed: boolean) {
    if (this.lanternFinaleRevealed === revealed) return;
    this.lanternFinaleRevealed = revealed;
    if (!this.discoveries.has('lantern-finale')) return;
    this.rebuildAll(false);
    this.syncHarborLanterns();
    this.syncNightLights();
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
    mesh.userData.nonPrintable = true;
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
    this.syncHarborLanterns();
    this.syncNightLights();
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
    this.syncHarborLanterns();
    this.syncNightLights();
    return true;
  }

  serialize() { return [...this.cells.values()].map((cell) => ({ ...cell, placedAt: 0 })); }

  update(time: number, absoluteHours = 0) {
    let staticBatchChanged = false;
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
          staticBatchChanged = true;
        }
      } else {
        group.scale.y = 1;
      }
      const tree = group.userData.tree as THREE.Object3D | undefined;
      if (tree) tree.rotation.z = Math.sin(time * 1.35 + group.position.x) * .025;
      const growingTree = group.userData.growingTree as THREE.Object3D | undefined;
      if (growingTree) {
        const progress = treeGrowthAt(group.userData.treeBornAt as number | undefined, absoluteHours);
        const scale = .24 + progress * .76;
        growingTree.scale.set(scale, .32 + progress * .68, scale);
        const shadeSeats = group.userData.shadeSeats as THREE.Object3D | undefined;
        if (shadeSeats) shadeSeats.visible = progress > .82;
      }
      const plotBornAt = group.userData.vegetationPlotBornAt as number | undefined;
      if (plotBornAt !== undefined) {
        const plotAge = absoluteHours - plotBornAt;
        const stage = plotAge < 0 ? 0 : plotAge < 24 ? 1 : plotAge < 60 ? 2 : 3;
        if (group.userData.vegetationStage !== stage) {
          group.userData.vegetationStage = stage;
          for (const child of group.children) {
            const requiredStage = child.userData.vegetationStage as number | undefined;
            if (requiredStage !== undefined) child.visible = requiredStage <= stage;
          }
          staticBatchChanged = true;
        }
      }
      const flag = group.userData.flag as THREE.Object3D | undefined;
      if (flag) flag.rotation.y = Math.sin(time * 3 + group.position.z) * .15;
      const timeNest = group.userData.timeNest as THREE.Object3D | undefined;
      if (timeNest) timeNest.visible = ageInHours(group.userData.foundedAt as number | undefined, absoluteHours) >= 72 && this.rainIntensity < .35;
      const laundry = group.userData.laundry as THREE.Object3D[] | undefined;
      if (laundry) for (const cloth of laundry) {
        cloth.visible = this.rainIntensity < .08;
        cloth.rotation.z = Math.sin(time * 2.2 + cloth.id) * .045;
      }
    }
    for (const [index, lantern] of this.harborLanternRoot.children.entries()) {
      const body = lantern.userData.lanternBody as THREE.Object3D | undefined;
      if (body) body.rotation.z = Math.sin(time * 1.35 + index * 1.7) * (.025 + this.rainIntensity * .035);
    }
    const smokePositions = this.smokeGeometry.getAttribute('position') as THREE.BufferAttribute;
    const hour = ((absoluteHours % 24) + 24) % 24;
    let activeSmoke = 0;
    for (let index = 0; index < this.smokeAnchors.length; index++) {
      const anchor = this.smokeAnchors[index];
      const active = this.smokeActiveAt(anchor.use, hour);
      if (!active) {
        smokePositions.setXYZ(index, 0, -100, 0);
        continue;
      }
      activeSmoke += 1;
      const phase = (time * .14 + anchor.phase) % 1;
      smokePositions.setXYZ(
        index,
        anchor.x + Math.sin(time * .55 + anchor.index) * .11 * phase,
        anchor.y + phase * 1.35,
        anchor.z + Math.cos(time * .43 + anchor.index) * .08 * phase,
      );
    }
    this.smokePoints.visible = activeSmoke > 0;
    if (this.smokeAnchors.length) smokePositions.needsUpdate = true;
    if (staticBatchChanged) this.rebuildGlobalStaticBatch();
  }

  setDaylight(daylight: number) {
    const night = 1 - daylight;
    this.window.emissiveIntensity = .06 + night * 2.15;
    this.warmLight.emissiveIntensity = .4 + night * 3.8;
    this.nightGlowMaterial.opacity = Math.max(0, night * .72 - .08);
    this.nightGlows.visible = this.nightGlowCount > 0 && this.nightGlowMaterial.opacity > .01;
  }

  setWeather(rainIntensity: number) {
    const nextRainIntensity = Math.round(THREE.MathUtils.clamp(rainIntensity, 0, 1) * 256) / 256;
    if (nextRainIntensity === this.rainIntensity) return;
    this.rainIntensity = nextRainIntensity;
    this.stone.roughness = 1 - this.rainIntensity * .48;
    this.stoneDark.roughness = 1 - this.rainIntensity * .42;
    this.stone.color.setHex(0xb9ad91).lerp(this.wetTint, this.rainIntensity * .18);
    this.stoneDark.color.setHex(0x786f63).lerp(this.wetTint, this.rainIntensity * .16);
    for (const [color, material] of this.wallMaterials) {
      material.roughness = .92 - this.rainIntensity * .3;
      material.color.setHex(color).lerp(this.wetTint, this.rainIntensity * .14);
    }
    for (const [color, material] of this.roofMaterials) {
      material.roughness = .82 - this.rainIntensity * .34;
      material.color.setHex(color).lerp(this.wetTint, this.rainIntensity * .2);
    }
    this.wallVertexMaterial.roughness = .92 - this.rainIntensity * .3;
    this.wallVertexMaterial.color.setHex(0xffffff).lerp(this.wetTint, this.rainIntensity * .14);
    this.roofVertexMaterial.roughness = .82 - this.rainIntensity * .34;
    this.roofVertexMaterial.color.setHex(0xffffff).lerp(this.wetTint, this.rainIntensity * .2);
  }

  setMaterialDetail(enabled: boolean) {
    if (enabled === this.materialDetail) return;
    this.materialDetail = enabled;
    const update = (material: THREE.MeshStandardMaterial, texture: THREE.Texture | null) => {
      material.bumpMap = enabled ? texture : null;
      material.roughnessMap = enabled ? texture : null;
      material.needsUpdate = true;
    };
    update(this.stone, this.stoneTexture);
    update(this.stoneDark, this.stoneTexture);
    update(this.wallVertexMaterial, this.plasterTexture);
    update(this.roofVertexMaterial, this.roofTexture);
    for (const material of this.wallMaterials.values()) update(material, this.plasterTexture);
    for (const material of this.roofMaterials.values()) update(material, this.roofTexture);
  }

  memoryStats(absoluteHours: number) {
    let oldestBuildingHours = 0;
    for (const cell of this.cells.values()) oldestBuildingHours = Math.max(oldestBuildingHours, ageInHours(cell.foundedAt, absoluteHours));
    let growingTrees = 0;
    let matureTrees = 0;
    let oldestTreeHours = 0;
    for (const group of this.pieces.values()) {
      if (group.userData.growingTree) {
        const treeAge = ageInHours(group.userData.treeBornAt as number | undefined, absoluteHours);
        oldestTreeHours = Math.max(oldestTreeHours, treeAge);
        if (treeAge >= TREE_MATURE_HOURS) matureTrees += 1;
        else growingTrees += 1;
      }
    }
    return { growingTrees, matureTrees, oldestTreeHours, oldestBuildingHours };
  }

  memoryAt(x: number, z: number, absoluteHours: number): CityMemoryInspection | null {
    const cell = this.get(x, z);
    const group = this.pieces.get(keyOf(x, z));
    const confluence = this.confluenceAt(x, z);
    if (confluence) return {
      kind: 'landmark',
      title: confluence.title,
      ageHours: 0,
      ageLabel: 'A threefold landmark',
      detail: confluence.description,
      note: `${confluence.effect} This landmark remains only while all three formations stay close enough to hold ${CONFLUENCE_BY_ID.get(confluence.confluenceId)?.title ?? 'this confluence'} together.`,
    };
    const landmark = this.landmarkAt(x, z);
    if (landmark) return {
      kind: 'landmark',
      title: landmark.title,
      ageHours: 0,
      ageLabel: 'A place-made landmark',
      detail: landmark.description,
      note: `${landmark.effect} This landmark remains only while its two formations stay close enough to hold ${PLACE_IDENTITY_BY_ID.get(landmark.identityId)?.title ?? 'this living place'} together.`,
    };
    if (cell) {
      const ageHours = ageInHours(cell.foundedAt, absoluteHours);
      const business = this.businesses.get(keyOf(x, z));
      const activeIdentity = PLACE_IDENTITY_BY_ID.get(group?.userData.placeInfluence as PlaceIdentityId);
      const foundingIdentity = business?.placeIdentityId ? PLACE_IDENTITY_BY_ID.get(business.placeIdentityId) : undefined;
      const details = activeIdentity && group?.userData.placeInfluenceTrace
        ? `${activeIdentity.title} added these details: ${activeIdentity.trace}`
        : 'Neighboring buildings and water determine its shape.';
      const history = foundingIdentity
        ? `${foundingIdentity.title} helped ${business?.name ?? 'this trade'} open here. The shop keeps that origin in its history.`
        : activeIdentity ? `${activeIdentity.title} currently reaches this building.` : '';
      const construction = cell.renovatedAt && cell.renovatedAt > (cell.foundedAt ?? 0)
        ? `Last reshaped on Day ${Math.max(1, Math.floor(cell.renovatedAt / 24))}.`
        : `Raised on Day ${Math.max(1, Math.floor((cell.foundedAt ?? absoluteHours) / 24))}.`;
      return {
        kind: 'building',
        title: business?.name ?? this.topologyLabel(x, z),
        ageHours,
        ageLabel: describeAge(ageHours),
        detail: details,
        note: [history, construction].filter(Boolean).join(' '),
      };
    }
    if (group?.userData.growingTree) {
      const ageHours = ageInHours(group.userData.treeBornAt as number | undefined, absoluteHours);
      const growth = treeGrowthAt(group.userData.treeBornAt as number | undefined, absoluteHours);
      return {
        kind: 'tree',
        title: growth >= 1 ? 'Courtyard landmark' : growth > .55 ? 'Young shade tree' : 'Courtyard sapling',
        ageHours,
        ageLabel: describeAge(ageHours),
        detail: growth >= 1 ? 'Its canopy now shades the courtyard benches.' : `${Math.round(growth * 100)}% of its mature canopy.`,
        note: `Planted when the surrounding homes first sheltered this ground.`,
      };
    }
    return null;
  }

  matureTreeAnchors(absoluteHours: number) {
    const anchors: THREE.Vector3[] = [];
    for (const group of this.pieces.values()) {
      const architecturalTrees = group.userData.architecturalTrees as Array<{ x: number; y: number; z: number }> | undefined;
      for (const tree of architecturalTrees ?? []) {
        anchors.push(new THREE.Vector3(group.position.x + tree.x, tree.y, group.position.z + tree.z));
      }
      const plotTree = group.userData.vegetationTreeAnchor as { x: number; y: number; z: number } | undefined;
      const plotBornAt = group.userData.vegetationPlotBornAt as number | undefined;
      if (plotTree && plotBornAt !== undefined && absoluteHours - plotBornAt >= 60) {
        anchors.push(new THREE.Vector3(group.position.x + plotTree.x, plotTree.y, group.position.z + plotTree.z));
      }
      if (!group.userData.growingTree) continue;
      if (ageInHours(group.userData.treeBornAt as number | undefined, absoluteHours) < TREE_MATURE_HOURS) continue;
      anchors.push(new THREE.Vector3(group.position.x + .34, 1.24, group.position.z + .12));
    }
    return anchors;
  }

  topologyLabel(x: number, z: number) {
    const confluence = this.confluenceAt(x, z);
    if (confluence) return confluence.title.toLowerCase();
    const landmark = this.landmarkAt(x, z);
    if (landmark) return landmark.title.toLowerCase();
    const cell = this.get(x, z);
    if (!cell) return this.emptyFeature(x, z) ?? 'open water';
    const neighbors = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz));
    const count = neighbors.filter(Boolean).length;
    const court = roofCourtFeature(cell, this.cells);
    const terrace = walkableSteppedTerrace(cell, this.cells);
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
    this.clearGlobalStaticBatch();
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
      if (!this.get(x, z) && this.shouldBuildEmptyAt(x, z)) this.buildAt(x, z);
    }
    this.rebuildGlobalStaticBatch();
  }

  private rebuildAround(x: number, z: number) {
    this.clearGlobalStaticBatch();
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
      // Neighboring pieces must be regenerated because their façades and roofs
      // depend on local topology, but only the edited tile should replay the
      // construction morph. Animating every regenerated neighbor makes stable
      // houses appear to collapse and gain a level at random.
      if (this.get(px, pz) || this.shouldBuildEmptyAt(px, pz)) this.buildAt(px, pz, px === x && pz === z);
    }
    this.rebuildGlobalStaticBatch();
  }

  private rebuildPiece(x: number, z: number) {
    this.clearGlobalStaticBatch();
    const key = keyOf(x, z);
    const old = this.pieces.get(key);
    if (old) {
      this.root.remove(old);
      dispose(old);
      this.pieces.delete(key);
    }
    // Business and wear changes replace the mesh without changing its height.
    // Keep the established building at full scale instead of replaying the
    // construction animation whenever that background state changes.
    if (this.get(x, z) || this.shouldBuildEmptyAt(x, z)) this.buildAt(x, z);
    this.rebuildGlobalStaticBatch();
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
      if (!(child instanceof THREE.Mesh) || child.name === 'flag' || child.name.startsWith('laundry-')) continue;
      if (Array.isArray(child.material)) continue;
      this.applyVertexBatchMaterial(child);
      const vegetationStage = child.userData.vegetationStage as number | undefined;
      const key = `${child.material.uuid}:${child.castShadow ? 1 : 0}:${child.receiveShadow ? 1 : 0}:${vegetationStage ?? '-'}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(child);
      buckets.set(key, bucket);
    }
    for (const meshes of buckets.values()) {
      if (meshes.length < 2) continue;
      const keepIndexed = meshes.every((mesh) => mesh.geometry.index !== null);
      const geometries = meshes.map((mesh) => {
        mesh.updateMatrix();
        const geometry = keepIndexed || !mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.toNonIndexed();
        geometry.applyMatrix4(mesh.matrix);
        return geometry;
      });
      const mergedGeometry = mergeGeometries(geometries, false);
      for (const geometry of geometries) geometry.dispose();
      if (!mergedGeometry) continue;
      const merged = new THREE.Mesh(mergedGeometry, meshes[0].material);
      merged.castShadow = meshes[0].castShadow;
      merged.receiveShadow = meshes[0].receiveShadow;
      merged.visible = meshes[0].visible;
      if (meshes[0].userData.vegetationStage !== undefined) merged.userData.vegetationStage = meshes[0].userData.vegetationStage;
      for (const mesh of meshes) {
        group.remove(mesh);
        mesh.geometry.dispose();
      }
      group.add(merged);
    }
  }

  private applyVertexBatchMaterial(mesh: THREE.Mesh) {
    const source = mesh.material as THREE.Material;
    const target = source.userData.vertexBatchMaterial as THREE.MeshStandardMaterial | undefined;
    const colorValue = source.userData.vertexBatchColor as number | undefined;
    if (!target || colorValue === undefined) return;
    const color = new THREE.Color(colorValue);
    const position = mesh.geometry.getAttribute('position');
    const colors = new Float32Array(position.count * 3);
    for (let index = 0; index < position.count; index++) {
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    }
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    mesh.material = target;
  }

  private isStaticMesh(object: THREE.Object3D): object is THREE.Mesh {
    return object instanceof THREE.Mesh
      && object.name !== 'flag'
      && !object.name.startsWith('laundry-')
      && !Array.isArray(object.material);
  }

  private clearGlobalStaticBatch() {
    for (const piece of this.pieces.values()) {
      for (const child of piece.children) {
        if (child.userData.hiddenByStaticBatch) {
          child.visible = true;
          delete child.userData.hiddenByStaticBatch;
        }
      }
    }
    for (const child of this.staticBatchRoot.children) {
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    this.staticBatchRoot.clear();
  }

  private rebuildGlobalStaticBatch() {
    this.clearGlobalStaticBatch();
    const buckets = new Map<string, Array<{ mesh: THREE.Mesh; matrix: THREE.Matrix4 }>>();
    const combined = new THREE.Matrix4();
    for (const group of this.pieces.values()) {
      const cell = this.cells.get(keyOf(group.userData.cellX as number, group.userData.cellZ as number));
      if (group.userData.morphStartedAt !== undefined || (cell?.placedAt ?? 0) > 0) continue;
      group.updateMatrix();
      for (const child of group.children) {
        if (!this.isStaticMesh(child) || !child.visible) continue;
        child.updateMatrix();
        const material = child.material as THREE.Material;
        const key = `${material.uuid}:${child.castShadow ? 1 : 0}:${child.receiveShadow ? 1 : 0}`;
        const bucket = buckets.get(key) ?? [];
        bucket.push({ mesh: child, matrix: combined.multiplyMatrices(group.matrix, child.matrix).clone() });
        buckets.set(key, bucket);
      }
    }
    for (const entries of buckets.values()) {
      if (entries.length < 2) continue;
      const keepIndexed = entries.every(({ mesh }) => mesh.geometry.index !== null);
      const geometries = entries.map(({ mesh, matrix }) => {
        const geometry = keepIndexed || !mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.toNonIndexed();
        geometry.applyMatrix4(matrix);
        return geometry;
      });
      const geometry = mergeGeometries(geometries, false);
      for (const part of geometries) part.dispose();
      if (!geometry) continue;
      const first = entries[0].mesh;
      const batch = new THREE.Mesh(geometry, first.material as THREE.Material);
      batch.castShadow = first.castShadow;
      batch.receiveShadow = first.receiveShadow;
      batch.matrixAutoUpdate = false;
      this.staticBatchRoot.add(batch);
      for (const { mesh } of entries) {
        mesh.userData.hiddenByStaticBatch = true;
        mesh.visible = false;
      }
    }
    this.syncSmokeSources();
  }

  private syncSmokeSources() {
    this.smokeAnchors = [];
    for (const [key, group] of this.pieces) {
      const smoke = group.getObjectByName('smoke-source');
      if (!smoke) continue;
      const use = this.businesses.get(key)?.type ?? 'home';
      for (let index = 0; index < 3; index++) {
        this.smokeAnchors.push({
          x: group.position.x + smoke.position.x,
          y: smoke.position.y,
          z: group.position.z + smoke.position.z,
          phase: (index * .31 + hash(this.seed, group.position.x, group.position.z, index + 730)) % 1,
          index,
          use,
        });
      }
    }
    this.smokeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(this.smokeAnchors.length * 3, 3));
    this.smokePoints.visible = this.smokeAnchors.length > 0;
  }

  private smokeActiveAt(use: BusinessType | 'home', hour: number) {
    if (use === 'bakery') return hour >= 4.5 && hour < 10.5;
    if (use === 'restaurant') return (hour >= 10.5 && hour < 14) || (hour >= 16.5 && hour < 22);
    if (use === 'pottery' || use === 'workshop' || use === 'smokehouse') return hour >= 8 && hour < 18.5;
    if (use === 'cafe' || use === 'tea-house') return hour >= 7.5 && hour < 20.5;
    return (hour >= 6 && hour < 8.5) || (hour >= 17.5 && hour < 21.5);
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
    const terrace = walkableSteppedTerrace(cell, this.cells);
    const receivesTerrace = CARDINALS.some(([dx, dz], direction) => {
      const higher = this.get(cell.x + dx, cell.z + dz);
      return higher?.height === cell.height + 1
        && walkableSteppedTerrace(higher, this.cells)?.direction === (direction + 2) % 4;
    });
    const arcade = arcadeFeature(cell, this.cells);
    const business = this.businesses.get(keyOf(cell.x, cell.z));
    const businessFrontDirection = business ? this.doorDirection(cell) : undefined;
    const neighborhoodInfluence = this.neighborhoodInfluenceAt(cell.x, cell.z);
    const carriesNeighborhoodTrace = neighborhoodInfluence
      ? hash(this.seed, cell.x, cell.z, 8100) < .2 + neighborhoodInfluence.strength * .68
      : false;
    const canalMarketFrontDirection = this.canalMarketFrontDirection(cell);
    const reservedGroundFacade = businessFrontDirection ?? canalMarketFrontDirection;
    const topY = .38 + FLOOR * cell.height;
    const primaryFacadeDirection = this.doorDirection(cell);
    group.userData.foundedAt = cell.foundedAt ?? 0;
    group.userData.renovatedAt = cell.renovatedAt ?? cell.foundedAt ?? 0;

    // Reserve large authored compositions before adding opportunistic wall
    // equipment. This gives every later generator the same collision map.
    if (reservedGroundFacade !== undefined) {
      this.reserveFacadeDecoration(
        group,
        reservedGroundFacade,
        business ? `business-${business.type}` : 'canal-market',
        'composition',
        { sideMin: -1.12, sideMax: 1.12, yMin: .12, yMax: 1.92 },
      );
    }
    const traceKind = neighborhoodInfluence?.landmark.kind;
    const traceAllowedOnCell = Boolean(traceKind && carriesNeighborhoodTrace)
      && (!(traceKind === 'seed-house' || traceKind === 'guild-kiln' || traceKind === 'lantern-theatre') || !business);
    const facadeTraceBounds = traceKind && traceAllowedOnCell
      ? this.placeFacadeTraceBounds(cell, topY, traceKind)
      : null;
    const facadeTracePlanned = Boolean(traceKind && facadeTraceBounds)
      && this.reserveFacadeDecoration(
        group,
        primaryFacadeDirection,
        `place-${traceKind}`,
        'composition',
        facadeTraceBounds!,
      );
    const clockFaceDirections = new Set<Direction>();
    if (cell.height >= 3 && count <= 1 && this.discoveries.has('clock-tower')) {
      for (let direction = 0; direction < 4; direction++) {
        const dir = direction as Direction;
        if (neighborHeights[dir] === 0) clockFaceDirections.add(dir);
      }
    }
    const plannedArcadeDirections = new Set<Direction>();
    if (arcade) {
      const rowRunsNorthSouth = neighborHeights[0] >= 2 && neighborHeights[2] >= 2;
      const directions: Direction[] = rowRunsNorthSouth ? [1, 3] : [0, 2];
      for (const direction of directions) {
        if (neighborHeights[direction] > 0) continue;
        if (this.reserveFacadeDecoration(group, direction, 'arcade-row', 'composition', {
          sideMin: -.78, sideMax: .78, yMin: .3, yMax: 1.62,
        })) plannedArcadeDirections.add(direction);
      }
    }
    const balconyPlanned = !clockFaceDirections.has(primaryFacadeDirection)
      && ((count === 2 && this.isCorner(neighborHeights)) || (cell.height >= 2 && count <= 1))
      && this.reserveFacadeDecoration(group, primaryFacadeDirection, 'balcony', 'composition', {
        sideMin: -.78, sideMax: .78, yMin: topY - .78, yMax: topY - .24,
      });
    const festivalRibbonsPlanned = this.discoveries.has('festival-ribbons')
      && !clockFaceDirections.has(primaryFacadeDirection)
      && hash(this.seed, cell.x, cell.z, 1920) > .55
      && this.reserveFacadeDecoration(group, primaryFacadeDirection, 'festival-ribbons', 'composition', {
        sideMin: -.9, sideMax: .9, yMin: topY - .7, yMax: topY - .29,
      });
    const finaleLanternsPlanned = count > 0
      && this.discoveries.has('lantern-finale')
      && this.lanternFinaleRevealed
      && !clockFaceDirections.has(primaryFacadeDirection)
      && hash(this.seed, cell.x, cell.z, 1930) > .46
      && this.reserveFacadeDecoration(group, primaryFacadeDirection, 'finale-lanterns', 'composition', {
        sideMin: -.76, sideMax: .76, yMin: topY - .62, yMax: topY - .27,
      });

    const foundation = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .97, .34, CELL * .97, 1, .12), this.stone));
    foundation.position.y = BASE_Y;
    group.add(foundation);

    for (let level = 0; level < cell.height; level++) {
      const body = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * 1.005, FLOOR + .04, CELL * 1.005, 1, .09), walls));
      body.position.y = .34 + FLOOR * level + FLOOR / 2;
      group.add(body);

      for (let dir = 0; dir < 4; dir++) {
        if (neighborHeights[dir] > level) continue;
        // A shop or place landmark owns its complete ground-floor frontage.
        // Leaving the domestic door, lamp, and windows underneath the larger
        // composition makes two unrelated façades read through one another.
        if (level === 0 && dir === reservedGroundFacade) continue;
        // The clock replaces the top-storey opening. Previously the round dial
        // covered the window but left its sill poking out beneath it.
        if (level === cell.height - 1 && clockFaceDirections.has(dir as Direction)) continue;
        this.addFacade(group, cell, dir as Direction, level, count, canalMarketFrontDirection);
      }
    }

    const isolated = count <= 1;
    if (cell.height >= 3 && isolated) {
      const hasArchiveCrown = Boolean(this.confluenceAt(cell.x, cell.z, 'harbor-archive'));
      // The archive is a replacement crown, not another room balanced on top
      // of the lookout's pitched roof. Keeping both roofs was what produced
      // the intersecting, top-heavy silhouette.
      if (!hasArchiveCrown) {
        const towerRoof = shadow(new THREE.Mesh(new THREE.ConeGeometry(CELL * .76, 1.42, 8), roof));
        towerRoof.position.y = topY + .7;
        towerRoof.rotation.y = Math.PI / 8;
        group.add(towerRoof);
        this.addRoofEaves(group, topY, roof, cell);
        this.addChimney(group, topY + .25, -.58, .38);
        group.userData.hasPitchedTowerRoof = true;
        if (!this.landmarkAt(cell.x, cell.z, 'signal-beacon')
          && !this.confluenceAt(cell.x, cell.z, 'observatory-beacon')) this.addFlag(group, topY + 1.55);
        if (this.discoveries.has('tower-bell')) this.addTowerBell(group, topY + .18);
        if (this.discoveries.has('birds-nest')) this.addBirdNest(group, topY + 1.18);
        else if (this.discoveries.has('gulls-return') && CARDINALS.some(([dx, dz]) => this.businesses.get(keyOf(cell.x + dx, cell.z + dz))?.type === 'bakery')) {
          const nest = this.addBirdNest(group, topY + 1.18);
          nest.visible = false;
          group.userData.timeNest = nest;
        }
      } else {
        group.userData.archiveReplacesTowerRoof = true;
      }
      if (clockFaceDirections.size) this.addClockFaces(group, [...clockFaceDirections], topY - .43);
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
        if (terrace?.direction === dir) continue;
        const parapet = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .12 : CELL * .9, .28, dir % 2 ? CELL * .9 : .12), this.cream));
        const [px, pz] = this.edgePosition(dir as Direction, CELL * .42);
        parapet.position.set(px, topY + .22, pz);
        group.add(parapet);
      }
      const signatureRoof = this.landmarkAt(cell.x, cell.z, 'roof-hall')
        || this.landmarkAt(cell.x, cell.z, 'signal-beacon')
        || this.landmarkAt(cell.x, cell.z, 'wind-loom')
        || this.landmarkAt(cell.x, cell.z, 'tide-bell')
        || this.landmarkAt(cell.x, cell.z, 'post-house')
        || this.landmarkAt(cell.x, cell.z, 'star-dial')
        || this.landmarkAt(cell.x, cell.z, 'kite-loft')
        || this.confluenceAt(cell.x, cell.z, 'banner-house');
      if (!signatureRoof && !receivesTerrace && (count === 4 || (count >= 2 && diagonalCount >= 3))) this.addRoofGarden(group, topY + .2, cell);
      else if (!signatureRoof && !receivesTerrace && cell.height >= 2 && hash(this.seed, cell.x, cell.z, 146) > .5) this.addWaterTank(group, topY + .18);
    }

    if (courtAnchor && courtFeature && courtAnchor.x === cell.x && courtAnchor.z === cell.z) {
      if (this.landmarkAt(cell.x, cell.z, 'roof-hall')) this.addRoofHall(group, topY);
      else if (!this.landmarkAt(cell.x, cell.z, 'wind-loom')
        && !this.landmarkAt(cell.x, cell.z, 'star-dial')
        && !this.landmarkAt(cell.x, cell.z, 'kite-loft')
        && !this.confluenceAt(cell.x, cell.z, 'banner-house')) this.addRoofCourt(group, topY, courtFeature);
    }
    if (terrace) this.addSteppedTerrace(group, terrace.direction, topY, terrace.feature);
    if (arcade) this.addArcadeRow(group, neighborHeights, topY, arcade === 'roof promenade', plannedArcadeDirections);
    if (isWalkableRoof(cell, this.cells) && isRoofAccessCell(cell, this.cells, this.seed)) {
      const accessDirection = roofAccessDirection(cell, this.cells, this.seed);
      if (accessDirection !== null) this.addRoofAccess(group, topY, accessDirection);
    }
    if (balconyPlanned) this.addBalcony(group, cell, topY);
    if (!receivesTerrace && this.discoveries.has('rooftop-gardens') && count === 3 && hash(this.seed, cell.x, cell.z, 1910) > .38) this.addHerbPots(group, topY, cell);
    if (festivalRibbonsPlanned) this.addFestivalRibbon(group, cell, topY);
    if (finaleLanternsPlanned) this.addFinaleLanterns(group, cell, topY);
    if (neighborhoodInfluence) {
      const { landmark } = neighborhoodInfluence;
      group.userData.placeInfluence = landmark.identityId;
      if (carriesNeighborhoodTrace) {
        let traceAdded = false;
        // Shop entrances reserve the entire ground-floor façade. Place traces
        // may still use a safe roof, but they no longer stack another market,
        // plaque, planting tray, or lantern composition over the storefront.
        if (canalMarketFrontDirection !== undefined) traceAdded = this.addCanalMarketTrace(group, cell, canalMarketFrontDirection);
        if (landmark.kind === 'seed-house' && (!business || isWalkableRoof(cell, this.cells))
          && (isWalkableRoof(cell, this.cells) || facadeTracePlanned)) traceAdded = this.addSeedHouseTrays(group, cell, topY);
        if (!business && landmark.kind === 'guild-kiln' && facadeTracePlanned) traceAdded = this.addGuildKilnMarks(group, cell);
        if (landmark.kind === 'roof-hall') traceAdded = this.addRoofVillageTrace(group, cell, topY);
        if (landmark.kind === 'signal-beacon') traceAdded = this.addHighHarborTrace(group, cell, topY);
        if (!business && landmark.kind === 'lantern-theatre' && facadeTracePlanned) traceAdded = this.addLanternSquareTrace(group, cell);
        if (['ferry-house', 'tide-cistern', 'reading-loggia', 'wind-loom', 'tide-bell', 'post-house', 'star-dial', 'kite-loft'].includes(landmark.kind)) {
          const wallTrace = this.placeFacadeTraceBounds(cell, topY, landmark.kind) !== null;
          if (!wallTrace || facadeTracePlanned) traceAdded = this.addExtendedPlaceTrace(group, cell, topY, landmark.kind) || traceAdded;
        }
        if (traceAdded) group.userData.placeInfluenceTrace = true;
      }
    }
    if (this.landmarkAt(cell.x, cell.z, 'guild-kiln')) this.addGuildKiln(group, cell);
    if (this.landmarkAt(cell.x, cell.z, 'signal-beacon')) this.addSignalBeacon(group, topY);
    if (this.landmarkAt(cell.x, cell.z, 'wind-loom')) this.addWindLoom(group, topY);
    if (this.landmarkAt(cell.x, cell.z, 'tide-bell')) this.addTideBell(group, topY);
    if (this.landmarkAt(cell.x, cell.z, 'post-house')) this.addPostHouse(group, topY);
    if (this.landmarkAt(cell.x, cell.z, 'star-dial')) this.addStarDial(group, topY);
    if (this.landmarkAt(cell.x, cell.z, 'kite-loft')) this.addKiteLoft(group, topY);
    const confluence = this.confluenceAt(cell.x, cell.z);
    if (confluence?.kind === 'observatory-beacon') this.addObservatoryBeacon(group, topY);
    if (confluence?.kind === 'banner-house') this.addBannerHouse(group, topY);
    if (confluence?.kind === 'harbor-archive') this.addHarborArchive(group, topY);
    // Working ovens should be readable from across town. Their chimneys are
    // guaranteed even when this roof would not normally roll one.
    if ((business?.type === 'bakery' || business?.type === 'smokehouse') && !group.getObjectByName('smoke-source')) {
      if (confluence?.kind === 'harbor-archive') this.addChimney(group, topY + .12, -.98, .62);
      else this.addChimney(group, topY + .2, -.55, .34);
    }
    this.addWaterEdges(group, cell, neighborHeights);
    if (business) this.addBusinessFacade(group, cell, business);
  }

  private addFacade(
    group: THREE.Group,
    cell: Cell,
    dir: Direction,
    level: number,
    neighborCount: number,
    canalMarketFrontDirection?: Direction,
  ) {
    const y = .48 + level * FLOOR + FLOOR * .47;
    const windowCount = neighborCount === 0 ? 1 : 2;
    const isDoor = level === 0 && dir === this.doorDirection(cell);
    const entranceBusiness = isDoor ? this.businesses.get(keyOf(cell.x, cell.z)) : undefined;
    const lateral = new THREE.Vector3(CARDINALS[dir][1], 0, -CARDINALS[dir][0]);
    const [px, pz] = this.edgePosition(dir, CELL * .507);
    if (level === 0) (group.userData.domesticGroundFacadeDirections ??= []).push(dir);
    if (isDoor) {
      this.reserveFacadeDecoration(group, dir, 'door', 'opening', {
        sideMin: -.25, sideMax: .25, yMin: .32, yMax: 1.2,
      });
      this.reserveFacadeDecoration(group, dir, 'door-lamp', 'opening', {
        sideMin: .27, sideMax: .45, yMin: 1.07, yMax: 1.25,
      });
      const door = shadow(new THREE.Mesh(new THREE.BoxGeometry(.46, .82, .08), this.dark), false);
      door.position.set(px, .34 + .43, pz);
      door.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(door);
      const lamp = new THREE.Mesh(new THREE.SphereGeometry(.075, 8, 6), this.warmLight);
      lamp.position.set(px + lateral.x * .36, 1.16, pz + lateral.z * .36);
      group.add(lamp);
      // Business and neighborhood frontages each own the whole entrance band.
      // Ordinary homes retain a modest awning but no shop-like hanging sign.
      if (!entranceBusiness && dir !== canalMarketFrontDirection) {
        this.addAwning(group, cell, dir, lateral, px, pz);
      }
    }
    for (let i = 0; i < windowCount; i++) {
      if (isDoor && i === 0) continue;
      const offset = windowCount === 1 ? 0 : (i - .5) * .72;
      this.reserveFacadeDecoration(group, dir, `window-${level}-${i}`, 'opening', {
        sideMin: offset - .25, sideMax: offset + .25, yMin: y - .32, yMax: y + .25,
      });
      const windowMesh = shadow(new THREE.Mesh(new THREE.BoxGeometry(.39, .48, .055), this.window), false);
      windowMesh.position.set(px + lateral.x * offset, y, pz + lateral.z * offset);
      windowMesh.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(windowMesh);
      const sill = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .09 : .5, .06, dir % 2 ? .5 : .09), this.cream), false);
      sill.position.set(px + lateral.x * offset, y - .29, pz + lateral.z * offset);
      group.add(sill);
    }
    if (level > 0 && hash(this.seed, cell.x, cell.z, 810 + dir * 11 + level) > .77) {
      this.addAirConditioner(group, cell, dir, level, lateral, px, pz, y - .2);
    }
    if (level === 0 && hash(this.seed, cell.x, cell.z, 850 + dir) > .8) this.addPipe(group, cell, dir, lateral, px, pz);
  }

  private addAwning(group: THREE.Group, cell: Cell, dir: Direction, lateral: THREE.Vector3, px: number, pz: number) {
    if (!this.reserveFacadeDecoration(group, dir, 'residential-awning', 'composition', {
      sideMin: -.58, sideMax: .58, yMin: 1.16, yMax: 1.36,
    })) return;
    const [dx, dz] = CARDINALS[dir];
    const colors = [0xb5463e, 0x3f7770, 0xd08b3e];
    const awningColor = pick(colors, hash(this.seed, cell.x, cell.z, 690 + dir));
    const awningMaterial = this.cachedMaterial(this.colorMaterials, awningColor, .9);
    for (let i = 0; i < 5; i++) {
      const strip = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .42 : .24, .08, dir % 2 ? .24 : .42), i % 2 ? this.cream : awningMaterial), false);
      const offset = (i - 2) * .21;
      strip.position.set(px + dx * .21 + lateral.x * offset, 1.25, pz + dz * .21 + lateral.z * offset);
      strip.rotation.set(lateral.z * -.13, 0, lateral.x * .13);
      strip.name = `residential-awning-${i}`;
      group.add(strip);
    }
    (group.userData.residentialAwningDirections ??= []).push(dir);
  }

  private signMaterial(text: string, color: number, pictogram?: BusinessType) {
    const materialKey = pictogram ? `pictogram-${pictogram}-${color}` : `${text}-${color}`;
    let tile = this.signAtlas.tiles.get(materialKey);
    if (tile === undefined) {
      tile = this.signAtlas.tiles.size;
      if (tile >= this.signAtlas.columns * this.signAtlas.rows) tile = 0;
      this.signAtlas.tiles.set(materialKey, tile);
      const column = tile % this.signAtlas.columns;
      const row = Math.floor(tile / this.signAtlas.columns);
      const x = column * this.signAtlas.tileWidth;
      const y = row * this.signAtlas.tileHeight;
      const context = this.signAtlas.canvas.getContext('2d')!;
      context.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      context.fillRect(x, y, this.signAtlas.tileWidth, this.signAtlas.tileHeight);
      context.strokeStyle = '#ead9ad';
      context.lineWidth = 5;
      context.strokeRect(x + 8, y + 8, this.signAtlas.tileWidth - 16, this.signAtlas.tileHeight - 16);
      if (pictogram) {
        drawBusinessPictogram(context, pictogram, x, y, this.signAtlas.tileWidth, this.signAtlas.tileHeight);
      } else {
        context.fillStyle = '#fff1c7';
        context.font = `bold ${text.length > 1 ? 43 : 66}px serif`;
        context.textAlign = 'center';
        context.textBaseline = 'middle';
        context.fillText(text, x + this.signAtlas.tileWidth / 2, y + this.signAtlas.tileHeight / 2 + 2);
      }
      this.signAtlas.texture.needsUpdate = true;
    }
    return { material: this.signAtlas.material, tile };
  }

  private signGeometry(tile: number, width = .42, height = .86) {
    const geometry = new THREE.PlaneGeometry(width, height);
    const uv = geometry.getAttribute('uv') as THREE.BufferAttribute;
    const column = tile % this.signAtlas.columns;
    const row = Math.floor(tile / this.signAtlas.columns);
    const insetU = .5 / this.signAtlas.canvas.width;
    const insetV = .5 / this.signAtlas.canvas.height;
    const u0 = column / this.signAtlas.columns + insetU;
    const u1 = (column + 1) / this.signAtlas.columns - insetU;
    const v0 = 1 - (row + 1) / this.signAtlas.rows + insetV;
    const v1 = 1 - row / this.signAtlas.rows - insetV;
    for (let index = 0; index < uv.count; index++) {
      uv.setXY(index, THREE.MathUtils.lerp(u0, u1, uv.getX(index)), THREE.MathUtils.lerp(v0, v1, uv.getY(index)));
    }
    uv.needsUpdate = true;
    return geometry;
  }

  private addBusinessPoster(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, type: BusinessType, color: number) {
    const { material, tile } = this.signMaterial('', color, type);
    const side = -.56;
    const posterOutward = 1.96;

    // Suspend the poster from the outer edge of the shop rather than pinning
    // it to the wall. Awnings, displays, plants, and drying racks all finish
    // behind this depth, leaving the pictogram a clean line of sight.
    const arm = shadow(this.orientedBox(.055, .055, .7, dir, this.metal), false);
    this.detailPosition(arm, dx, dz, lateral, side, 1.61, 1.67);
    group.add(arm);
    for (const offset of [-.18, .18]) {
      const hanger = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.014, .014, .14, 5), this.metal), false);
      this.detailPosition(hanger, dx, dz, lateral, side + offset, posterOutward, 1.61);
      group.add(hanger);
    }
    const backing = shadow(this.orientedBox(.66, .8, .045, dir, this.dark), false);
    this.detailPosition(backing, dx, dz, lateral, side, posterOutward - .025, 1.23);
    group.add(backing);
    const poster = shadow(new THREE.Mesh(this.signGeometry(tile, .58, .72), material), false);
    this.detailPosition(poster, dx, dz, lateral, side, posterOutward, 1.23);
    poster.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    poster.name = `business-poster-${type}`;
    group.add(poster);
    group.userData.businessPosterOutward = posterOutward;
  }

  private addBusinessFacade(group: THREE.Group, cell: Cell, business: BusinessSave) {
    const dir = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
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
      mill: 0xb99a58,
      smokehouse: 0x8d493d,
      weaver: 0x6575a0,
      shipyard: 0x3d686c,
    };
    const accent = this.cachedMaterial(this.colorMaterials, colors[business.type], .88);
    accent.side = THREE.DoubleSide;

    group.userData.businessFacade = business.type;
    this.addBusinessShopfront(group, business.type, dir, dx, dz, lateral, accent);

    if (business.type === 'bakery') this.addBakeryDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'cafe') this.addCafeDetails(group, dx, dz, lateral, accent);
    if (business.type === 'flower-shop') this.addFlowerShopDetails(group, dx, dz, lateral, accent);
    if (business.type === 'workshop') this.addWorkshopDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'bookstore') this.addBookstoreDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'fishmonger') this.addFishmongerDetails(group, dir, dx, dz, lateral);
    if (business.type === 'restaurant') this.addRestaurantDetails(group, dx, dz, lateral, accent);
    if (business.type === 'tea-house') this.addTeaHouseDetails(group, dx, dz, lateral, accent);
    if (business.type === 'inn') this.addInnDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'pottery') this.addPotteryDetails(group, dx, dz, lateral, accent);
    if (business.type === 'mill') this.addMillDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'smokehouse') this.addSmokehouseDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'weaver') this.addWeaverDetails(group, dir, dx, dz, lateral, accent);
    if (business.type === 'shipyard') this.addShipyardDetails(group, dir, dx, dz, lateral, accent);
    this.addBusinessPoster(group, dir, dx, dz, lateral, business.type, colors[business.type]);
  }

  private orientedBox(width: number, height: number, depth: number, dir: Direction, material: THREE.Material) {
    return new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? depth : width, height, dir % 2 ? width : depth), material);
  }

  private detailPosition(mesh: THREE.Object3D, dx: number, dz: number, lateral: THREE.Vector3, side: number, outward: number, y: number) {
    mesh.position.set(dx * outward + lateral.x * side, y, dz * outward + lateral.z * side);
  }

  private addBusinessShopfront(
    group: THREE.Group,
    type: BusinessType,
    dir: Direction,
    dx: number,
    dz: number,
    lateral: THREE.Vector3,
    accent: THREE.Material,
  ) {
    const addBox = (width: number, height: number, depth: number, material: THREE.Material, side: number, outward: number, y: number) => {
      const mesh = shadow(this.orientedBox(width, height, depth, dir, material), false);
      this.detailPosition(mesh, dx, dz, lateral, side, outward, y);
      group.add(mesh);
      return mesh;
    };
    const addPanel = (width: number, height: number, material: THREE.Material, side: number, outward: number, y: number) => {
      const panel = shadow(new THREE.Mesh(new THREE.PlaneGeometry(width, height), material), false);
      this.detailPosition(panel, dx, dz, lateral, side, outward, y);
      panel.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(panel);
      return panel;
    };
    const addPostPair = (material: THREE.Material, spacing = .78, height = 1.18, outward = 1.29) => {
      for (const side of [-spacing, spacing]) addBox(.09, height, .11, material, side, outward, .38 + height / 2);
    };
    const addFlatCanopy = (material: THREE.Material, width = 1.76, depth = .6, y = 1.42) => {
      const canopy = addBox(width, .13, depth, material, 0, 1.39, y);
      canopy.rotation.set(lateral.z * -.1, 0, lateral.x * .1);
      return canopy;
    };
    const addGable = (material: THREE.Material, width = 1.72, depth = .62, y = 1.53) => {
      const radius = width * .5;
      const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(radius, .46, 4), material), false);
      this.detailPosition(roof, dx, dz, lateral, 0, 1.34, y);
      roof.rotation.y = Math.PI / 4;
      const depthScale = depth / (radius * 2);
      roof.scale.set(dir % 2 ? depthScale : 1, 1, dir % 2 ? 1 : depthScale);
      group.add(roof);
    };
    const addCurtains = (materials: THREE.Material[], count: number, width = 1.5, top = 1.43, height = .48) => {
      for (let index = 0; index < count; index++) {
        const panelWidth = width / count - .025;
        const curtain = addPanel(panelWidth, height + index % 2 * .05, materials[index % materials.length],
          -width / 2 + panelWidth / 2 + index * width / count, 1.255, top - height / 2);
        curtain.name = `shop-curtain-${type}-${index}`;
      }
    };

    const apron = addBox(2.12, .12, STOREFRONT_APRON_DEPTH, this.stone, 0, STOREFRONT_APRON_CENTER, STOREFRONT_APRON_TOP_Y - .06);
    apron.name = `business-apron-${type}`;
    group.userData.businessApronDirection = dir;

    switch (type) {
      case 'bakery': {
        // A low striped bread awning with a warm open display.
        for (let index = 0; index < 7; index++) {
          const strip = addBox(.235, .105, .62, index % 2 ? this.cream : accent, (index - 3) * .235, 1.4, 1.42);
          strip.rotation.set(lateral.z * -.12, 0, lateral.x * .12);
        }
        addBox(1.5, .12, .12, this.wood, 0, 1.27, 1.1);
        break;
      }
      case 'cafe': {
        // A deep, flat pavement canopy creates a social outdoor room.
        addFlatCanopy(accent, 1.62, .76, 1.5);
        for (const side of [-.52, 0, .52]) {
          const scallop = new THREE.Mesh(new THREE.SphereGeometry(.1, 8, 5), accent);
          scallop.scale.set(1.65, .5, .55);
          this.detailPosition(scallop, dx, dz, lateral, side, 1.7, 1.39);
          group.add(scallop);
        }
        break;
      }
      case 'flower-shop': {
        // A leafy timber pergola makes the whole frontage read as a garden.
        addPostPair(this.wood, .9, 1.22, 1.32);
        addBox(1.95, .1, .12, this.wood, 0, 1.33, 1.52);
        for (const side of [-.66, -.33, 0, .33, .66]) {
          addBox(.075, .08, .55, this.wood, side, 1.42, 1.56);
          const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(.15, 1), Math.abs(side) < .2 ? this.blossom : this.leaf);
          this.detailPosition(leaves, dx, dz, lateral, side, 1.5, 1.64 + Math.abs(side) * .08);
          group.add(leaves);
        }
        break;
      }
      case 'workshop': {
        // A dark open work bay framed by oversized structural timbers.
        addPanel(1.62, 1.08, this.dark, 0, 1.225, .83);
        addPostPair(this.wood, .9, 1.34, 1.275);
        addBox(1.98, .17, .17, this.wood, 0, 1.28, 1.54);
        break;
      }
      case 'bookstore': {
        // A broad blue-framed display window replaces the domestic opening.
        addPanel(1.62, .92, this.window, 0, 1.228, .87);
        addBox(1.78, .13, .11, accent, 0, 1.27, 1.38);
        addBox(1.78, .13, .11, accent, 0, 1.27, .36);
        for (const side of [-.82, .82]) addBox(.1, 1.12, .11, accent, side, 1.27, .87);
        break;
      }
      case 'fishmonger': {
        // A generous blue market tarp and pale wet counter face the quay.
        const canopy = addFlatCanopy(accent, 1.84, .84, 1.48);
        canopy.rotation.set(lateral.z * -.18, 0, lateral.x * .18);
        addBox(1.62, .48, .4, this.cream, 0, 1.47, .46);
        addBox(1.68, .09, .46, this.metal, 0, 1.49, .73);
        break;
      }
      case 'restaurant': {
        // A red portal and paired lanterns frame the evening entrance.
        addPostPair(accent, .88, 1.42, 1.3);
        addBox(1.94, .18, .15, accent, 0, 1.3, 1.58);
        for (const side of [-.55, .55]) {
          const lantern = new THREE.Mesh(new THREE.SphereGeometry(.13, 10, 7), this.warmLight);
          lantern.scale.y = 1.45;
          this.detailPosition(lantern, dx, dz, lateral, side, 1.39, 1.3);
          group.add(lantern);
        }
        break;
      }
      case 'tea-house': {
        // A compact green roof and lattice screens signal a quiet interior.
        addGable(accent, 1.62, .58, 1.54);
        for (const side of [-.67, .67]) {
          addPanel(.42, .82, this.cream, side, 1.235, .78);
          for (const offset of [-.13, 0, .13]) addBox(.025, .82, .035, this.wood, side + offset, 1.255, .78);
          for (const y of [.55, .78, 1.01]) addBox(.42, .025, .035, this.wood, side, 1.255, y);
        }
        break;
      }
      case 'inn': {
        // A tall sheltered porch gives the inn a hotel-like threshold.
        addGable(accent, 1.9, .82, 1.65);
        addPostPair(accent, .78, 1.5, 1.48);
        addBox(1.72, .12, .12, this.wood, 0, 1.35, 1.5);
        break;
      }
      case 'pottery': {
        // Terracotta piers and a round kiln mouth make an arched craft stall.
        addPostPair(accent, .88, 1.2, 1.28);
        addBox(1.92, .2, .15, accent, 0, 1.28, 1.45);
        const kilnMouth = shadow(new THREE.Mesh(new THREE.CircleGeometry(.38, 16), this.dark), false);
        this.detailPosition(kilnMouth, dx, dz, lateral, .34, 1.305, .79);
        kilnMouth.rotation.y = dir % 2 ? Math.PI / 2 : 0;
        group.add(kilnMouth);
        break;
      }
      case 'mill': {
        // A pale canvas hood and giant stone wheel read as milling machinery.
        addGable(this.cream, 1.72, .7, 1.56);
        addCurtains([this.cream, accent], 4, 1.42, 1.43, .38);
        break;
      }
      case 'smokehouse': {
        // A dark drying rack occupies the full storefront.
        addPostPair(this.dark, .79, 1.34, 1.34);
        addBox(1.76, .14, .16, this.dark, 0, 1.34, 1.56);
        addBox(1.54, .08, .12, this.wood, 0, 1.39, 1.22);
        for (const side of [-.58, -.2, .2, .58]) {
          const cord = new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, .38, 5), this.dark);
          this.detailPosition(cord, dx, dz, lateral, side, 1.4, 1.0);
          group.add(cord);
        }
        break;
      }
      case 'weaver': {
        // Long, saturated cloth bolts turn the façade into a textile wall.
        addBox(1.72, .12, .12, this.wood, 0, 1.3, 1.53);
        addCurtains([accent, this.cream, this.cachedMaterial(this.colorMaterials, 0xb85c55, .94)], 4, 1.56, 1.51, .83);
        break;
      }
      case 'shipyard': {
        // A tall timber gantry and braces form a miniature building slip.
        addPostPair(this.wood, .94, 1.52, 1.42);
        addBox(2.08, .14, .16, this.wood, 0, 1.42, 1.64);
        for (const side of [-.66, .66]) {
          const brace = addBox(.07, .72, .08, accent, side, 1.43, 1.13);
          brace.rotation.z = side * -.5;
          if (dir % 2) brace.rotation.x = side * .5;
        }
        const hook = new THREE.Mesh(new THREE.TorusGeometry(.1, .025, 6, 10, Math.PI * 1.5), this.metal);
        this.detailPosition(hook, dx, dz, lateral, 0, 1.48, 1.28);
        hook.rotation.y = dir % 2 ? Math.PI / 2 : 0;
        group.add(hook);
        break;
      }
    }
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
      const side = -.62 + index * .31;
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(.09, .12, .18, 7), accent);
      this.detailPosition(pot, dx, dz, lateral, side, 1.42, .16);
      const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(.1 + index % 2 * .025, 1), index % 2 ? this.blossom : this.silverLeaf);
      this.detailPosition(flower, dx, dz, lateral, side, 1.42, .38 + index % 2 * .06);
      group.add(pot, flower);
    }
  }

  private addBookstoreDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    const shelf = this.orientedBox(1.1, .62, .18, dir, this.wood);
    this.detailPosition(shelf, dx, dz, lateral, .36, 1.36, .38);
    group.add(shelf);
    for (let index = 0; index < 6; index++) {
      const book = this.orientedBox(.1, .25 + index % 3 * .035, .08, dir, index % 2 ? accent : this.cream);
      this.detailPosition(book, dx, dz, lateral, -.02 + index * .15, 1.47, .45);
      group.add(book);
    }
  }

  private addWorkshopDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (let i = 0; i < 2; i++) {
      const crate = this.orientedBox(.34 + i * .08, .32, .31, dir, i ? accent : this.wood);
      this.detailPosition(crate, dx, dz, lateral, .5, 1.38, .18 + i * .3);
      group.add(crate);
    }
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(.21, .045, 6, 12), this.metal);
    this.detailPosition(wheel, dx, dz, lateral, -.55, 1.3, .62);
    wheel.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(wheel);
  }

  private addFishmongerDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3) {
    for (const side of [-.34, .34]) {
      const fish = new THREE.Mesh(new THREE.SphereGeometry(.11, 8, 6), this.metal);
      fish.scale.set(1.7, .55, .55);
      this.detailPosition(fish, dx, dz, lateral, side, 1.49, .84);
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
    const bench = this.orientedBox(.7, .13, .26, dir, this.wood);
    this.detailPosition(bench, dx, dz, lateral, .43, 1.43, .25);
    group.add(bench);
  }

  private addRestaurantDetails(group: THREE.Group, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (const side of [-.45, .45]) {
      const table = new THREE.Mesh(new THREE.CylinderGeometry(.24, .27, .1, 10), this.wood);
      this.detailPosition(table, dx, dz, lateral, side, 1.55, .36);
      const bowl = new THREE.Mesh(new THREE.TorusGeometry(.075, .025, 5, 10), accent);
      this.detailPosition(bowl, dx, dz, lateral, side, 1.55, .46);
      bowl.rotation.x = Math.PI / 2;
      group.add(table, bowl);
    }
  }

  private addTeaHouseDetails(group: THREE.Group, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    const table = new THREE.Mesh(new THREE.CylinderGeometry(.34, .38, .12, 12), this.wood);
    this.detailPosition(table, dx, dz, lateral, 0, 1.55, .28);
    const kettle = new THREE.Mesh(new THREE.SphereGeometry(.13, 9, 7), accent);
    kettle.scale.y = .78;
    this.detailPosition(kettle, dx, dz, lateral, 0, 1.55, .43);
    group.add(table, kettle);
    for (const side of [-.18, 0, .18]) {
      const cup = new THREE.Mesh(new THREE.CylinderGeometry(.045, .04, .07, 8), this.cream);
      this.detailPosition(cup, dx, dz, lateral, side, 1.55, .42);
      group.add(cup);
    }
  }

  private addPotteryDetails(group: THREE.Group, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (let index = 0; index < 4; index++) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(.08 + index * .018, .13 + index * .012, .2 + index * .05, 9), index % 2 ? accent : this.cream);
      this.detailPosition(pot, dx, dz, lateral, -.58 + index * .3, 1.4, .14 + index * .03);
      group.add(pot);
    }
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(.25, .25, .07, 12), this.wood);
    this.detailPosition(wheel, dx, dz, lateral, .52, 1.46, .18);
    group.add(wheel);
  }

  private addMillDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    const millstone = new THREE.Mesh(new THREE.TorusGeometry(.28, .075, 7, 14), this.stone);
    this.detailPosition(millstone, dx, dz, lateral, .58, 1.39, .43);
    millstone.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(millstone);
    for (const side of [-.66, -.36]) {
      const sack = new THREE.Mesh(new THREE.CapsuleGeometry(.11, .2, 3, 7), side < -.5 ? this.cream : accent);
      this.detailPosition(sack, dx, dz, lateral, side, 1.4, .22);
      group.add(sack);
    }
  }

  private addSmokehouseDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (const side of [-.58, 0, .58]) {
      const fish = new THREE.Mesh(new THREE.SphereGeometry(.09, 7, 5), accent);
      fish.scale.set(1.65, .48, .5);
      this.detailPosition(fish, dx, dz, lateral, side, 1.42, .76);
      fish.rotation.y = dir % 2 ? 0 : Math.PI / 2;
      group.add(fish);
    }
    const rail = this.orientedBox(1.45, .06, .07, dir, this.wood);
    this.detailPosition(rail, dx, dz, lateral, 0, 1.39, .94);
    group.add(rail);
  }

  private addWeaverDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (let index = 0; index < 3; index++) {
      const roll = new THREE.Mesh(new THREE.CylinderGeometry(.11, .11, .55, 8), index % 2 ? accent : this.cream);
      this.detailPosition(roll, dx, dz, lateral, -.58 + index * .46, 1.42, .26);
      roll.rotation.z = Math.PI / 2;
      roll.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      group.add(roll);
    }
  }

  private addShipyardDetails(group: THREE.Group, dir: Direction, dx: number, dz: number, lateral: THREE.Vector3, accent: THREE.Material) {
    for (const side of [-.52, 0, .52]) {
      const rib = new THREE.Mesh(new THREE.TorusGeometry(.28, .035, 5, 10, Math.PI), side === 0 ? accent : this.wood);
      this.detailPosition(rib, dx, dz, lateral, side, 1.46, .35);
      rib.rotation.y = dir % 2 ? Math.PI / 2 : 0;
      rib.rotation.z = Math.PI;
      group.add(rib);
    }
    const keel = this.orientedBox(1.45, .07, .09, dir, this.wood);
    this.detailPosition(keel, dx, dz, lateral, 0, 1.43, .18);
    group.add(keel);
  }

  private addAirConditioner(
    group: THREE.Group,
    cell: Cell,
    dir: Direction,
    level: number,
    lateral: THREE.Vector3,
    px: number,
    pz: number,
    y: number,
  ) {
    const preferredSide = hash(this.seed, cell.x, cell.z, 880 + dir * 11 + level) > .5 ? .92 : -.92;
    const side = [preferredSide, -preferredSide].find((candidate) => this.reserveFacadeDecoration(
      group,
      dir,
      `air-conditioner-${level}`,
      'equipment',
      { sideMin: candidate - .25, sideMax: candidate + .25, yMin: y - .18, yMax: y + .18 },
    ));
    if (side === undefined) return;
    const [dx, dz] = CARDINALS[dir];
    const unit = shadow(new THREE.Mesh(new THREE.BoxGeometry(dir % 2 ? .18 : .5, .32, dir % 2 ? .5 : .18), this.cream), false);
    unit.position.set(px + dx * .12 + lateral.x * side, y, pz + dz * .12 + lateral.z * side);
    group.add(unit);
    const fan = new THREE.Mesh(new THREE.TorusGeometry(.09, .018, 5, 10), this.metal);
    fan.position.set(unit.position.x + dx * .1, y, unit.position.z + dz * .1);
    fan.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    group.add(fan);
  }

  private addPipe(group: THREE.Group, cell: Cell, dir: Direction, lateral: THREE.Vector3, px: number, pz: number) {
    const preferredSide = hash(this.seed, cell.x, cell.z, 890 + dir) > .5 ? .94 : -.94;
    const side = [preferredSide, -preferredSide].find((candidate) => this.reserveFacadeDecoration(
      group,
      dir,
      'drain-pipe',
      'equipment',
      { sideMin: candidate - .045, sideMax: candidate + .045, yMin: .3, yMax: 1.54 },
    ));
    if (side === undefined) return;
    const [dx, dz] = CARDINALS[dir];
    const pipe = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.027, .027, 1.18, 6), this.metal), false);
    pipe.position.set(px + dx * .08 + lateral.x * side, .92, pz + dz * .08 + lateral.z * side);
    group.add(pipe);
  }

  private doorDirection(cell: Cell): Direction {
    return this.canalMarketFrontDirection(cell) ?? facadeDirectionAt(cell.x, cell.z, this.cells, this.seed);
  }

  private reserveFacadeDecoration(
    group: THREE.Group,
    direction: Direction,
    kind: string,
    layer: FacadeLayer,
    bounds: FacadeBounds,
  ) {
    let layout = this.facadeLayouts.get(group);
    if (!layout) {
      layout = new FacadeDecorationLayout();
      this.facadeLayouts.set(group, layout);
    }
    const reserved = layout.reserve(direction, kind, layer, bounds);
    group.userData.facadeDecorationClaims = layout.claims;
    if (!reserved) (group.userData.facadeDecorationRejections ??= []).push({ direction, kind, bounds });
    return reserved;
  }

  private placeFacadeTraceBounds(cell: Cell, topY: number, kind: PlaceLandmarkKind): FacadeBounds | null {
    if (kind === 'seed-house') {
      if (isWalkableRoof(cell, this.cells)) return null;
      const y = Math.min(topY - .3, 1.38);
      return { sideMin: -.5, sideMax: .5, yMin: y - .1, yMax: y + .34 };
    }
    if (kind === 'guild-kiln') return { sideMin: -.6, sideMax: .7, yMin: .16, yMax: 1.65 };
    if (kind === 'lantern-theatre') return { sideMin: -.62, sideMax: .92, yMin: .68, yMax: 1.56 };
    if (kind === 'ferry-house') return { sideMin: .14, sideMax: .86, yMin: 1.22, yMax: 1.68 };
    if (kind === 'tide-cistern') return { sideMin: .36, sideMax: .8, yMin: .12, yMax: 1.56 };
    if (kind === 'reading-loggia') return { sideMin: .25, sideMax: .86, yMin: .53, yMax: 1.04 };
    if (kind === 'tide-bell') return { sideMin: .34, sideMax: .92, yMin: .94, yMax: 1.58 };
    if (kind === 'post-house') return { sideMin: .32, sideMax: .8, yMin: .62, yMax: 1.06 };
    return null;
  }

  private canalMarketFrontDirection(cell: Cell): Direction | undefined {
    if (this.businesses.has(keyOf(cell.x, cell.z))) return undefined;
    const influence = this.neighborhoodInfluenceAt(cell.x, cell.z);
    if (!influence || influence.landmark.kind !== 'market-barge') return undefined;
    if (hash(this.seed, cell.x, cell.z, 8100) >= .2 + influence.strength * .68) return undefined;
    const open = CARDINALS
      .map((_, direction) => direction as Direction)
      .filter((direction) => this.neighborHeight(cell, direction) === 0);
    if (!open.length) return undefined;
    const towardX = influence.landmark.x - cell.x;
    const towardZ = influence.landmark.z - cell.z;
    const fallback = facadeDirectionAt(cell.x, cell.z, this.cells, this.seed);
    return open.reduce((best, direction) => {
      const [dx, dz] = CARDINALS[direction];
      const [bestDx, bestDz] = CARDINALS[best];
      const score = dx * towardX + dz * towardZ + (direction === fallback ? .001 : 0);
      const bestScore = bestDx * towardX + bestDz * towardZ + (best === fallback ? .001 : 0);
      return score > bestScore ? direction : best;
    }, open[0]);
  }

  private edgePosition(dir: Direction, distance: number): [number, number] {
    const [dx, dz] = CARDINALS[dir];
    return [dx * distance, dz * distance];
  }

  private cachedMaterial(cache: Map<number, THREE.MeshStandardMaterial>, color: number, roughness: number) {
    let material = cache.get(color);
    if (!material) {
      const texture = cache === this.wallMaterials ? this.plasterTexture : cache === this.roofMaterials ? this.roofTexture : null;
      material = new THREE.MeshStandardMaterial({
        color,
        roughness,
        map: texture,
        roughnessMap: this.materialDetail ? texture : null,
        bumpMap: this.materialDetail ? texture : null,
        bumpScale: cache === this.wallMaterials ? .028 : cache === this.roofMaterials ? .035 : 0,
      });
      material.userData.vertexBatchColor = color;
      material.userData.vertexBatchMaterial = cache === this.wallMaterials
        ? this.wallVertexMaterial
        : cache === this.roofMaterials
          ? this.roofVertexMaterial
          : this.accentVertexMaterial;
      cache.set(color, material);
    }
    return material;
  }

  private addWaterEdges(group: THREE.Group, cell: Cell, heights: number[]) {
    const entranceDirection = this.doorDirection(cell);
    const hasBusinessEntrance = this.businesses.has(keyOf(cell.x, cell.z));
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
      } else if (!hasBusinessEntrance && dir === entranceDirection && hasWaterStairs(cell, dir, this.seed)) {
        // Water stairs belong to the entrance façade. Generating them on any
        // exposed edge made them terminate below windows or cut through shop
        // displays, which read as badly attached building stairs.
        const stepCount = 4;
        for (let step = 0; step < stepCount; step++) {
          const stair = shadow(new THREE.Mesh(
            new THREE.BoxGeometry(dir % 2 ? .4 : .68, .1, dir % 2 ? .68 : .4),
            this.stone,
          ));
          stair.position.set(dx * (CELL * .59 + step * .29), .02 - step * .1, dz * (CELL * .59 + step * .29));
          group.add(stair);
        }
        group.userData.waterStairDirection = dir;
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
    group.userData.balconyDirection = dir;
  }

  private addRoofEaves(group: THREE.Group, y: number, roofMaterial: THREE.Material, cell: Cell) {
    const eave = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * 1.13, .11, CELL * 1.13, 1, .04), roofMaterial));
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

  private addRoofAccess(group: THREE.Group, y: number, dir: Direction) {
    const [dx, dz] = CARDINALS[dir];
    const landing = this.orientedBox(.58, .12, .52, dir, this.stoneDark);
    landing.position.set(dx * .69, y + .22, dz * .69);
    const housing = this.orientedBox(.5, .5, .42, dir, this.cream);
    housing.position.set(dx * .78, y + .51, dz * .78);
    const cap = this.orientedBox(.61, .1, .53, dir, this.wood);
    cap.position.set(dx * .78, y + .81, dz * .78);
    const doorway = this.orientedBox(.25, .31, .025, dir, this.dark);
    doorway.position.set(dx * .555, y + .43, dz * .555);
    group.add(landing, housing, cap, doorway);
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

  private addRoofHall(group: THREE.Group, y: number) {
    const center = CELL / 2;
    const floor = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.72, .14, 1.42, 1, .06), this.wood));
    floor.position.set(center, y + .17, center);
    group.add(floor);
    for (const x of [center - .68, center + .68]) for (const z of [center - .52, center + .52]) {
      const post = shadow(new THREE.Mesh(new THREE.BoxGeometry(.07, 1.12, .07), this.dark), false);
      post.position.set(x, y + .78, z);
      group.add(post);
    }
    const back = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.32, .72, .08), this.cream), false);
    back.position.set(center, y + .72, center + .5);
    const window = shadow(new THREE.Mesh(new THREE.PlaneGeometry(.72, .34), this.window), false);
    window.position.set(center, y + .78, center + .545);
    group.add(back, window);
    const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.18, .58, 4), this.cachedMaterial(this.roofMaterials, 0x733e38, .82)));
    roof.position.set(center, y + 1.52, center);
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = .78;
    group.add(roof);
    for (const side of [-.52, .52]) {
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), this.warmLight);
      lantern.scale.y = 1.3;
      lantern.position.set(center + side, y + 1.03, center - .48);
      group.add(lantern);
    }
    group.userData.placeLandmark = 'roof-hall';
  }

  private addGuildKiln(group: THREE.Group, cell: Cell) {
    const direction = CARDINALS.findIndex(([dx, dz]) => !this.get(cell.x + dx, cell.z + dz)) as Direction;
    const dir = direction >= 0 ? direction : 0;
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const kiln = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.32, .42, .7, 10), this.stoneDark));
    kiln.position.set(dx * 1.12, .56, dz * 1.12);
    const chimney = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.11, .15, .72, 8), this.dark));
    chimney.position.set(dx * 1.12 - lateral.x * .16, 1.2, dz * 1.12 - lateral.z * .16);
    const mouth = shadow(new THREE.Mesh(new THREE.CircleGeometry(.16, 10), this.warmLight), false);
    mouth.position.set(dx * .78, .52, dz * .78);
    mouth.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    if (dir === 0 || dir === 3) mouth.rotation.y += Math.PI;
    const awning = this.orientedBox(1.12, .1, .72, dir, this.wood);
    awning.position.set(dx * 1.08, 1.48, dz * 1.08);
    group.add(kiln, chimney, mouth, awning);
    for (const side of [-.36, .36]) {
      const stool = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.12, .15, .2, 7), this.wood), false);
      stool.position.set(dx * .82 + lateral.x * side, .28, dz * .82 + lateral.z * side);
      group.add(stool);
    }
    group.userData.placeLandmark = 'guild-kiln';
  }

  private addCanalMarketTrace(group: THREE.Group, cell: Cell, dir: Direction) {
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const marketRed = this.cachedMaterial(this.colorMaterials, 0xb84d3f, .9);
    const marketGold = this.cachedMaterial(this.colorMaterials, 0xc89545, .92);

    // One frontage owns this entire band: a supported landing, a broad shade,
    // and cargo kept at ground level. The former hanging baskets occupied the
    // same space as the home's awning and sign, making every trace look tangled.
    const platform = shadow(this.orientedBox(1.98, .12, .82, dir, this.stone));
    this.detailPosition(platform, dx, dz, lateral, 0, 1.55, .17);
    platform.name = 'canal-market-platform';
    group.add(platform);

    const canopy = shadow(this.orientedBox(1.78, .11, .66, dir, marketRed), false);
    this.detailPosition(canopy, dx, dz, lateral, 0, 1.43, 1.44);
    canopy.rotation.set(lateral.z * -.1, 0, lateral.x * .1);
    canopy.name = 'canal-market-canopy';
    const hem = shadow(this.orientedBox(1.78, .1, .07, dir, this.cream), false);
    this.detailPosition(hem, dx, dz, lateral, 0, 1.75, 1.36);
    hem.name = 'canal-market-canopy-hem';
    const beam = shadow(this.orientedBox(1.9, .1, .1, dir, this.wood), false);
    this.detailPosition(beam, dx, dz, lateral, 0, 1.29, 1.57);
    beam.name = 'canal-market-beam';
    group.add(canopy, hem, beam);

    for (const side of [-.84, .84]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, 1.16, 6), this.wood), false);
      this.detailPosition(post, dx, dz, lateral, side, 1.48, .81);
      post.name = 'canal-market-post';
      group.add(post);
    }

    const cargoSide = hash(this.seed, cell.x, cell.z, 8112) > .5 ? 1 : -1;
    const basket = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.15, .2, .22, 9), marketGold), false);
    this.detailPosition(basket, dx, dz, lateral, cargoSide * .61, 1.63, .35);
    basket.name = 'canal-market-basket';
    const rim = shadow(new THREE.Mesh(new THREE.TorusGeometry(.155, .018, 5, 10), this.wood), false);
    this.detailPosition(rim, dx, dz, lateral, cargoSide * .61, 1.63, .47);
    rim.rotation.x = Math.PI / 2;
    rim.name = 'canal-market-basket-rim';
    const crate = shadow(this.orientedBox(.42, .26, .34, dir, this.wood), false);
    this.detailPosition(crate, dx, dz, lateral, cargoSide * -.58, 1.61, .36);
    crate.name = 'canal-market-crate';
    const hook = new THREE.Mesh(new THREE.TorusGeometry(.09, .018, 5, 10, Math.PI * 1.45), this.metal);
    this.detailPosition(hook, dx, dz, lateral, cargoSide * -.67, 1.51, 1.14);
    hook.rotation.y = dir % 2 ? Math.PI / 2 : 0;
    hook.name = 'canal-market-hook';
    group.add(basket, rim, crate, hook);
    group.userData.canalMarketFrontDirection = dir;
    return true;
  }

  private addSeedHouseTrays(group: THREE.Group, cell: Cell, topY: number) {
    const direction = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[direction];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const roofTray = isWalkableRoof(cell, this.cells);
    const y = roofTray ? topY + .25 : Math.min(topY - .3, 1.38);
    const outward = roofTray ? .72 : CELL * .525;
    const tray = shadow(this.orientedBox(.78, .15, .22, direction, this.wood), false);
    tray.position.set(dx * outward, y, dz * outward);
    group.add(tray);
    for (const side of [-.25, 0, .25]) {
      const sprout = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(.09 + Math.abs(side) * .04, 0), side === 0 ? this.blossom : this.leaf), false);
      sprout.position.set(dx * outward + lateral.x * side, y + .14 + Math.abs(side) * .05, dz * outward + lateral.z * side);
      group.add(sprout);
    }
    group.userData.seedHouseTrays = true;
    return true;
  }

  private addGuildKilnMarks(group: THREE.Group, cell: Cell) {
    const direction = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[direction];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const clay = this.cachedMaterial(this.colorMaterials, 0xb8664d, .92);
    for (const side of [-.42, .42]) {
      const plaque = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.14, .14, .035, 8), clay), false);
      plaque.position.set(dx * CELL * .523 + lateral.x * side, 1.48, dz * CELL * .523 + lateral.z * side);
      plaque.rotation.z = direction % 2 ? Math.PI / 2 : 0;
      plaque.rotation.x = direction % 2 ? 0 : Math.PI / 2;
      group.add(plaque);
    }
    const vessel = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.09, .14, .25, 8), clay), false);
    vessel.position.set(dx * .96 + lateral.x * .52, .33, dz * .96 + lateral.z * .52);
    group.add(vessel);
    group.userData.guildKilnMarks = true;
    return true;
  }

  private addRoofVillageTrace(group: THREE.Group, cell: Cell, topY: number) {
    if (!isWalkableRoof(cell, this.cells)) return false;
    const cloth = this.cachedMaterial(this.colorMaterials, 0x577f86, .96);
    const table = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.28, .32, .11, 10), this.wood), false);
    table.position.set(-.12, topY + .28, .08);
    group.add(table);
    for (const [x, z, material] of [[-.5, .08, cloth], [.28, -.34, this.flagMaterial], [.34, .4, this.cream]] as const) {
      const cushion = shadow(new THREE.Mesh(new RoundedBoxGeometry(.3, .08, .3, 1, .07), material), false);
      cushion.position.set(x, topY + .24, z);
      group.add(cushion);
    }
    const line = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.01, .01, .95, 5), this.dark), false);
    line.rotation.z = Math.PI / 2;
    line.position.set(.12, topY + .78, -.48);
    group.add(line);
    for (const side of [-.3, 0, .3]) {
      const pennant = new THREE.Mesh(new THREE.PlaneGeometry(.18, .24), side === 0 ? this.cream : cloth);
      pennant.position.set(.12 + side, topY + .65, -.47);
      group.add(pennant);
    }
    return true;
  }

  private addHighHarborTrace(group: THREE.Group, cell: Cell, topY: number) {
    if (cell.height < 2) return false;
    const direction = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[direction];
    const mast = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.022, .032, 1.02, 6), this.metal), false);
    mast.position.set(-dx * .34, topY + .94, -dz * .34);
    const vane = shadow(this.orientedBox(.48, .035, .045, direction, this.dark), false);
    vane.position.set(mast.position.x, topY + 1.44, mast.position.z);
    const pennant = new THREE.Mesh(new THREE.ConeGeometry(.15, .38, 3), this.flagMaterial);
    pennant.rotation.z = direction % 2 ? Math.PI / 2 : 0;
    pennant.rotation.x = direction % 2 ? 0 : Math.PI / 2;
    pennant.position.set(mast.position.x + dx * .22, topY + 1.2, mast.position.z + dz * .22);
    group.add(mast, vane, pennant);
    return true;
  }

  private addLanternSquareTrace(group: THREE.Group, cell: Cell) {
    const dir = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    for (const side of [-.5, .5]) {
      const bracket = this.orientedBox(.16, .035, .035, dir, this.dark);
      this.detailPosition(bracket, dx, dz, lateral, side, 1.18, 1.52);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), this.warmLight);
      lantern.scale.y = 1.35;
      this.detailPosition(lantern, dx, dz, lateral, side, 1.27, 1.35);
      group.add(bracket, lantern);
    }
    const handbill = this.orientedBox(.28, .34, .025, dir, this.flagMaterial);
    this.detailPosition(handbill, dx, dz, lateral, .76, CELL * .515, .88);
    group.add(handbill);
    return true;
  }

  private addExtendedPlaceTrace(group: THREE.Group, cell: Cell, topY: number, kind: PlaceLandmarkKind) {
    const dir = this.doorDirection(cell);
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const teal = this.cachedMaterial(this.colorMaterials, 0x4d8582, .92);
    const blue = this.cachedMaterial(this.colorMaterials, 0x536f92, .9);
    const red = this.cachedMaterial(this.colorMaterials, 0xb85a4f, .94);
    const roofY = topY + .34;

    if (kind === 'ferry-house') {
      const board = shadow(this.orientedBox(.62, .38, .06, dir, teal), false);
      this.detailPosition(board, dx, dz, lateral, .5, CELL * .52, Math.min(topY - .18, 1.45));
      const route = shadow(this.orientedBox(.38, .035, .035, dir, this.cream), false);
      this.detailPosition(route, dx, dz, lateral, .5, CELL * .555, Math.min(topY - .18, 1.45));
      group.add(board, route);
    } else if (kind === 'tide-cistern') {
      const chain = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, .84, 6), this.metal), false);
      this.detailPosition(chain, dx, dz, lateral, .58, CELL * .54, 1.12);
      const basin = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.16, .21, .16, 10), teal), false);
      this.detailPosition(basin, dx, dz, lateral, .58, CELL * .58, .22);
      group.add(chain, basin);
    } else if (kind === 'reading-loggia') {
      const box = shadow(this.orientedBox(.52, .4, .18, dir, this.wood), false);
      this.detailPosition(box, dx, dz, lateral, .55, CELL * .55, .76);
      for (const offset of [-.14, 0, .14]) {
        const book = shadow(this.orientedBox(.08, .25, .05, dir, offset === 0 ? red : this.flagMaterial), false);
        this.detailPosition(book, dx, dz, lateral, .55 + offset, CELL * .65, .8);
        group.add(book);
      }
      group.add(box);
    } else if (kind === 'wind-loom') {
      const line = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.012, .012, 1.04, 5), this.dark), false);
      line.rotation.z = Math.PI / 2;
      line.position.set(0, topY + .82, -.44);
      group.add(line);
      for (const [index, material] of [red, teal, this.flagMaterial].entries()) {
        const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.22, .34), material);
        cloth.name = `laundry-windloom-${index}`;
        cloth.position.set((index - 1) * .32, topY + .64, -.43);
        group.add(cloth);
        (group.userData.laundry ??= []).push(cloth);
      }
    } else if (kind === 'tide-bell') {
      const plaque = shadow(this.orientedBox(.36, .28, .045, dir, this.metal), false);
      this.detailPosition(plaque, dx, dz, lateral, .54, CELL * .53, 1.42);
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(.16, .46), red);
      ribbon.name = 'laundry-bell-ribbon';
      this.detailPosition(ribbon, dx, dz, lateral, .78, CELL * .55, 1.2);
      group.add(plaque, ribbon);
      (group.userData.laundry ??= []).push(ribbon);
    } else if (kind === 'post-house') {
      const box = shadow(this.orientedBox(.42, .34, .2, dir, blue), false);
      this.detailPosition(box, dx, dz, lateral, .56, CELL * .56, .82);
      const slot = shadow(this.orientedBox(.24, .035, .035, dir, this.cream), false);
      this.detailPosition(slot, dx, dz, lateral, .56, CELL * .68, .87);
      group.add(box, slot);
    } else if (kind === 'star-dial') {
      const chime = new THREE.Group();
      for (const offset of [-.2, 0, .2]) {
        const strand = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.01, .01, .42 + Math.abs(offset), 5), this.metal), false);
        strand.position.set(offset, roofY + .36, -.38);
        const star = new THREE.Mesh(new THREE.OctahedronGeometry(.07, 0), blue);
        star.position.set(offset, roofY + .1 - Math.abs(offset) * .5, -.38);
        chime.add(strand, star);
      }
      group.add(chime);
    } else if (kind === 'kite-loft') {
      const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.018, .025, .92, 6), this.wood), false);
      pole.position.set(.38, topY + .76, -.35);
      const kite = new THREE.Mesh(new THREE.PlaneGeometry(.34, .34), red);
      kite.name = 'laundry-kite-trace';
      kite.rotation.z = Math.PI / 4;
      kite.position.set(.38, topY + 1.22, -.34);
      group.add(pole, kite);
      (group.userData.laundry ??= []).push(kite);
    } else {
      return false;
    }
    group.userData.extendedPlaceTrace = kind;
    return true;
  }

  private addSignalBeacon(group: THREE.Group, y: number) {
    const base = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.34, .42, .2, 10), this.stoneDark));
    base.position.y = y + .28;
    const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.035, .055, 1.65, 7), this.metal));
    pole.position.y = y + 1.12;
    const crossbar = shadow(new THREE.Mesh(new THREE.BoxGeometry(.92, .055, .055), this.dark), false);
    crossbar.position.y = y + 1.45;
    group.add(base, pole, crossbar);
    for (const side of [-.34, .34]) {
      const signal = new THREE.Mesh(new THREE.PlaneGeometry(.28, .34), side < 0 ? this.flagMaterial : this.cachedMaterial(this.colorMaterials, 0xb63d32, .9));
      signal.position.set(side, y + 1.25, .02);
      group.add(signal);
    }
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.14, 10, 8), this.warmLight);
    beacon.position.y = y + 1.92;
    group.add(beacon);
    group.userData.placeLandmark = 'signal-beacon';
  }

  private addWindLoom(group: THREE.Group, y: number) {
    const center = CELL / 2;
    const red = this.cachedMaterial(this.colorMaterials, 0xb85a4f, .94);
    const teal = this.cachedMaterial(this.colorMaterials, 0x4d8582, .92);
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.62, .14, 1.28, 1, .06), this.wood));
    platform.position.set(center, y + .17, center);
    group.add(platform);
    for (const side of [-.62, .62]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.04, .055, 1.45, 7), this.dark));
      post.position.set(center + side, y + .92, center);
      group.add(post);
    }
    const beam = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, 1.35, 7), this.dark));
    beam.rotation.z = Math.PI / 2;
    beam.position.set(center, y + 1.58, center);
    group.add(beam);
    for (const [index, material] of [red, this.flagMaterial, teal, this.cream].entries()) {
      const thread = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .94, 5), this.metal), false);
      thread.position.set(center - .48 + index * .32, y + 1.05, center);
      const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.27, .62), material);
      cloth.name = `laundry-wind-loom-${index}`;
      cloth.position.set(thread.position.x, y + 1.02, center + .015);
      group.add(thread, cloth);
      (group.userData.laundry ??= []).push(cloth);
    }
    group.userData.placeLandmark = 'wind-loom';
  }

  private addTideBell(group: THREE.Group, y: number) {
    const bronze = this.cachedMaterial(this.colorMaterials, 0x9b7445, .65);
    for (const side of [-.42, .42]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.045, .06, 1.28, 8), this.stoneDark));
      post.position.set(side, y + .82, 0);
      group.add(post);
    }
    const beam = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.05, .1, .12), this.stoneDark));
    beam.position.set(0, y + 1.46, 0);
    const bell = shadow(new THREE.Mesh(new THREE.ConeGeometry(.24, .42, 12, 1, true), bronze));
    bell.position.set(0, y + 1.18, 0);
    bell.rotation.x = Math.PI;
    const clapper = shadow(new THREE.Mesh(new THREE.SphereGeometry(.065, 7, 5), this.dark), false);
    clapper.position.set(0, y + .94, 0);
    const light = new THREE.Mesh(new THREE.SphereGeometry(.075, 8, 6), this.warmLight);
    light.position.set(0, y + 1.58, 0);
    group.add(beam, bell, clapper, light);
    group.userData.placeLandmark = 'tide-bell';
  }

  private addPostHouse(group: THREE.Group, y: number) {
    const blue = this.cachedMaterial(this.colorMaterials, 0x536f92, .9);
    const room = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.05, .68, .82, 1, .08), this.cream));
    room.position.set(0, y + .58, 0);
    const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(.78, .42, 4), blue));
    roof.position.set(0, y + 1.12, 0);
    roof.rotation.y = Math.PI / 4;
    const window = new THREE.Mesh(new THREE.PlaneGeometry(.46, .26), this.window);
    window.position.set(0, y + .62, .416);
    group.add(room, roof, window);
    for (const side of [-.34, .34]) {
      const satchel = shadow(new THREE.Mesh(new THREE.BoxGeometry(.25, .18, .1), side < 0 ? blue : this.flagMaterial), false);
      satchel.position.set(side, y + .28, .48);
      group.add(satchel);
    }
    group.userData.placeLandmark = 'post-house';
  }

  private addStarDial(group: THREE.Group, y: number) {
    const center = CELL / 2;
    const brass = this.cachedMaterial(this.colorMaterials, 0xb49355, .56);
    const base = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.3, .38, .22, 10), this.stoneDark));
    base.position.set(center, y + .27, center);
    const ring = shadow(new THREE.Mesh(new THREE.TorusGeometry(.48, .045, 8, 24), brass), false);
    ring.position.set(center, y + .86, center);
    ring.rotation.x = Math.PI / 2.8;
    const axis = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.18, 6), brass), false);
    axis.position.set(center, y + .78, center);
    axis.rotation.z = -.45;
    const star = new THREE.Mesh(new THREE.OctahedronGeometry(.12, 0), this.warmLight);
    star.position.set(center + .25, y + 1.32, center);
    group.add(base, ring, axis, star);
    group.userData.placeLandmark = 'star-dial';
  }

  private addKiteLoft(group: THREE.Group, y: number) {
    const center = CELL / 2;
    const red = this.cachedMaterial(this.colorMaterials, 0xb85a4f, .94);
    const deck = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.48, .14, 1.18, 1, .06), this.wood));
    deck.position.set(center, y + .16, center);
    group.add(deck);
    for (const side of [-.5, .5]) {
      const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.03, .04, 1.12, 6), this.dark), false);
      pole.position.set(center + side, y + .78, center + .32);
      group.add(pole);
    }
    const canopy = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.22, .05, .68), this.cream), false);
    canopy.position.set(center, y + 1.25, center + .05);
    group.add(canopy);
    for (const [index, material] of [red, this.flagMaterial, this.cachedMaterial(this.colorMaterials, 0x4d8582, .92)].entries()) {
      const kite = new THREE.Mesh(new THREE.PlaneGeometry(.34, .34), material);
      kite.name = `laundry-kite-loft-${index}`;
      kite.rotation.z = Math.PI / 4;
      kite.position.set(center + (index - 1) * .42, y + 1.62 + index * .08, center);
      group.add(kite);
      (group.userData.laundry ??= []).push(kite);
    }
    group.userData.placeLandmark = 'kite-loft';
  }

  private addObservatoryBeacon(group: THREE.Group, y: number) {
    const brass = this.cachedMaterial(this.colorMaterials, 0xb49355, .56);
    const blue = this.cachedMaterial(this.colorMaterials, 0x536f92, .86);
    const deck = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.68, .78, .18, 12), this.stoneDark));
    deck.position.y = y + .2;
    group.add(deck);
    for (const rotation of [0, Math.PI / 2]) {
      const ring = shadow(new THREE.Mesh(new THREE.TorusGeometry(.48, .045, 8, 24), brass), false);
      ring.position.y = y + .98;
      ring.rotation.set(Math.PI / 2.7, rotation, 0);
      group.add(ring);
    }
    const axis = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, 1.65, 7), brass), false);
    axis.position.y = y + 1.04;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(.15, 10, 8), this.warmLight);
    beacon.position.y = y + 1.78;
    group.add(axis, beacon);
    for (const side of [-.44, .44]) {
      const planter = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.12, .17, .2, 8), blue), false);
      planter.position.set(side, y + .32, .34);
      const flower = new THREE.Mesh(new THREE.OctahedronGeometry(.11, 0), side < 0 ? this.blossom : this.silverLeaf);
      flower.position.set(side, y + .53, .34);
      group.add(planter, flower);
    }
    group.userData.confluenceLandmark = 'observatory-beacon';
  }

  private addBannerHouse(group: THREE.Group, y: number) {
    const center = CELL / 2;
    const red = this.cachedMaterial(this.colorMaterials, 0xb85a4f, .94);
    const teal = this.cachedMaterial(this.colorMaterials, 0x4d8582, .92);
    const deck = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.92, .16, 1.54, 1, .07), this.wood));
    deck.position.set(center, y + .18, center);
    group.add(deck);
    for (const x of [center - .76, center + .76]) for (const z of [center - .55, center + .55]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.04, .055, 1.42, 7), this.dark), false);
      post.position.set(x, y + .88, z);
      group.add(post);
    }
    const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.82, .08, 1.28), this.cream), false);
    roof.position.set(center, y + 1.58, center);
    group.add(roof);
    const beam = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, 1.6, 7), this.dark), false);
    beam.rotation.z = Math.PI / 2;
    beam.position.set(center, y + 1.34, center - .52);
    group.add(beam);
    for (const [index, material] of [red, this.flagMaterial, teal].entries()) {
      const banner = new THREE.Mesh(new THREE.PlaneGeometry(.42, .86), material);
      banner.name = `laundry-banner-house-${index}`;
      banner.position.set(center + (index - 1) * .52, y + .92, center - .5);
      group.add(banner);
      (group.userData.laundry ??= []).push(banner);
    }
    group.userData.confluenceLandmark = 'banner-house';
  }

  private addHarborArchive(group: THREE.Group, y: number) {
    const blue = this.cachedMaterial(this.roofMaterials, 0x3f5260, .82);
    const plaster = this.cachedMaterial(this.wallMaterials, 0xd8c99f, .92);
    const deck = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.9, .9, .18, 8), this.stoneDark));
    deck.position.y = y + .09;
    deck.rotation.y = Math.PI / 8;
    const room = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.72, .79, .88, 8), plaster));
    room.position.y = y + .62;
    room.rotation.y = Math.PI / 8;
    const sill = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.8, .82, .08, 8), this.wood), false);
    sill.position.y = y + .22;
    sill.rotation.y = Math.PI / 8;
    const lintel = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.78, .78, .09, 8), this.wood), false);
    lintel.position.y = y + 1.06;
    lintel.rotation.y = Math.PI / 8;
    const eave = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.99, .99, .11, 8), blue));
    eave.position.y = y + 1.15;
    eave.rotation.y = Math.PI / 8;
    const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(.99, .72, 8), blue));
    roof.position.y = y + 1.55;
    roof.rotation.y = Math.PI / 8;
    group.add(deck, room, sill, lintel, eave, roof);

    // Four paired bays make the record room read as a usable archive instead
    // of a featureless cylinder with luminous stickers on it.
    for (let direction = 0; direction < 4; direction++) {
      const dir = direction as Direction;
      const [dx, dz] = CARDINALS[dir];
      const lateral = new THREE.Vector3(dz, 0, -dx);
      const frame = shadow(this.orientedBox(.62, .44, .055, dir, this.dark), false);
      frame.position.set(dx * .755, y + .65, dz * .755);
      group.add(frame);
      for (const side of [-1, 1]) {
        const window = shadow(this.orientedBox(.22, .32, .035, dir, this.window), false);
        window.position.set(
          dx * .79 + lateral.x * side * .16,
          y + .65,
          dz * .79 + lateral.z * side * .16,
        );
        group.add(window);
      }
    }
    const finial = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .035, .48, 7), this.metal), false);
    finial.position.y = y + 2.02;
    const vane = shadow(new THREE.Mesh(new THREE.BoxGeometry(.7, .04, .05), this.metal), false);
    vane.position.y = y + 2.17;
    const pennant = new THREE.Mesh(new THREE.PlaneGeometry(.34, .22), this.flagMaterial);
    pennant.name = 'flag';
    pennant.position.set(.22, y + 2.07, .02);
    group.add(finial, vane, pennant);
    group.userData.flag = pennant;
    group.userData.archiveWindowCount = 8;
    group.userData.confluenceLandmark = 'harbor-archive';
  }

  private addSteppedTerrace(group: THREE.Group, dir: Direction, y: number, feature: TerraceFeature) {
    const [dx, dz] = CARDINALS[dir];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    for (let index = 0; index < TERRACE_STEP_COUNT; index++) {
      const step = this.orientedBox(.82, TERRACE_STEP_HEIGHT, .34, dir, this.stone);
      const outward = terraceStepOutward(index);
      step.position.set(dx * outward, terraceTreadTopY(y, index) - TERRACE_STEP_HEIGHT / 2, dz * outward);
      group.add(step);
    }
    const topLandingY = terraceTreadTopY(y, 0);
    const topLandingOutward = terraceStepOutward(0) - .12;
    for (const side of [-.58, .58]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(.1, .14, .2, 7), this.wood);
      pot.position.set(dx * topLandingOutward + lateral.x * side, topLandingY + .1, dz * topLandingOutward + lateral.z * side);
      const plant = new THREE.Mesh(new THREE.IcosahedronGeometry(.14, 0), this.green);
      plant.position.set(pot.position.x, topLandingY + .29, pot.position.z);
      group.add(pot, plant);
    }
    if (feature !== 'stepped terrace') {
      for (let index = 1; index < TERRACE_STEP_COUNT; index += 2) {
        const outward = terraceStepOutward(index);
        const planter = new THREE.Mesh(new THREE.CylinderGeometry(.08, .11, .16, 7), this.wood);
        planter.position.set(dx * outward + lateral.x * .34, terraceTreadTopY(y, index) + .08, dz * outward + lateral.z * .34);
        const flower = new THREE.Mesh(new THREE.IcosahedronGeometry(.12, 0), index % 4 ? this.green : this.blossom);
        flower.position.copy(planter.position).setY(planter.position.y + .17);
        group.add(planter, flower);
      }
    }
    if (feature === 'lantern stair') {
      for (const side of [-.5, .5]) {
        const pole = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .72, 6), this.metal), false);
        pole.position.set(dx * topLandingOutward + lateral.x * side, topLandingY + .36, dz * topLandingOutward + lateral.z * side);
        const lantern = new THREE.Mesh(new THREE.SphereGeometry(.1, 8, 6), this.warmLight);
        lantern.scale.y = 1.35;
        lantern.position.copy(pole.position).setY(topLandingY + .72);
        group.add(pole, lantern);
      }
    }
    group.userData.terraceDirection = dir;
  }

  private addArcadeRow(group: THREE.Group, heights: number[], y: number, promenade: boolean, plannedDirections: ReadonlySet<Direction>) {
    const rowRunsNorthSouth = heights[0] >= 2 && heights[2] >= 2;
    const facades: Direction[] = rowRunsNorthSouth ? [1, 3] : [0, 2];
    for (const dir of facades) {
      if (heights[dir] > 0) continue;
      if (!plannedDirections.has(dir)) continue;
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
      (group.userData.arcadeDirections ??= []).push(dir);
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
    const chimney = shadow(new THREE.Mesh(new RoundedBoxGeometry(.32, .68, .32, 1, .035), this.dark));
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
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(.56, .3), this.flagMaterial);
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
    const nestGroup = new THREE.Group();
    nestGroup.name = 'time-bird-nest';
    const nest = shadow(new THREE.Mesh(new THREE.TorusGeometry(.22, .055, 5, 12), this.wood), false);
    nest.name = 'bird-nest';
    nest.position.set(.42, y, .2);
    nest.rotation.x = Math.PI / 2;
    const egg = shadow(new THREE.Mesh(new THREE.SphereGeometry(.055, 7, 5), this.cream), false);
    egg.scale.y = 1.35;
    egg.position.set(.42, y + .05, .2);
    nestGroup.add(nest, egg);
    group.add(nestGroup);
    return nestGroup;
  }

  private addClockFaces(group: THREE.Group, directions: readonly Direction[], y: number) {
    const up = new THREE.Vector3(0, 1, 0);
    const localNormal = new THREE.Vector3(0, 0, 1);
    const cylinderAxis = new THREE.Vector3(0, 1, 0);

    for (const direction of directions) {
      const [dx, dz] = CARDINALS[direction];
      const outward = new THREE.Vector3(dx, 0, dz);
      const lateral = new THREE.Vector3(dz, 0, -dx);
      const center = outward.clone().multiplyScalar(CELL * .515).setY(y);
      const cylinderRotation = new THREE.Quaternion().setFromUnitVectors(cylinderAxis, outward);
      const planeRotation = new THREE.Quaternion().setFromUnitVectors(localNormal, outward);

      const bezel = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.325, .325, .055, 24), this.dark), false);
      bezel.position.copy(center);
      bezel.quaternion.copy(cylinderRotation);
      const face = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.276, .276, .061, 24), this.cream), false);
      face.name = 'clock-face';
      face.position.copy(center).addScaledVector(outward, .032);
      face.quaternion.copy(cylinderRotation);
      group.add(bezel, face);

      for (let index = 0; index < 12; index++) {
        const angle = index / 12 * Math.PI * 2;
        const cardinalMark = index % 3 === 0;
        const mark = shadow(new THREE.Mesh(new THREE.BoxGeometry(cardinalMark ? .032 : .022, cardinalMark ? .07 : .045, .022), this.dark), false);
        mark.position.copy(center)
          .addScaledVector(up, Math.cos(angle) * .218)
          .addScaledVector(lateral, Math.sin(angle) * .218)
          .addScaledVector(outward, .07);
        const turn = new THREE.Quaternion().setFromAxisAngle(outward, -angle);
        mark.quaternion.copy(turn).multiply(planeRotation);
        group.add(mark);
      }

      const addHand = (length: number, width: number, angle: number) => {
        const geometry = new THREE.BoxGeometry(width, length, .026);
        geometry.translate(0, length * .42, 0);
        const hand = shadow(new THREE.Mesh(geometry, this.dark), false);
        hand.position.copy(center).addScaledVector(outward, .084);
        const turn = new THREE.Quaternion().setFromAxisAngle(outward, -angle);
        hand.quaternion.copy(turn).multiply(planeRotation);
        group.add(hand);
      };
      addHand(.19, .03, -.82);
      addHand(.245, .024, .48);
      const hub = shadow(new THREE.Mesh(new THREE.SphereGeometry(.043, 8, 6), this.dark), false);
      hub.position.copy(center).addScaledVector(outward, .1);
      group.add(hub);
    }
    group.userData.clockFaceDirections = directions;
    group.userData.clockFaceCount = directions.length;
  }

  private addRoofGarden(group: THREE.Group, y: number, cell: Cell) {
    const planter = shadow(new THREE.Mesh(new RoundedBoxGeometry(.82, .24, .56, 1, .05), this.stone));
    planter.position.set(-.3, y + .12, .1);
    group.add(planter);
    this.addArchitecturalTree(group, -.3, .1, y + .24, .72, 'rooftop');
    for (let i = 0; i < 2; i++) {
      const plant = shadow(new THREE.Mesh(new THREE.SphereGeometry(.17 + hash(this.seed, cell.x, cell.z, 300 + i) * .08, 7, 5), this.green));
      plant.position.set(-.57 + i * .54, y + .35, .1);
      group.add(plant);
    }
  }

  private addArchitecturalTree(group: THREE.Group, x: number, z: number, baseY: number, scale: number, habitat: 'plaza' | 'rooftop') {
    const trunkHeight = .72 * scale;
    const trunk = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.065 * scale, .1 * scale, trunkHeight, 7), this.wood));
    trunk.position.set(x, baseY + trunkHeight / 2, z);
    group.add(trunk);
    for (let index = 0; index < 3; index++) {
      const angle = index * Math.PI * 2 / 3 + hash(this.seed, group.userData.cellX as number, group.userData.cellZ as number, 2310) * Math.PI;
      const crown = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry((.29 + index % 2 * .045) * scale, 1), this.leaf));
      crown.position.set(
        x + Math.cos(angle) * .19 * scale,
        baseY + trunkHeight + (.12 + index % 2 * .16) * scale,
        z + Math.sin(angle) * .19 * scale,
      );
      group.add(crown);
      if (this.discoveries.has('blossom-tide') && index === 1) {
        const blooms = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(.13 * scale, 1), this.blossom), false);
        blooms.position.copy(crown.position).add(new THREE.Vector3(.1 * scale, .12 * scale, -.06 * scale));
        group.add(blooms);
      }
    }
    (group.userData.architecturalTrees ??= []).push({ x, y: baseY + .06, z, habitat });
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
    group.userData.festivalRibbonDirection = dir;
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
    group.userData.finaleLanternDirection = dir;
  }

  private harborLanternAnchor(lantern: HarborLanternDefinition): HarborLanternWorldAnchor | null {
    const cells = [...this.cells.values()];
    if (!cells.length) return null;
    const ordered = cells.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || b.height - a.height || a.z - b.z || a.x - b.x);
    const outward = (cell: Cell, y: number, side = 0, preferredDirection?: Direction): HarborLanternWorldAnchor => {
      const direction = preferredDirection ?? this.doorDirection(cell);
      const [dx, dz] = CARDINALS[direction];
      const lateral = new THREE.Vector3(dz, 0, -dx);
      return {
        id: lantern.id,
        x: cell.x * CELL + dx * .9 + lateral.x * side,
        y,
        z: cell.z * CELL + dz * .9 + lateral.z * side,
      };
    };
    const businessCell = (...types: BusinessType[]) => {
      const business = [...this.businesses.values()].find((candidate) => types.includes(candidate.type));
      if (!business) return null;
      const [x, z] = business.cellKey.split(',').map(Number);
      return this.get(x, z) ?? null;
    };
    const tower = [...ordered]
      .filter((cell) => cell.height >= 3 && CARDINALS.filter(([dx, dz]) => this.get(cell.x + dx, cell.z + dz)).length <= 1)
      .sort((a, b) => b.height - a.height || Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z))[0]
      ?? [...ordered].sort((a, b) => b.height - a.height)[0];

    if (lantern.anchor === 'courtyard') {
      for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
        if (!this.get(x, z) && courtyardFeature(x, z, this.cells)) return { id: lantern.id, x: x * CELL, y: .08, z: z * CELL };
      }
    }
    if (lantern.anchor === 'table') {
      const cell = businessCell('cafe', 'inn') ?? ordered[0];
      return outward(cell, .12, -.36);
    }
    if (lantern.anchor === 'lookout') return outward(tower, .42 + tower.height * FLOOR, -.42);
    if (lantern.anchor === 'clock-tower') return outward(tower, .42 + tower.height * FLOOR, .42);
    if (lantern.anchor === 'ferry-dock') {
      const inn = businessCell('inn');
      if (inn) {
        const dockDirection = CARDINALS.findIndex((_offset, direction) => hasDock(inn, direction as Direction, this.seed));
        return outward(inn, .04, .38, dockDirection >= 0 ? dockDirection as Direction : undefined);
      }
      for (const cell of ordered) {
        const dockDirection = CARDINALS.findIndex((_offset, direction) => hasDock(cell, direction as Direction, this.seed));
        if (dockDirection >= 0) return outward(cell, .04, .38, dockDirection as Direction);
      }
    }
    return outward(ordered[0], .12);
  }

  private createHarborLantern(id: HarborLanternId) {
    const group = new THREE.Group();
    group.name = `earned-lantern-${id}`;
    group.userData.harborLanternId = id;
    const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .035, .78, 7), this.dark), false);
    post.position.y = .39;
    const arm = shadow(new THREE.Mesh(new THREE.BoxGeometry(.34, .035, .035), this.dark), false);
    arm.position.set(.15, .75, 0);
    const cord = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .18, 5), this.metal), false);
    cord.position.set(.3, .66, 0);
    const hanging = new THREE.Group();
    hanging.position.set(.3, .54, 0);
    const bodyGeometry = id === 'table'
      ? new THREE.BoxGeometry(.22, .28, .18)
      : id === 'chorus'
        ? new THREE.OctahedronGeometry(.17, 0)
        : id === 'clock'
          ? new THREE.CylinderGeometry(.14, .17, .28, 8)
          : id === 'welcome'
            ? new THREE.CylinderGeometry(.12, .15, .34, 7)
            : new THREE.SphereGeometry(.15, 9, 7);
    const body = shadow(new THREE.Mesh(bodyGeometry, this.warmLight), false);
    if (id === 'blossom') body.scale.set(1.18, .9, 1.18);
    if (id === 'chorus') body.rotation.z = Math.PI / 4;
    const cap = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.1, .12, .035, 7), this.metal), false);
    cap.position.y = .16;
    const tassel = shadow(new THREE.Mesh(new THREE.ConeGeometry(.035, .16, 6), this.flagMaterial), false);
    tassel.position.y = -.22;
    tassel.rotation.z = Math.PI;
    hanging.add(body, cap, tassel);
    if (id === 'clock') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(.18, .015, 5, 16), this.metal);
      ring.rotation.y = Math.PI / 2;
      hanging.add(ring);
    }
    if (id === 'blossom') {
      for (let index = 0; index < 4; index++) {
        const petal = new THREE.Mesh(new THREE.SphereGeometry(.045, 6, 5), this.blossom);
        const angle = index / 4 * Math.PI * 2;
        petal.position.set(Math.cos(angle) * .14, Math.sin(angle) * .14, .13);
        hanging.add(petal);
      }
    }
    group.userData.lanternBody = hanging;
    group.add(post, arm, cord, hanging);
    return group;
  }

  private syncHarborLanterns() {
    for (const lantern of [...this.harborLanternRoot.children]) {
      this.harborLanternRoot.remove(lantern);
      dispose(lantern);
    }
    this.harborLanternAnchors = [];
    const geometries: THREE.BufferGeometry[] = [];
    for (const lantern of harborLanternStates(this.discoveries)) {
      if (lantern.state !== 'lit') continue;
      const anchor = this.harborLanternAnchor(lantern);
      if (!anchor) continue;
      const model = this.createHarborLantern(lantern.id);
      model.position.set(anchor.x, anchor.y, anchor.z);
      model.rotation.y = hash(this.seed, Math.round(anchor.x * 10), Math.round(anchor.z * 10), 7310) * Math.PI * 2;
      model.updateMatrixWorld(true);
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        const geometry = object.geometry.index ? object.geometry.toNonIndexed() : object.geometry.clone();
        geometry.applyMatrix4(object.matrixWorld);
        geometries.push(geometry);
      });
      dispose(model);
      const hitTarget = new HarborLanternHitTarget(lantern.id);
      hitTarget.position.set(anchor.x, anchor.y + .44, anchor.z);
      this.harborLanternRoot.add(hitTarget);
      this.harborLanternAnchors.push(anchor);
    }
    const merged = geometries.length ? mergeGeometries(geometries, false) : null;
    for (const geometry of geometries) geometry.dispose();
    if (merged) {
      const batch = shadow(new THREE.Mesh(merged, this.warmLight), false);
      batch.name = 'earned-harbor-lantern-batch';
      this.harborLanternRoot.add(batch);
    }
  }

  private syncNightLights() {
    const lightCells = [...this.businesses.values()].slice(0, 5).map((business) => business.cellKey);
    if (this.discoveries.has('lantern-finale') && this.lanternFinaleRevealed) {
      for (const cell of this.cells.values()) {
        if (lightCells.length >= 9) break;
        if (hash(this.seed, cell.x, cell.z, 1950) > .72) lightCells.push(keyOf(cell.x, cell.z));
      }
    }
    const positions: number[] = [];
    for (const cellKey of new Set(lightCells)) {
      const [x, z] = cellKey.split(',').map(Number);
      const cell = this.get(x, z);
      if (!cell) continue;
      positions.push(x * CELL, Math.min(2.4, .9 + cell.height * .65), z * CELL);
    }
    for (const sockets of this.placeLandmarks.values()) for (const landmark of sockets) {
      if (landmark.kind === 'lantern-theatre') positions.push(landmark.x * CELL + CELL / 2, 1.18, landmark.z * CELL + CELL / 2);
      if (landmark.kind === 'tide-bell' || landmark.kind === 'star-dial') {
        const cell = this.get(landmark.x, landmark.z);
        positions.push(landmark.x * CELL, (cell?.height ?? 1) * FLOOR + 1.35, landmark.z * CELL);
      }
      if (landmark.kind === 'ferry-house' || landmark.kind === 'reading-loggia') {
        positions.push(landmark.x * CELL, 1.12, landmark.z * CELL);
      }
    }
    for (const landmark of this.confluenceLandmarks.values()) {
      const cell = this.get(landmark.x, landmark.z);
      const height = cell ? cell.height * FLOOR + 1.5 : 1.35;
      if (['festival-pavilion', 'observatory-beacon', 'exchange-pier', 'rain-temple'].includes(landmark.kind)) {
        positions.push(landmark.x * CELL, height, landmark.z * CELL);
      }
    }
    for (const lantern of this.harborLanternAnchors) positions.push(lantern.x, lantern.y + .58, lantern.z);
    this.nightGlowGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    this.nightGlowGeometry.computeBoundingSphere();
    this.nightGlowCount = positions.length / 3;
    this.nightGlows.visible = this.nightGlowCount > 0 && this.nightGlowMaterial.opacity > .01;
  }

  private emptyFeature(x: number, z: number): string | null {
    if (plazaAnchorAt(x, z, this.cells)) return 'harbor plaza';
    const courtyard = courtyardFeature(x, z, this.cells);
    if (courtyard) return courtyard;
    return emptyCrossingFeature(x, z, this.cells);
  }

  private vegetationPlot(x: number, z: number) {
    return this.isBuildable(x, z) ? vegetationPlotFeature(x, z, this.cells, this.seed) : null;
  }

  private shouldBuildEmptyAt(x: number, z: number) {
    return Boolean(this.emptyFeature(x, z) || this.vegetationPlot(x, z));
  }

  private buildFeature(group: THREE.Group, x: number, z: number) {
    const feature = this.emptyFeature(x, z);
    const confluence = this.confluenceAt(x, z);
    if (confluence?.kind === 'exchange-pier') {
      if (feature === 'narrow canal') this.buildCanal(group, x, z);
      else if (feature) this.buildCrossing(group, x, z, feature as EmptyArchitectureFeature);
      this.buildExchangePier(group, x, z);
    }
    else if (confluence?.kind === 'rain-temple') this.buildRainTemple(group);
    else if (confluence?.kind === 'commons-hall') this.buildCommonsHall(group);
    else if (confluence?.kind === 'festival-pavilion') this.buildFestivalPavilion(group);
    else if (this.landmarkAt(x, z, 'lantern-theatre')) this.buildLanternTheatre(group);
    else if (this.landmarkAt(x, z, 'seed-house')) this.buildSeedHouse(group);
    else if (this.landmarkAt(x, z, 'tide-cistern')) this.buildTideCistern(group);
    else if (this.landmarkAt(x, z, 'reading-loggia')) this.buildReadingLoggia(group);
    else if (this.landmarkAt(x, z, 'ferry-house')) {
      if (feature === 'narrow canal') this.buildCanal(group, x, z);
      else if (feature) this.buildCrossing(group, x, z, feature as EmptyArchitectureFeature);
      this.buildFerryHouse(group, x, z);
    }
    else if (this.landmarkAt(x, z, 'market-barge')) {
      if (feature === 'narrow canal') this.buildCanal(group, x, z);
      else if (feature) this.buildCrossing(group, x, z, feature as EmptyArchitectureFeature);
      this.buildMarketBarge(group, x, z);
    }
    else if (feature === 'harbor plaza') this.buildPlaza(group, x, z);
    else if (feature?.includes('courtyard') || feature === 'cloister garden') this.buildCourtyard(group, x, z, feature as CourtyardFeature);
    else if (feature === 'narrow canal') this.buildCanal(group, x, z);
    else if (feature) this.buildCrossing(group, x, z, feature as EmptyArchitectureFeature);
    else {
      const plot = this.vegetationPlot(x, z);
      if (plot) this.buildVegetationPlot(group, plot);
    }
  }

  private buildVegetationPlot(group: THREE.Group, plot: VegetationPlotFeature) {
    const [dx, dz] = CARDINALS[plot.direction];
    const lateral = new THREE.Vector3(dz, 0, -dx);
    const centerX = -dx * .54;
    const centerZ = -dz * .54;
    const addAtStage = (mesh: THREE.Mesh, stage: number) => {
      mesh.userData.vegetationStage = stage;
      mesh.visible = false;
      group.add(mesh);
      return mesh;
    };

    const ledge = shadow(new THREE.Mesh(new RoundedBoxGeometry(plot.direction % 2 ? .92 : 1.48, .16, plot.direction % 2 ? 1.48 : .92, 1, .08), this.stone));
    ledge.position.set(centerX, .04, centerZ);
    addAtStage(ledge, 1);
    const soil = shadow(new THREE.Mesh(new RoundedBoxGeometry(plot.direction % 2 ? .7 : 1.24, .11, plot.direction % 2 ? 1.24 : .7, 1, .07), this.green), false);
    soil.position.set(centerX, .17, centerZ);
    addAtStage(soil, 1);

    const rows = plot.kind === 'sapling' ? 2 : 5;
    for (let index = 0; index < rows; index++) {
      const side = rows === 2 ? (index ? .38 : -.38) : (index - 2) * .2;
      const plant = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(plot.kind === 'flowers' ? .12 : .15, 0), plot.kind === 'flowers' && index % 2 === 0 ? this.blossom : this.leaf), false);
      plant.position.set(centerX + lateral.x * side, .3 + index % 2 * .035, centerZ + lateral.z * side);
      addAtStage(plant, 2);
    }

    if (plot.kind === 'sapling') {
      const trunk = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.055, .085, .68, 7), this.wood));
      trunk.position.set(centerX, .56, centerZ);
      addAtStage(trunk, 3);
      for (let index = 0; index < 3; index++) {
        const angle = index * Math.PI * 2 / 3 + hash(this.seed, plot.owner.x, plot.owner.z, 3420) * Math.PI;
        const crown = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(.3 + index % 2 * .04, 1), this.leaf));
        crown.position.set(centerX + Math.cos(angle) * .18, .98 + index % 2 * .15, centerZ + Math.sin(angle) * .18);
        addAtStage(crown, 3);
      }
      group.userData.vegetationTreeAnchor = { x: centerX, y: .28, z: centerZ };
    }
    group.userData.vegetationPlotBornAt = (plot.owner.foundedAt ?? 0) + plot.delayHours;
    group.userData.vegetationPlotKind = plot.kind;
    group.userData.vegetationStage = -1;
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

  private buildExchangePier(group: THREE.Group, x: number, z: number) {
    const heights = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz)?.height ?? 0);
    const alongX = heights[0] > 0 && heights[2] > 0;
    const red = this.cachedMaterial(this.colorMaterials, 0xb85a4f, .94);
    const teal = this.cachedMaterial(this.colorMaterials, 0x467d7c, .9);
    const pier = new THREE.Group();
    pier.rotation.y = alongX ? 0 : Math.PI / 2;
    const landing = shadow(new THREE.Mesh(new RoundedBoxGeometry(2.1, .16, 1.08, 1, .06), this.wood));
    landing.position.y = .11;
    pier.add(landing);
    for (const xOffset of [-.86, .86]) for (const zOffset of [-.42, .42]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.04, .055, 1.35, 7), this.dark), false);
      post.position.set(xOffset, .78, zOffset);
      pier.add(post);
    }
    for (let stripe = 0; stripe < 5; stripe++) {
      const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(.42, .07, 1.08), stripe % 2 ? this.cream : teal), false);
      roof.position.set((stripe - 2) * .41, 1.47, 0);
      pier.add(roof);
    }
    const cargoTable = shadow(new THREE.Mesh(new THREE.BoxGeometry(.72, .18, .42), this.stone));
    cargoTable.position.set(.5, .36, 0);
    const routeBoard = shadow(new THREE.Mesh(new THREE.BoxGeometry(.5, .58, .06), red), false);
    routeBoard.position.set(-.62, .85, .48);
    pier.add(cargoTable, routeBoard);
    for (const side of [-.18, .18]) {
      const basket = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.1, .14, .17, 8), side < 0 ? this.flagMaterial : teal), false);
      basket.position.set(.5 + side, .54, 0);
      pier.add(basket);
    }
    for (const xOffset of [-.68, .68]) {
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(.09, 8, 6), this.warmLight);
      lantern.position.set(xOffset, 1.23, .42);
      pier.add(lantern);
    }
    group.add(pier);
    group.userData.confluenceLandmark = 'exchange-pier';
  }

  private buildRainTemple(group: THREE.Group) {
    const teal = this.cachedMaterial(this.colorMaterials, 0x4d8582, .9);
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .9, .2, CELL * .9, 1, .16), this.stone));
    platform.position.y = .06;
    group.add(platform);
    for (const radius of [.62, .35]) {
      const basin = shadow(new THREE.Mesh(new THREE.TorusGeometry(radius, .1, 7, 18), radius > .5 ? this.stoneDark : teal));
      basin.rotation.x = Math.PI / 2;
      basin.position.y = .29 + (.62 - radius) * .42;
      group.add(basin);
    }
    const water = new THREE.Mesh(new THREE.CylinderGeometry(.52, .52, .03, 18), this.featureWaterMaterial);
    water.position.y = .3;
    group.add(water);
    for (const x of [-.7, .7]) for (const z of [-.7, .7]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.04, .055, 1.48, 7), this.wood), false);
      post.position.set(x, .86, z);
      group.add(post);
    }
    const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.16, .48, 4, 1, true), this.cream));
    roof.position.y = 1.68;
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
    for (const side of [-.7, .7]) {
      const chain = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, 1.02, 6), this.metal), false);
      chain.position.set(side, 1.12, .54);
      const bloom = new THREE.Mesh(new THREE.OctahedronGeometry(.13, 0), side < 0 ? this.blossom : this.silverLeaf);
      bloom.position.set(side * .45, .55, -.18);
      group.add(chain, bloom);
    }
    group.userData.confluenceLandmark = 'rain-temple';
  }

  private buildCommonsHall(group: THREE.Group) {
    const red = this.cachedMaterial(this.colorMaterials, 0xb85a4f, .94);
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .92, .2, CELL * .92, 1, .12), this.stone));
    platform.position.y = .06;
    group.add(platform);
    for (const x of [-.76, .76]) for (const z of [-.62, .62]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.045, .06, 1.42, 7), this.wood), false);
      post.position.set(x, .84, z);
      group.add(post);
    }
    const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.25, .5, 4), this.cream));
    roof.position.y = 1.67;
    roof.rotation.y = Math.PI / 4;
    roof.scale.z = .82;
    group.add(roof);
    const table = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.25, .16, .58, 1, .06), this.wood));
    table.position.y = .48;
    group.add(table);
    const objects = [red, this.flagMaterial, this.green];
    for (const [index, material] of objects.entries()) {
      const project = index === 2
        ? new THREE.Mesh(new THREE.IcosahedronGeometry(.14, 0), material)
        : new THREE.Mesh(new THREE.BoxGeometry(.28, .08, .22), material);
      project.position.set((index - 1) * .4, .61, 0);
      group.add(project);
    }
    for (const side of [-.55, .55]) {
      const shelf = shadow(new THREE.Mesh(new THREE.BoxGeometry(.42, .64, .16), this.wood), false);
      shelf.position.set(side, .72, .65);
      group.add(shelf);
    }
    group.userData.confluenceLandmark = 'commons-hall';
  }

  private buildFestivalPavilion(group: THREE.Group) {
    const center = CELL / 2;
    const red = this.cachedMaterial(this.colorMaterials, 0xb85a4f, .94);
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .98, .2, CELL * .98, 1, .06), this.stone));
    platform.position.y = .08;
    const stage = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.68, .26, 1.05, 1, .08), this.wood));
    stage.position.set(center, .34, center);
    group.add(platform, stage);
    for (const side of [-.72, .72]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.05, .065, 1.7, 8), this.dark), false);
      post.position.set(center + side, 1.16, center + .34);
      group.add(post);
    }
    const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(1.18, .52, 4), red));
    roof.position.set(center, 1.98, center + .08);
    roof.rotation.y = Math.PI / 4;
    group.add(roof);
    const bell = shadow(new THREE.Mesh(new THREE.ConeGeometry(.18, .3, 10, 1, true), this.cachedMaterial(this.colorMaterials, 0x9b7445, .65)), false);
    bell.position.set(center, 1.5, center + .32);
    bell.rotation.x = Math.PI;
    group.add(bell);
    for (const side of [-.52, 0, .52]) {
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(.1, 9, 7), this.warmLight);
      lantern.position.set(center + side, 1.63, center - .45);
      group.add(lantern);
      const ribbon = new THREE.Mesh(new THREE.PlaneGeometry(.16, .56), side === 0 ? this.flagMaterial : red);
      ribbon.name = `laundry-festival-pavilion-${side}`;
      ribbon.position.set(center + side, 1.22, center - .44);
      group.add(ribbon);
      (group.userData.laundry ??= []).push(ribbon);
    }
    group.userData.confluenceLandmark = 'festival-pavilion';
  }

  private buildFerryHouse(group: THREE.Group, x: number, z: number) {
    const heights = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz)?.height ?? 0);
    const alongX = heights[0] > 0 && heights[2] > 0;
    const teal = this.cachedMaterial(this.colorMaterials, 0x467d7c, .9);
    const shelter = new THREE.Group();
    shelter.rotation.y = alongX ? 0 : Math.PI / 2;
    const landing = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.72, .14, .82, 1, .06), this.wood));
    landing.position.y = .1;
    shelter.add(landing);
    for (const xOffset of [-.66, .66]) for (const zOffset of [-.3, .3]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.035, .05, 1.05, 7), this.dark), false);
      post.position.set(xOffset, .65, zOffset);
      shelter.add(post);
    }
    const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.62, .08, .9), teal), false);
    roof.position.y = 1.2;
    const stripe = shadow(new THREE.Mesh(new THREE.BoxGeometry(.5, .09, .92), this.cream), false);
    stripe.position.y = 1.205;
    shelter.add(roof, stripe);
    for (const side of [-.42, .42]) {
      const bench = shadow(new THREE.Mesh(new THREE.BoxGeometry(.55, .11, .22), this.cream), false);
      bench.position.set(side, .34, 0);
      shelter.add(bench);
    }
    const board = shadow(new THREE.Mesh(new THREE.BoxGeometry(.42, .46, .05), teal), false);
    board.position.set(-.48, .78, .33);
    const route = shadow(new THREE.Mesh(new THREE.BoxGeometry(.27, .035, .06), this.flagMaterial), false);
    route.position.set(-.48, .8, .365);
    shelter.add(board, route);
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(.08, 8, 6), this.warmLight);
    lantern.position.set(.48, .92, .32);
    shelter.add(lantern);
    group.add(shelter);
    group.userData.placeLandmark = 'ferry-house';
  }

  private buildTideCistern(group: THREE.Group) {
    const teal = this.cachedMaterial(this.colorMaterials, 0x4d8582, .92);
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .86, .18, CELL * .86, 1, .16), this.stone));
    platform.position.y = .05;
    const moss = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.76, .8, .1, 14), this.green), false);
    moss.position.y = .18;
    const basin = shadow(new THREE.Mesh(new THREE.TorusGeometry(.58, .14, 8, 18), this.stoneDark));
    basin.rotation.x = Math.PI / 2;
    basin.position.y = .31;
    const water = new THREE.Mesh(new THREE.CylinderGeometry(.51, .51, .035, 18), this.featureWaterMaterial);
    water.position.y = .32;
    group.add(platform, moss, basin, water);
    for (const x of [-.67, .67]) for (const z of [-.67, .67]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.035, .045, 1.28, 7), this.wood), false);
      post.position.set(x, .78, z);
      group.add(post);
    }
    for (const side of [-.67, .67]) {
      const chain = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.017, .017, .86, 6), this.metal), false);
      chain.position.set(side, 1.12, .42);
      const jar = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.12, .18, .3, 9), teal), false);
      jar.position.set(side, .35, .56);
      group.add(chain, jar);
    }
    const beam = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.5, .09, .12), this.cream), false);
    beam.position.set(0, 1.42, .62);
    group.add(beam);
    group.userData.placeLandmark = 'tide-cistern';
  }

  private buildReadingLoggia(group: THREE.Group) {
    const red = this.cachedMaterial(this.colorMaterials, 0xb85a4f, .94);
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .86, .18, CELL * .86, 1, .16), this.stone));
    platform.position.y = .05;
    const garden = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.22, .1, .72, 1, .12), this.green), false);
    garden.position.set(0, .18, -.46);
    group.add(platform, garden);
    for (const x of [-.7, -.23, .23, .7]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, 1.12, 7), this.wood), false);
      post.position.set(x, .73, .5);
      group.add(post);
    }
    const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.72, .08, .78), this.cream), false);
    roof.position.set(0, 1.31, .45);
    group.add(roof);
    const shelf = shadow(new THREE.Mesh(new THREE.BoxGeometry(1.2, .48, .14), this.wood), false);
    shelf.position.set(0, .62, .7);
    group.add(shelf);
    for (let index = 0; index < 7; index++) {
      const book = shadow(new THREE.Mesh(new THREE.BoxGeometry(.1, .28 + index % 3 * .04, .16), index % 3 === 0 ? red : index % 2 ? this.flagMaterial : this.cream), false);
      book.position.set((index - 3) * .15, .66, .61);
      group.add(book);
    }
    for (const x of [-.42, .42]) {
      const stool = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.15, .18, .19, 8), this.wood), false);
      stool.position.set(x, .3, .18);
      group.add(stool);
    }
    const lantern = new THREE.Mesh(new THREE.SphereGeometry(.085, 8, 6), this.warmLight);
    lantern.position.set(0, 1.12, .42);
    group.add(lantern);
    group.userData.placeLandmark = 'reading-loggia';
  }

  private buildMarketBarge(group: THREE.Group, x: number, z: number) {
    const heights = CARDINALS.map(([dx, dz]) => this.get(x + dx, z + dz)?.height ?? 0);
    const alongX = heights[0] > 0 && heights[2] > 0;
    const vessel = new THREE.Group();
    vessel.name = 'market-barge-model';
    vessel.rotation.y = alongX ? 0 : Math.PI / 2;
    const marketRed = this.cachedMaterial(this.colorMaterials, 0xb85c55, .94);
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-.82, -.23);
    hullShape.lineTo(-.64, -.35);
    hullShape.lineTo(.58, -.35);
    hullShape.lineTo(.82, 0);
    hullShape.lineTo(.58, .35);
    hullShape.lineTo(-.64, .35);
    hullShape.lineTo(-.82, .23);
    hullShape.closePath();
    const hullGeometry = new THREE.ExtrudeGeometry(hullShape, {
      depth: .3, steps: 1, bevelEnabled: true, bevelSegments: 1, bevelSize: .035, bevelThickness: .035,
    });
    hullGeometry.rotateX(-Math.PI / 2);
    const hull = shadow(new THREE.Mesh(hullGeometry, this.wood));
    hull.position.y = -.2;
    const deck = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.38, .1, .56, 1, .06), this.cream));
    deck.position.y = .14;
    vessel.add(hull, deck);
    for (const side of [-1, 1]) {
      const rubRail = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.3, 6), this.dark), false);
      rubRail.rotation.z = Math.PI / 2;
      rubRail.position.set(-.03, .07, side * .34);
      vessel.add(rubRail);
      for (const end of [-.54, .54]) {
        const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.03, .04, .9, 6), this.dark), false);
        post.position.set(end, .65, side * .26);
        vessel.add(post);
      }
    }
    for (let stripe = 0; stripe < 3; stripe++) for (const side of [-1, 1]) {
      const canopy = shadow(new THREE.Mesh(
        new THREE.BoxGeometry(.42, .045, .4),
        stripe % 2 ? this.cream : marketRed,
      ), false);
      canopy.position.set((stripe - 1) * .4, 1.12, side * .19);
      canopy.rotation.x = side * .29;
      vessel.add(canopy);
    }
    const ridge = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.3, 6), this.dark), false);
    ridge.rotation.z = Math.PI / 2;
    ridge.position.y = 1.18;
    vessel.add(ridge);
    const cargo = [
      [-.4, .29, .12, this.green],
      [0, .29, .13, this.stoneDark],
      [.4, .29, -.12, marketRed],
    ] as const;
    for (const [cargoX, cargoY, cargoZ, material] of cargo) {
      const basket = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.12, .16, .18, 8), material), false);
      basket.position.set(cargoX, cargoY, cargoZ);
      const rim = shadow(new THREE.Mesh(new THREE.TorusGeometry(.13, .015, 5, 10), this.dark), false);
      rim.position.set(cargoX, cargoY + .1, cargoZ);
      rim.rotation.x = Math.PI / 2;
      vessel.add(basket, rim);
    }
    const tiller = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.018, .024, .48, 5), this.dark), false);
    tiller.position.set(-.72, .34, 0);
    tiller.rotation.z = -.58;
    const bowLantern = new THREE.Mesh(new THREE.SphereGeometry(.06, 7, 5), this.warmLight);
    bowLantern.position.set(.7, .32, 0);
    vessel.add(tiller, bowLantern);
    const addBargePerson = (name: string, px: number, pz: number, material: THREE.Material, scale = 1) => {
      const body = new THREE.CapsuleGeometry(.045 * scale, .105 * scale, 2, 6);
      body.translate(0, .15 * scale, 0);
      const head = new THREE.SphereGeometry(.052 * scale, 7, 5);
      head.translate(0, .295 * scale, 0);
      const hat = new THREE.ConeGeometry(.09 * scale, .045 * scale, 7);
      hat.translate(0, .36 * scale, 0);
      const personGeometry = mergeGeometries([body, head, hat], false);
      body.dispose();
      head.dispose();
      hat.dispose();
      if (!personGeometry) return;
      const person = shadow(new THREE.Mesh(personGeometry, material), false);
      person.name = name;
      person.userData.bargePerson = true;
      person.position.set(px, .19, pz);
      vessel.add(person);
    };
    addBargePerson('market-barge-vendor', -.58, -.16, marketRed, .9);
    addBargePerson('market-barge-shopper', .56, .16, this.green, .82);
    group.add(vessel);
    group.userData.placeLandmark = 'market-barge';
  }

  private buildSeedHouse(group: THREE.Group) {
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .86, .2, CELL * .86, 1, .16), this.stone));
    platform.position.y = .05;
    const bed = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.18, .16, .72, 1, .08), this.green), false);
    bed.position.y = .21;
    group.add(platform, bed);
    for (const x of [-.55, .55]) for (const z of [-.48, .48]) {
      const post = shadow(new THREE.Mesh(new THREE.BoxGeometry(.055, 1.18, .055), this.wood), false);
      post.position.set(x, .87, z);
      group.add(post);
    }
    for (const side of [-1, 1]) {
      const roof = shadow(new THREE.Mesh(new THREE.BoxGeometry(.82, .045, 1.18), this.glass), false);
      roof.position.set(side * .31, 1.55, 0);
      roof.rotation.z = side * .48;
      group.add(roof);
    }
    for (const x of [-.38, 0, .38]) {
      const sprout = shadow(new THREE.Mesh(new THREE.IcosahedronGeometry(.16, 0), x === 0 ? this.blossom : this.leaf), false);
      sprout.position.set(x, .43 + Math.abs(x) * .08, 0);
      group.add(sprout);
    }
    group.userData.placeLandmark = 'seed-house';
  }

  private buildLanternTheatre(group: THREE.Group) {
    const center = CELL / 2;
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .96, .18, CELL * .96, 1, .06), this.stone));
    platform.position.y = .08;
    const stage = shadow(new THREE.Mesh(new RoundedBoxGeometry(1.4, .24, .9, 1, .08), this.wood));
    stage.position.set(center, .3, center);
    group.add(platform, stage);
    for (const side of [-.58, .58]) {
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.045, .055, 1.18, 7), this.dark), false);
      post.position.set(center + side, .92, center + .28);
      const lantern = new THREE.Mesh(new THREE.SphereGeometry(.105, 9, 7), this.warmLight);
      lantern.scale.y = 1.35;
      lantern.position.set(center + side, 1.21, center + .28);
      group.add(post, lantern);
    }
    const roof = shadow(new THREE.Mesh(new THREE.ConeGeometry(.92, .42, 4), this.cream));
    roof.position.set(center, 1.54, center + .1);
    roof.rotation.y = Math.PI / 4;
    const screen = shadow(new THREE.Mesh(new THREE.PlaneGeometry(.84, .56), this.flagMaterial), false);
    screen.position.set(center, .86, center + .46);
    screen.rotation.y = Math.PI;
    group.add(roof, screen);
    group.userData.placeLandmark = 'lantern-theatre';
  }

  private buildPlaza(group: THREE.Group, x: number, z: number) {
    const anchor = plazaAnchorAt(x, z, this.cells);
    if (!anchor) return;
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .96, .18, CELL * .96, 1, .06), this.stone));
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
      const water = new THREE.Mesh(new THREE.CylinderGeometry(.42, .42, .025, 16), this.featureWaterMaterial);
      water.position.set(CELL / 2, .375, CELL / 2);
      const post = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.07, .1, .65, 9), this.stone));
      post.position.set(CELL / 2, .62, CELL / 2);
      group.add(basin, water, post);
    }
    const relativeX = x - anchor.x;
    const relativeZ = z - anchor.z;
    if (relativeX === relativeZ) {
      const treeX = relativeX === 0 ? -.72 : .72;
      const treeZ = relativeZ === 0 ? -.72 : .72;
      const planter = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.34, .4, .18, 12), this.stoneDark));
      planter.position.set(treeX, .27, treeZ);
      const soil = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.3, .3, .025, 12), this.green), false);
      soil.position.set(treeX, .372, treeZ);
      group.add(planter, soil);
      this.addArchitecturalTree(group, treeX, treeZ, .385, 1.08, 'plaza');
    }
  }

  private buildCourtyard(group: THREE.Group, x: number, z: number, feature: CourtyardFeature) {
    const platform = shadow(new THREE.Mesh(new RoundedBoxGeometry(CELL * .83, .2, CELL * .83, 1, .18), this.stone));
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
    const shadeSeats = new THREE.Group();
    shadeSeats.name = 'shade-seating';
    for (const zOffset of [-.62, .62]) {
      const stool = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.17, .2, .2, 8), this.wood), false);
      stool.position.set(.28, .3, zOffset);
      shadeSeats.add(stool);
    }
    shadeSeats.visible = false;
    group.add(shadeSeats);
    group.userData.shadeSeats = shadeSeats;
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
    const y = high ? HIGH_CROSSING_SPAN_Y : FLOOR * 1.42;
    const walls = this.cachedMaterial(this.wallMaterials, pick(WALL_COLORS, hash(this.seed, x, z, 500)), .9);
    const span = shadow(new THREE.Mesh(new RoundedBoxGeometry(northSouth ? 1.25 : CELL * 1.08, .58, northSouth ? CELL * 1.08 : 1.25, 1, .16), walls));
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
      const ladderHeight = HIGH_CROSSING_WALK_Y - GROUND_WALK_Y;
      const ladderCenterY = (HIGH_CROSSING_WALK_Y + GROUND_WALK_Y) / 2;
      const rungCount = Math.ceil(ladderHeight / .26);
      for (const end of [-1, 1]) {
        for (const side of [-1, 1]) {
          const upright = shadow(new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, ladderHeight, 6), this.metal), false);
          upright.position.set(
            northSouth ? side * .18 : end * (CELL - QUAY_PATH_OFFSET),
            ladderCenterY,
            northSouth ? end * (CELL - QUAY_PATH_OFFSET) : side * .18,
          );
          group.add(upright);
        }
        for (let rung = 0; rung < rungCount; rung++) {
          const step = shadow(new THREE.Mesh(new THREE.BoxGeometry(northSouth ? .42 : .045, .035, northSouth ? .045 : .42), this.wood), false);
          step.position.set(
            northSouth ? 0 : end * (CELL - QUAY_PATH_OFFSET),
            THREE.MathUtils.lerp(GROUND_WALK_Y + .12, HIGH_CROSSING_WALK_Y - .08, rung / (rungCount - 1)),
            northSouth ? end * (CELL - QUAY_PATH_OFFSET) : 0,
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
