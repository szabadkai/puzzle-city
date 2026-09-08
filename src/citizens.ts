import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { businessLabel, businessOccupation, businessProsperityTier, isBusinessOpen } from './businesses';
import { CARDINALS, type BusinessSave, type BusinessType, type Cell, type CitizenAgeGroup, type CitizenSave, type ConfluenceId, type CraftGood, type FormationId, type PlaceIdentityId, keyOf } from './types';
import { hash, pick } from './random';
import { findPlazaAnchors } from './topology';
import {
  arcadeFeature, isRoofAccessCell, isWalkableRoof, roofAccessDirection, roofCourtFeature, walkableSteppedTerrace,
} from './architecture';
import {
  CELL_SIZE, FLOOR_HEIGHT, GROUND_WALK_Y, HIGH_CROSSING_WALK_Y, QUAY_PATH_OFFSET,
  TERRACE_STEP_COUNT, terraceStepOutward, terraceStepWalkY, roofWalkY,
} from './spatial';
import { hasDock } from './water';
import { detectFormations, FORMATION_BY_ID, formationGatheringActivity } from './formations';
import { detectPlaceIdentities, PLACE_IDENTITY_BY_ID, placeIdentityActivity, placeLandmarkSocket } from './place-identities';
import { CONFLUENCE_BY_ID, confluenceActivity, confluenceLandmarkSocket, confluenceSupersedesPlace, detectConfluences } from './confluences';

const CELL = CELL_SIZE;
const FLOOR = FLOOR_HEIGHT;
const EDGE = CELL / 2;
const WALK_OUT = QUAY_PATH_OFFSET;
const WALK_Y = GROUND_WALK_Y;
const BRIDGE_Y = HIGH_CROSSING_WALK_Y;
const NAMES = ['Mei', 'Ren', 'Aiko', 'Hana', 'Jun', 'Mina', 'Sora', 'Tomo', 'Yuna', 'Bo', 'Kiko', 'Nori', 'Aya', 'Kenji', 'Momo', 'Lin', 'Haru', 'Emi'];
const TRAITS = ['sociable', 'quiet', 'ambitious', 'curious', 'artistic', 'industrious', 'dreamy', 'patient', 'adventurous'];
const OCCUPATIONS = ['Baker', 'Fisher', 'Gardener', 'Teacher', 'Bookbinder', 'Caretaker', 'Cartographer', 'Cook'];
/** Tunic colours. `CitizenSave.color` indexes this list, so only append to it. */
const TUNICS = [0xc9564d, 0xd99a42, 0x457b78, 0x536c92, 0x8a5a8f, 0xa8b36a, 0xe0c9a3, 0x3d4a5c, 0xcf7a5a, 0x6e9e8e];
const TROUSERS = [0x3f3432, 0x2e3440, 0x5a4a3a, 0x6b6f77, 0x8c7b64];
const SKINS = [0xf1cfae, 0xd9a47c, 0xc48a5f, 0xa66b45, 0x7d4a2e];
const HAIRS = [0x2a2321, 0x3f3432, 0x5a3a26, 0x8a5a3c];
const ELDER_HAIRS = [0x9a9a96, 0xe8e2d6];
const MAX_RENDERED_CITIZENS = 512;

/** Skin, hair, and straw-hat colours for figures that do not carry their own look. */
export const FIGURE_SKIN = 0xd9a47c;
export const FIGURE_DARK = 0x3f3432;
export const FIGURE_HAT = 0xc79d58;
const FIGURE_SHOE = 0x2a2321;
const FIGURE_CAP = 0xece6d8;
const FIGURE_WOOD = 0x6b4a2e;
const FIGURE_UMBRELLA = 0xb8463f;
/** Standing height of a figure at scale 1, feet to hair. */
export const FIGURE_HEIGHT = .61;
const TUNIC_GEOMETRY = new THREE.CapsuleGeometry(.09, .16, 3, 7);
const HEAD_GEOMETRY = new THREE.SphereGeometry(.09, 10, 8);
const LEG_GEOMETRY = new THREE.CylinderGeometry(.022, .027, .17, 6);
const SHOE_GEOMETRY = new THREE.BoxGeometry(.05, .03, .08);
const SLEEVE_GEOMETRY = new THREE.CylinderGeometry(.021, .025, .14, 6);
const HAND_GEOMETRY = new THREE.SphereGeometry(.024, 6, 5);
const HAT_GEOMETRY = new THREE.ConeGeometry(.145, .065, 12);
const CAP_GEOMETRY = new THREE.CylinderGeometry(.078, .088, .05, 10);
const APRON_GEOMETRY = new THREE.BoxGeometry(.13, .17, .02);
const PACK_GEOMETRY = new THREE.BoxGeometry(.09, .1, .06);
const STICK_GEOMETRY = new THREE.CylinderGeometry(.008, .011, .4, 5);
const LANTERN_GEOMETRY = new THREE.BoxGeometry(.05, .07, .05);
const UMBRELLA_GEOMETRY = new THREE.ConeGeometry(.17, .07, 9, 1, true);
const CARGO_GEOMETRY = new THREE.BoxGeometry(.2, .16, .18);
const SHADOW_GEOMETRY = new THREE.CircleGeometry(.17, 14);

function capHair() {
  return new THREE.SphereGeometry(.094, 9, 6, 0, Math.PI * 2, 0, Math.PI * .48);
}

function cropHair() {
  return new THREE.SphereGeometry(.092, 9, 5, 0, Math.PI * 2, 0, Math.PI * .4);
}

/** A cap with a curtain over the back half of the head. The sphere's back half is phi from pi to two pi. */
function bobHair() {
  const curtain = new THREE.SphereGeometry(.097, 9, 5, Math.PI, Math.PI, Math.PI * .4, Math.PI * .3);
  return mergeGeometries([capHair(), curtain], false)!;
}

function bunHair() {
  const bun = new THREE.SphereGeometry(.036, 7, 6);
  bun.translate(0, .06, -.08);
  return mergeGeometries([capHair(), bun], false)!;
}

const HAIR_GEOMETRIES = [capHair(), cropHair(), bobHair(), bunHair()];

/** Rest-pose part positions. Legs and arms pivot at the hip and shoulder; hair and hats hang from the head. */
const FIGURE_OFFSETS = {
  tunic: .285, head: .5, hair: .015, hat: .11, cap: .085,
  legY: .17, legDrop: -.085, shoeDrop: -.16, shoeForward: .012, legX: .047,
  shoulderY: .4, armX: .115, armLean: .08, sleeveDrop: -.07, handDrop: -.155,
  apron: [0, .23, .09], pack: [-.135, .25, -.01],
} as const;

/** One vertex-coloured material for merged figures, so a whole crew is one draw call. */
export const FIGURE_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .95 });

/** Paints a whole geometry one colour through its vertex colour attribute. */
export function colorGeometry(geometry: THREE.BufferGeometry, hex: number) {
  const color = new THREE.Color(hex);
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let index = 0; index < count; index++) colors.set([color.r, color.g, color.b], index * 3);
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}

/** A citizen-sized sleeve and hand centred on the origin, for figures that pose their own arms. */
export function figureArmGeometry(hex: number, skin = FIGURE_SKIN) {
  const sleeve = colorGeometry(SLEEVE_GEOMETRY.clone(), hex).translate(0, .025, 0);
  const hand = colorGeometry(HAND_GEOMETRY.clone(), skin).translate(0, -.06, 0);
  const merged = mergeGeometries([sleeve, hand], false)!;
  sleeve.dispose();
  hand.dispose();
  return merged;
}

export type FigureOptions = {
  clothes: number; skin?: number; hat?: boolean; arms?: boolean; scale?: number; trousers?: number; hair?: number; hairStyle?: number;
};

/**
 * One merged mesh with citizen proportions: shoes, legs, tunic, sleeves,
 * hands, head, hair, and an optional straw hat. Boats and stalls use it so
 * every person in the town is built to the same scale.
 */
export function buildFigureGeometry({
  clothes, skin = FIGURE_SKIN, hat = false, arms = true, scale = 1, trousers = FIGURE_DARK, hair = FIGURE_DARK, hairStyle = 0,
}: FigureOptions) {
  const parts: THREE.BufferGeometry[] = [];
  const place = (geometry: THREE.BufferGeometry, hex: number, x: number, y: number, z = 0, rotationZ = 0) => {
    const part = colorGeometry(geometry.clone(), hex);
    if (rotationZ) part.rotateZ(rotationZ);
    part.translate(x, y, z);
    parts.push(part);
  };
  const at = FIGURE_OFFSETS;
  for (const side of [-1, 1]) {
    place(LEG_GEOMETRY, trousers, side * at.legX, at.legY + at.legDrop);
    place(SHOE_GEOMETRY, FIGURE_SHOE, side * at.legX, at.legY + at.shoeDrop, at.shoeForward);
  }
  place(TUNIC_GEOMETRY, clothes, 0, at.tunic);
  if (arms) for (const side of [-1, 1]) {
    place(SLEEVE_GEOMETRY, clothes, side * at.armX, at.shoulderY + at.sleeveDrop, 0, side * at.armLean);
    place(HAND_GEOMETRY, skin, side * (at.armX + .012), at.shoulderY + at.handDrop);
  }
  place(HEAD_GEOMETRY, skin, 0, at.head);
  place(HAIR_GEOMETRIES[hairStyle % HAIR_GEOMETRIES.length], hair, 0, at.head + at.hair);
  if (hat) place(HAT_GEOMETRY, FIGURE_HAT, 0, at.head + at.hat);
  const merged = mergeGeometries(parts, false)!;
  for (const part of parts) part.dispose();
  if (scale !== 1) merged.scale(scale, scale, scale);
  return merged;
}

export type FigureLook = {
  tunic: number;
  trousers: number;
  skin: number;
  hair: number;
  hairStyle: number;
  hat: 'none' | 'straw' | 'cap';
  apron: number | null;
  pack: number | null;
  stick: boolean;
};

const APRONS: Record<string, number> = { Cook: 0xe8dfcc, Baker: 0xf0ebe0, Restaurateur: 0xe8dfcc, Potter: 0xb9a48a, Weaver: 0x6d7fa3, Artisan: 0x7a5a3c, Shipwright: 0x7a5a3c, Fishmonger: 0x9fb4b8 };
const PACKS: Record<string, number> = { Cartographer: 0x6b4a2e, Fisher: 0xb08d4a, Bookbinder: 0x5a3a26, Bookseller: 0x5a3a26, Traveler: 0x8a6a48, Miller: 0xd9cdb0 };
const STRAW_HATS = new Set(['Fisher', 'Gardener', 'Traveler', 'Miller']);
const CAPS = new Set(['Baker', 'Cook', 'Restaurateur']);

function citizenIndex(id: string) {
  const index = Number(id.split('-').at(-1));
  return Number.isFinite(index) ? index : 0;
}

/** Everything about a citizen's appearance follows from the save fields, so old saves gain a look without migration. */
export function deriveLook(data: CitizenSave, seed: number): FigureLook {
  const cell = parseCellKey(data.homeKey);
  const index = citizenIndex(data.id);
  const roll = (salt: number) => hash(seed, cell.x * 31 + index, cell.z, salt);
  const elder = data.ageGroup === 'elder';
  const hat = STRAW_HATS.has(data.occupation) ? 'straw' : CAPS.has(data.occupation) ? 'cap' : 'none';
  // A bun would poke through a hat, so covered heads keep to the flat styles.
  const hairStyle = Math.floor(roll(914) * HAIR_GEOMETRIES.length);
  return {
    tunic: TUNICS[data.color % TUNICS.length],
    trousers: pick(TROUSERS, roll(911)),
    skin: pick(SKINS, roll(912)),
    hair: elder ? pick(ELDER_HAIRS, roll(913)) : pick(HAIRS, roll(913)),
    hairStyle: hat === 'none' ? hairStyle : hairStyle % 2,
    hat,
    apron: APRONS[data.occupation] ?? null,
    pack: PACKS[data.occupation] ?? null,
    stick: elder && roll(916) < .6,
  };
}

/** What a figure does with its body while it stands somewhere. Walking is layered on top from the path. */
export type ActivityKind = 'stand' | 'watch' | 'sit' | 'chat' | 'dance' | 'wave' | 'sweep' | 'knead' | 'hammer' | 'cast' | 'sleep';

/** Free text arrives from discoveries and landmarks; this maps the few phrases that imply a body pose. */
function kindFromText(activity: string): ActivityKind {
  if (/dancing|festival|procession|all the lanterns/i.test(activity)) return 'dance';
  if (/sitting|resting|sharing a meal|supper table/i.test(activity)) return 'sit';
  if (/waving|greeting|welcoming|cheering/i.test(activity)) return 'wave';
  if (/watching|looking|remembering|listening/i.test(activity)) return 'watch';
  return 'stand';
}

const OWNER_KINDS: Record<BusinessType, ActivityKind> = {
  bakery: 'knead', cafe: 'sweep', 'flower-shop': 'knead', workshop: 'hammer', bookstore: 'watch', fishmonger: 'knead',
  restaurant: 'sweep', 'tea-house': 'sweep', inn: 'wave', pottery: 'knead', mill: 'hammer', smokehouse: 'knead', weaver: 'knead', shipyard: 'hammer',
};

type Pose = {
  bob: number; lean: number; roll: number; twist: number; headYaw: number; headPitch: number;
  armLX: number; armLZ: number; armRX: number; armRZ: number; legL: number; legR: number; crouch: number;
};

const REST_POSE: Readonly<Pose> = {
  bob: 0, lean: 0, roll: 0, twist: 0, headYaw: 0, headPitch: 0,
  armLX: 0, armLZ: -FIGURE_OFFSETS.armLean, armRX: 0, armRZ: FIGURE_OFFSETS.armLean, legL: 0, legR: 0, crouch: 0,
};
const POSE_KEYS = Object.keys(REST_POSE) as (keyof Pose)[];

type FigureParts = {
  legs: THREE.Object3D[];
  tunic: THREE.Object3D;
  apron: THREE.Object3D;
  pack: THREE.Object3D;
  arms: THREE.Object3D[];
  head: THREE.Object3D;
};

function faceTexture() {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, size, size);
  // Sphere UVs put the forward direction (+z) at u = .25, and v counts up from the chin.
  context.fillStyle = '#2a2321';
  for (const offset of [-.055, .055]) {
    context.beginPath();
    context.ellipse((.25 + offset) * size, (1 - .545) * size, 1.7, 2.3, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.fillStyle = '#a8564a';
  context.beginPath();
  context.ellipse(.25 * size, (1 - .455) * size, 1.6, .8, 0, 0, Math.PI * 2);
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

/** One instanced batch per body part. Tinted batches take their colour per citizen through `instanceColor`. */
function createFigureBatches() {
  const tinted = (map?: THREE.Texture) => new THREE.MeshStandardMaterial(map ? { roughness: .95, map } : { roughness: .95 });
  const fixed = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 1 });
  const batch = (geometry: THREE.BufferGeometry, material: THREE.Material, name: string, perCitizen = 1, tint = false) => {
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_RENDERED_CITIZENS * perCitizen);
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (tint) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(mesh.instanceMatrix.count * 3).fill(1), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    // Picking measures distance to each citizen instead of raycasting body parts.
    mesh.raycast = () => {};
    return mesh;
  };
  return {
    shadows: batch(SHADOW_GEOMETRY, new THREE.MeshBasicMaterial({ color: 0x14101c, transparent: true, opacity: .5, depthWrite: false }), 'citizen-shadows'),
    shoes: batch(SHOE_GEOMETRY, fixed(FIGURE_SHOE), 'citizen-shoes', 2),
    legs: batch(LEG_GEOMETRY, tinted(), 'citizen-legs', 2, true),
    tunics: batch(TUNIC_GEOMETRY, tinted(), 'citizen-tunics', 1, true),
    aprons: batch(APRON_GEOMETRY, tinted(), 'citizen-aprons', 1, true),
    packs: batch(PACK_GEOMETRY, tinted(), 'citizen-packs', 1, true),
    sleeves: batch(SLEEVE_GEOMETRY, tinted(), 'citizen-sleeves', 2, true),
    hands: batch(HAND_GEOMETRY, tinted(), 'citizen-hands', 2, true),
    heads: batch(HEAD_GEOMETRY, tinted(faceTexture()), 'citizen-heads', 1, true),
    hair: HAIR_GEOMETRIES.map((geometry, index) => batch(geometry, tinted(), `citizen-hair-${index}`, 1, true)),
    straw: batch(HAT_GEOMETRY, fixed(FIGURE_HAT), 'citizen-straw-hats'),
    caps: batch(CAP_GEOMETRY, fixed(FIGURE_CAP), 'citizen-caps'),
    sticks: batch(STICK_GEOMETRY, fixed(FIGURE_WOOD), 'citizen-sticks', 2),
    lanterns: batch(LANTERN_GEOMETRY, new THREE.MeshStandardMaterial({ color: 0xffc46b, emissive: 0xff9a3c, emissiveIntensity: 1.4, roughness: .6 }), 'citizen-lanterns'),
    umbrellas: batch(UMBRELLA_GEOMETRY, new THREE.MeshStandardMaterial({ color: FIGURE_UMBRELLA, roughness: .8, side: THREE.DoubleSide }), 'citizen-umbrellas'),
    cargo: batch(CARGO_GEOMETRY, fixed(0xc49a58), 'citizen-cargo'),
  };
}

const IDLE_VARIANTS = 3;
const WALK_SPEED = .58;
const STRIDE_RATE = 8;

type NavNode = {
  key: string;
  position: THREE.Vector3;
  links: Set<string>;
};

type Citizen = CitizenSave & {
  model: THREE.Group;
  parts: FigureParts;
  look: FigureLook;
  pose: Pose;
  kind: ActivityKind;
  idleVariant: number;
  walkWeight: number;
  danceWeight: number;
  heading: number;
  facePoint: THREE.Vector3 | null;
  lane: number;
  loiterAt: number;
  loiterHome: THREE.Vector3 | null;
  chatLead: boolean;
  path: THREE.Vector3[];
  targetKey: string | null;
  nextDecisionAt: number;
  activity: string;
  stepPhase: number;
  carryingGood: CraftGood | null;
  pendingParcelBusinessId: string | null;
  carryingParcel: boolean;
};

export type CitizenCard = {
  id: string;
  name: string;
  occupation: string;
  home: string;
  likes: string;
  activity: string;
  destination: string;
  relationship: string;
};

export type BusinessVisit = { businessId: string; citizenId: string };

function nodeKey(x: number, z: number, y = WALK_Y) {
  return `${Math.round(x * 100)},${Math.round(y * 100)},${Math.round(z * 100)}`;
}

function parseCellKey(key: string) {
  const [x, z] = key.split(',').map(Number);
  return { x, z };
}

export class NavGraph {
  readonly nodes = new Map<string, NavNode>();
  readonly entrances = new Map<string, string>();
  readonly entranceCells = new Map<string, string>();
  readonly plazas: string[] = [];
  readonly docks: string[] = [];
  readonly rooftops = new Map<string, string>();
  readonly formationPlaces = new Map<string, FormationId>();
  readonly identityPlaces = new Map<string, PlaceIdentityId>();
  readonly identityLandmarkPlaces = new Map<string, PlaceIdentityId>();
  readonly confluencePlaces = new Map<string, ConfluenceId>();
  readonly confluenceLandmarkPlaces = new Map<string, ConfluenceId>();
  private readonly componentByNode = new Map<string, string>();
  private readonly nodesByComponent = new Map<string, NavNode[]>();
  private readonly nodeBuckets = new Map<string, NavNode[]>();
  private readonly cells: Map<string, Cell>;
  private readonly seed: number;

  constructor(cells: Map<string, Cell>, seed: number) {
    this.cells = cells;
    this.seed = seed;
    this.build();
    this.indexNavigation();
    this.indexFormationPlaces();
    this.indexPlaceIdentities();
    this.indexConfluences();
  }

  private indexNavigation() {
    for (const node of this.nodes.values()) {
      const bucketKey = `${Math.floor(node.position.x / CELL)},${Math.floor(node.position.z / CELL)}`;
      const bucket = this.nodeBuckets.get(bucketKey) ?? [];
      bucket.push(node);
      this.nodeBuckets.set(bucketKey, bucket);
    }
    for (const node of this.nodes.values()) {
      if (this.componentByNode.has(node.key)) continue;
      const component = node.key;
      const members: NavNode[] = [];
      const pending = [node.key];
      while (pending.length) {
        const key = pending.pop()!;
        if (this.componentByNode.has(key)) continue;
        this.componentByNode.set(key, component);
        const member = this.nodes.get(key);
        if (!member) continue;
        members.push(member);
        for (const neighbor of member.links) pending.push(neighbor);
      }
      this.nodesByComponent.set(component, members);
    }
  }

  private indexFormationPlaces() {
    for (const occurrence of detectFormations(this.cells)) {
      const definition = FORMATION_BY_ID.get(occurrence.id);
      if (!definition) continue;
      const elevated = definition.family === 'rooftop' || definition.family === 'terrace' || occurrence.id === 'roof-promenade';
      const nearby = [...this.nodes.values()]
        .filter((node) => Math.hypot(node.position.x - occurrence.x * CELL, node.position.z - occurrence.z * CELL) <= CELL * 2.35)
        .filter((node) => elevated ? this.rooftops.has(node.key) : !this.rooftops.has(node.key))
        .sort((a, b) => {
          const distanceA = Math.hypot(a.position.x - occurrence.x * CELL, a.position.z - occurrence.z * CELL);
          const distanceB = Math.hypot(b.position.x - occurrence.x * CELL, b.position.z - occurrence.z * CELL);
          return distanceA - distanceB;
        });
      const representedComponents = new Set<string>();
      for (const node of nearby) {
        const component = this.componentByNode.get(node.key);
        if (!component || representedComponents.has(component)) continue;
        representedComponents.add(component);
        this.formationPlaces.set(node.key, occurrence.id);
        if (representedComponents.size >= 4) break;
      }
    }
  }

  private indexPlaceIdentities() {
    const formations = detectFormations(this.cells);
    const confluences = detectConfluences(formations);
    for (const occurrence of detectPlaceIdentities(formations).filter((place) =>
      !confluences.some((confluence) => confluenceSupersedesPlace(confluence, place)))) {
      const nearby = [...this.nodes.values()]
        .filter((node) => Math.hypot(node.position.x - occurrence.x * CELL, node.position.z - occurrence.z * CELL) <= CELL * 2.8)
        .sort((a, b) => {
          const distanceA = Math.hypot(a.position.x - occurrence.x * CELL, a.position.z - occurrence.z * CELL);
          const distanceB = Math.hypot(b.position.x - occurrence.x * CELL, b.position.z - occurrence.z * CELL);
          return distanceA - distanceB;
        });
      const representedComponents = new Set<string>();
      for (const node of nearby) {
        const component = this.componentByNode.get(node.key);
        if (!component || representedComponents.has(component)) continue;
        representedComponents.add(component);
        this.identityPlaces.set(node.key, occurrence.id);
        if (representedComponents.size >= 4) break;
      }
      const landmark = placeLandmarkSocket(occurrence);
      const elevated = ['roof-hall', 'signal-beacon', 'wind-loom', 'tide-bell', 'post-house', 'star-dial', 'kite-loft'].includes(landmark.kind);
      const landmarkX = landmark.x * CELL + (landmark.kind === 'lantern-theatre' ? CELL / 2 : 0);
      const landmarkZ = landmark.z * CELL + (landmark.kind === 'lantern-theatre' ? CELL / 2 - .48 : 0);
      const allNodes = [...this.nodes.values()];
      const preferredNodes = allNodes.filter((node) => elevated ? this.rooftops.has(node.key) : !this.rooftops.has(node.key));
      const landmarkNode = (preferredNodes.length ? preferredNodes : allNodes)
        .sort((a, b) => {
          const distanceA = Math.hypot(a.position.x - landmarkX, a.position.z - landmarkZ);
          const distanceB = Math.hypot(b.position.x - landmarkX, b.position.z - landmarkZ);
          return distanceA - distanceB;
        })[0];
      if (landmarkNode) {
        this.identityPlaces.set(landmarkNode.key, occurrence.id);
        this.identityLandmarkPlaces.set(landmarkNode.key, occurrence.id);
      }
    }
  }

  private indexConfluences() {
    for (const occurrence of detectConfluences(detectFormations(this.cells))) {
      const nearby = [...this.nodes.values()]
        .filter((node) => Math.hypot(node.position.x - occurrence.x * CELL, node.position.z - occurrence.z * CELL) <= CELL * 3.2)
        .sort((a, b) => {
          const distanceA = Math.hypot(a.position.x - occurrence.x * CELL, a.position.z - occurrence.z * CELL);
          const distanceB = Math.hypot(b.position.x - occurrence.x * CELL, b.position.z - occurrence.z * CELL);
          return distanceA - distanceB;
        });
      const representedComponents = new Set<string>();
      for (const node of nearby) {
        const component = this.componentByNode.get(node.key);
        if (!component || representedComponents.has(component)) continue;
        representedComponents.add(component);
        this.confluencePlaces.set(node.key, occurrence.id);
        if (representedComponents.size >= 5) break;
      }
      const landmark = confluenceLandmarkSocket(occurrence);
      const elevated = ['observatory-beacon', 'banner-house', 'harbor-archive'].includes(landmark.kind);
      const allNodes = [...this.nodes.values()];
      const preferredNodes = allNodes.filter((node) => elevated ? this.rooftops.has(node.key) : !this.rooftops.has(node.key));
      const landmarkNode = (preferredNodes.length ? preferredNodes : allNodes)
        .sort((a, b) => {
          const distanceA = Math.hypot(a.position.x - landmark.x * CELL, a.position.z - landmark.z * CELL);
          const distanceB = Math.hypot(b.position.x - landmark.x * CELL, b.position.z - landmark.z * CELL);
          return distanceA - distanceB;
        })[0];
      if (landmarkNode) {
        this.confluencePlaces.set(landmarkNode.key, occurrence.id);
        this.confluenceLandmarkPlaces.set(landmarkNode.key, occurrence.id);
      }
    }
  }

  private addNode(x: number, z: number, y = WALK_Y) {
    const key = nodeKey(x, z, y);
    if (!this.nodes.has(key)) this.nodes.set(key, { key, position: new THREE.Vector3(x, y, z), links: new Set() });
    return key;
  }

  private connect(a: string, b: string) {
    if (a === b) return;
    this.nodes.get(a)?.links.add(b);
    this.nodes.get(b)?.links.add(a);
  }

  private build() {
    const plazaAnchors = findPlazaAnchors(this.cells);
    const lanternTheatreAnchors = new Set(detectPlaceIdentities(detectFormations(this.cells))
      .filter((identity) => identity.id === 'lantern-square')
      .map((identity) => {
        const landmark = placeLandmarkSocket(identity);
        return keyOf(landmark.x, landmark.z);
      }));
    const plazaCells = new Set<string>();
    for (const anchor of plazaAnchors) {
      plazaCells.add(keyOf(anchor.x, anchor.z));
      plazaCells.add(keyOf(anchor.x + 1, anchor.z));
      plazaCells.add(keyOf(anchor.x, anchor.z + 1));
      plazaCells.add(keyOf(anchor.x + 1, anchor.z + 1));
    }
    for (const cell of this.cells.values()) {
      const open = CARDINALS.map(([dx, dz]) => !this.cells.has(keyOf(cell.x + dx, cell.z + dz)));
      const sides: Array<{ a: string; b: string } | undefined> = [];
      for (let dir = 0; dir < 4; dir++) {
        if (!open[dir]) continue;
        const [dx, dz] = CARDINALS[dir];
        const lx = dz;
        const lz = -dx;
        const centerX = cell.x * CELL + dx * WALK_OUT;
        const centerZ = cell.z * CELL + dz * WALK_OUT;
        const a = this.addNode(centerX + lx * EDGE, centerZ + lz * EDGE);
        const middle = this.addNode(centerX, centerZ);
        const b = this.addNode(centerX - lx * EDGE, centerZ - lz * EDGE);
        if (hasDock(cell, dir, this.seed)) this.docks.push(middle);
        sides[dir] = { a, b };
        this.connect(a, middle);
        this.connect(middle, b);
      }
      for (let dir = 0; dir < 4; dir++) {
        const current = sides[dir];
        const next = sides[(dir + 1) % 4];
        if (current && next) this.connect(current.b, next.a);
      }

      const doorDir = this.doorDirection(cell, open);
      if (doorDir >= 0) {
        const [dx, dz] = CARDINALS[doorDir];
        const entranceKey = this.addNode(cell.x * CELL + dx * WALK_OUT, cell.z * CELL + dz * WALK_OUT);
        this.entrances.set(keyOf(cell.x, cell.z), entranceKey);
        this.entranceCells.set(entranceKey, keyOf(cell.x, cell.z));
      }
    }

    // Courtyards become tiny walkable shortcuts linking their surrounding doors.
    for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
      if (this.cells.has(keyOf(x, z))) continue;
      if (plazaCells.has(keyOf(x, z))) continue;
      const neighbors = CARDINALS.map(([dx, dz]) => this.cells.get(keyOf(x + dx, z + dz)));
      if (neighbors.filter(Boolean).length < 3) continue;
      const center = this.addNode(x * CELL, z * CELL);
      neighbors.forEach((neighbor, dir) => {
        if (!neighbor) return;
        const [dx, dz] = CARDINALS[dir];
        const edge = this.addNode(x * CELL + dx * (CELL - WALK_OUT), z * CELL + dz * (CELL - WALK_OUT));
        this.connect(center, edge);
      });
    }

    for (const anchor of plazaAnchors) {
      const coordinates = [
        [anchor.x, anchor.z], [anchor.x + 1, anchor.z],
        [anchor.x, anchor.z + 1], [anchor.x + 1, anchor.z + 1],
      ] as const;
      const plazaNodes = coordinates.map(([x, z]) => this.addNode(x * CELL, z * CELL));
      this.plazas.push(...plazaNodes);
      this.connect(plazaNodes[0], plazaNodes[1]);
      this.connect(plazaNodes[0], plazaNodes[2]);
      this.connect(plazaNodes[1], plazaNodes[3]);
      this.connect(plazaNodes[2], plazaNodes[3]);
      if (lanternTheatreAnchors.has(keyOf(anchor.x, anchor.z))) {
        const danceX = (anchor.x + .5) * CELL;
        const danceZ = (anchor.z + .5) * CELL - .48;
        const danceNodes = Array.from({ length: 8 }, (_, index) => {
          const angle = index / 8 * Math.PI * 2;
          return this.addNode(danceX + Math.cos(angle) * .62, danceZ + Math.sin(angle) * .62);
        });
        danceNodes.forEach((node, index) => this.connect(node, danceNodes[(index + 1) % danceNodes.length]));
        this.connect(danceNodes[0], plazaNodes[1]);
        this.connect(danceNodes[2], plazaNodes[3]);
        this.connect(danceNodes[4], plazaNodes[2]);
        this.connect(danceNodes[6], plazaNodes[0]);
        this.plazas.push(...danceNodes);
      }
      for (const [x, z] of coordinates) {
        const center = this.addNode(x * CELL, z * CELL);
        CARDINALS.forEach(([dx, dz]) => {
          if (!this.cells.has(keyOf(x + dx, z + dz))) return;
          const edge = this.addNode(x * CELL + dx * (CELL - WALK_OUT), z * CELL + dz * (CELL - WALK_OUT));
          this.connect(center, edge);
        });
      }
    }

    for (let x = -9; x <= 9; x++) for (let z = -9; z <= 9; z++) {
      if (this.cells.has(keyOf(x, z)) || plazaCells.has(keyOf(x, z))) continue;
      const heights = CARDINALS.map(([dx, dz]) => this.cells.get(keyOf(x + dx, z + dz))?.height ?? 0);
      const northSouth = heights[0] >= 3 && heights[2] >= 3 && heights[1] === 0 && heights[3] === 0;
      const eastWest = heights[1] >= 3 && heights[3] >= 3 && heights[0] === 0 && heights[2] === 0;
      if (!northSouth && !eastWest) continue;
      const [ax, az] = northSouth ? [0, -(CELL - WALK_OUT)] : [CELL - WALK_OUT, 0];
      const groundA = this.addNode(x * CELL + ax, z * CELL + az);
      const groundB = this.addNode(x * CELL - ax, z * CELL - az);
      const deckA = this.addNode(x * CELL + ax, z * CELL + az, BRIDGE_Y);
      const deckCenter = this.addNode(x * CELL, z * CELL, BRIDGE_Y);
      const deckB = this.addNode(x * CELL - ax, z * CELL - az, BRIDGE_Y);
      this.connect(groundA, deckA);
      this.connect(deckA, deckCenter);
      this.connect(deckCenter, deckB);
      this.connect(deckB, groundB);
    }

    this.buildRooftops();
  }

  private buildRooftops() {
    const roofNodes = new Map<string, { center: string; edges: string[]; y: number }>();
    for (const cell of this.cells.values()) {
      if (!isWalkableRoof(cell, this.cells)) continue;
      const y = roofWalkY(cell.height);
      const center = this.addNode(cell.x * CELL, cell.z * CELL, y);
      const edges = CARDINALS.map(([dx, dz]) => this.addNode(cell.x * CELL + dx * .68, cell.z * CELL + dz * .68, y));
      edges.forEach((edge) => this.connect(center, edge));
      roofNodes.set(keyOf(cell.x, cell.z), { center, edges, y });
      const feature = roofCourtFeature(cell, this.cells)
        ?? walkableSteppedTerrace(cell, this.cells)?.feature
        ?? arcadeFeature(cell, this.cells)
        ?? 'rooftop deck';
      this.rooftops.set(center, feature);
      edges.forEach((edge) => this.rooftops.set(edge, feature));
    }

    for (const cell of this.cells.values()) {
      const roof = roofNodes.get(keyOf(cell.x, cell.z));
      if (!roof) continue;
      CARDINALS.forEach(([dx, dz], direction) => {
        const neighbor = this.cells.get(keyOf(cell.x + dx, cell.z + dz));
        const neighborRoof = neighbor && roofNodes.get(keyOf(neighbor.x, neighbor.z));
        if (neighborRoof && neighbor?.height === cell.height) this.connect(roof.edges[direction], neighborRoof.edges[(direction + 2) % 4]);
      });

      const terrace = walkableSteppedTerrace(cell, this.cells);
      if (terrace) {
        const [dx, dz] = CARDINALS[terrace.direction];
        const lower = this.cells.get(keyOf(cell.x + dx, cell.z + dz));
        const lowerRoof = lower && roofNodes.get(keyOf(lower.x, lower.z));
        if (lowerRoof && lower?.height === cell.height - 1) {
          let previous = roof.center;
          const topY = .38 + cell.height * FLOOR;
          for (let index = 0; index < TERRACE_STEP_COUNT; index++) {
            const outward = terraceStepOutward(index);
            const step = this.addNode(cell.x * CELL + dx * outward, cell.z * CELL + dz * outward, terraceStepWalkY(topY, index));
            this.connect(previous, step);
            previous = step;
          }
          this.connect(previous, lowerRoof.edges[(terrace.direction + 2) % 4]);
        }
      }

      if (!isRoofAccessCell(cell, this.cells, this.seed)) continue;
      const direction = roofAccessDirection(cell, this.cells, this.seed);
      const entrance = this.entrance(keyOf(cell.x, cell.z));
      if (direction === null || !entrance) continue;
      const [dx, dz] = CARDINALS[direction];
      const hatchX = cell.x * CELL + dx * .5;
      const hatchZ = cell.z * CELL + dz * .5;
      const inside = this.addNode(cell.x * CELL, cell.z * CELL, WALK_Y);
      const stairBottom = this.addNode(hatchX, hatchZ, WALK_Y);
      const stairTop = this.addNode(hatchX, hatchZ, roof.y);
      this.connect(entrance.key, inside);
      this.connect(inside, stairBottom);
      this.connect(stairBottom, stairTop);
      this.connect(stairTop, roof.center);
    }
  }

  private doorDirection(cell: Cell, open: boolean[]) {
    const preferred = Math.floor(hash(this.seed, cell.x, cell.z, 27) * 4);
    if (open[preferred]) return preferred;
    return open.findIndex(Boolean);
  }

  entrance(homeKey: string) {
    const entranceKey = this.entrances.get(homeKey);
    return entranceKey ? this.nodes.get(entranceKey) : undefined;
  }

  closest(position: THREE.Vector3) {
    let closest: NavNode | undefined;
    let distance = Infinity;
    const bx = Math.floor(position.x / CELL);
    const bz = Math.floor(position.z / CELL);
    const nearby: NavNode[] = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      nearby.push(...(this.nodeBuckets.get(`${bx + dx},${bz + dz}`) ?? []));
    }
    for (const node of nearby.length ? nearby : this.nodes.values()) {
      const next = node.position.distanceToSquared(position);
      if (next < distance) {
        distance = next;
        closest = node;
      }
    }
    return closest;
  }

  randomNode(value: number, from: string, predicate?: (node: NavNode) => boolean) {
    const componentId = this.componentByNode.get(from);
    const component = componentId ? this.nodesByComponent.get(componentId) ?? [] : [];
    const everyday = component.filter((node) => !this.rooftops.has(node.key));
    const preferred = predicate ? everyday.filter(predicate) : everyday;
    const options = preferred.length ? preferred : everyday.length ? everyday : component;
    return options.length ? options[Math.floor(value * options.length) % options.length] : undefined;
  }

  plazaNode(value: number, from: string) {
    const options = this.plazas.filter((key) => this.canReach(from, key));
    if (!options.length) return undefined;
    return this.nodes.get(options[Math.floor(value * options.length) % options.length]);
  }

  dockNode(value: number, from: string) {
    const options = this.docks.filter((key) => this.canReach(from, key));
    if (!options.length) return undefined;
    return this.nodes.get(options[Math.floor(value * options.length) % options.length]);
  }

  rooftopNode(value: number, from: string) {
    const component = this.componentByNode.get(from);
    const options = component
      ? (this.nodesByComponent.get(component) ?? []).filter((node) => this.rooftops.has(node.key)).map((node) => node.key)
      : [];
    if (!options.length) return undefined;
    return this.nodes.get(options[Math.floor(value * options.length) % options.length]);
  }

  rooftopLabel(key: string) { return this.rooftops.get(key) ?? null; }

  formationNode(value: number, from: string) {
    const options = [...this.formationPlaces]
      .filter(([key]) => this.canReach(from, key));
    if (!options.length) return undefined;
    const [key, id] = options[Math.floor(value * options.length) % options.length];
    const node = this.nodes.get(key);
    return node ? { node, id } : undefined;
  }

  formationLabel(key: string) {
    const id = this.formationPlaces.get(key);
    return id ? FORMATION_BY_ID.get(id)?.title ?? null : null;
  }

  identityNode(value: number, from: string) {
    const options = [...this.identityPlaces]
      .filter(([key]) => this.canReach(from, key));
    if (!options.length) return undefined;
    const [key, id] = options[Math.floor(value * options.length) % options.length];
    const node = this.nodes.get(key);
    return node ? { node, id, landmark: this.identityLandmarkPlaces.has(key) } : undefined;
  }

  identityNodeFor(id: PlaceIdentityId, value: number, from: string, landmarkOnly = false) {
    const options = [...this.identityPlaces]
      .filter(([key, candidateId]) => candidateId === id && this.canReach(from, key))
      .filter(([key]) => !landmarkOnly || this.identityLandmarkPlaces.has(key));
    if (!options.length) return undefined;
    const [key] = options[Math.floor(value * options.length) % options.length];
    const node = this.nodes.get(key);
    return node ? { node, id, landmark: this.identityLandmarkPlaces.has(key) } : undefined;
  }

  identityLabel(key: string) {
    const id = this.identityPlaces.get(key);
    const definition = id ? PLACE_IDENTITY_BY_ID.get(id) : undefined;
    return definition ? (this.identityLandmarkPlaces.has(key) ? definition.landmark.title : definition.title) : null;
  }

  identityActivity(key: string, id: PlaceIdentityId, ageGroup?: string, occupation?: string) {
    return this.identityLandmarkPlaces.has(key)
      ? PLACE_IDENTITY_BY_ID.get(id)?.landmark.activity ?? placeIdentityActivity(id, ageGroup, occupation)
      : placeIdentityActivity(id, ageGroup, occupation);
  }

  confluenceNode(value: number, from: string) {
    const options = [...this.confluencePlaces].filter(([key]) => this.canReach(from, key));
    if (!options.length) return undefined;
    const [key, id] = options[Math.floor(value * options.length) % options.length];
    const node = this.nodes.get(key);
    return node ? { node, id, landmark: this.confluenceLandmarkPlaces.has(key) } : undefined;
  }

  confluenceLabel(key: string) {
    const id = this.confluencePlaces.get(key);
    const definition = id ? CONFLUENCE_BY_ID.get(id) : undefined;
    return definition ? (this.confluenceLandmarkPlaces.has(key) ? definition.landmark.title : definition.title) : null;
  }

  confluenceActivity(key: string, id: ConfluenceId, ageGroup?: string, occupation?: string) {
    return this.confluenceLandmarkPlaces.has(key)
      ? CONFLUENCE_BY_ID.get(id)?.landmark.activity ?? confluenceActivity(id, ageGroup, occupation)
      : confluenceActivity(id, ageGroup, occupation);
  }

  canReach(from: string, to: string) {
    const component = this.componentByNode.get(from);
    return component !== undefined && component === this.componentByNode.get(to);
  }

  path(from: string, to: string) {
    if (from === to) return [];
    const start = this.nodes.get(from);
    const target = this.nodes.get(to);
    if (!start || !target) return [];

    const open = new Set([from]);
    const cameFrom = new Map<string, string>();
    const g = new Map<string, number>([[from, 0]]);
    const f = new Map<string, number>([[from, start.position.distanceTo(target.position)]]);

    while (open.size) {
      let current = '';
      let best = Infinity;
      for (const key of open) {
        const score = f.get(key) ?? Infinity;
        if (score < best) {
          best = score;
          current = key;
        }
      }
      if (current === to) {
        const route: THREE.Vector3[] = [];
        let cursor = to;
        while (cursor !== from) {
          route.unshift(this.nodes.get(cursor)!.position.clone());
          cursor = cameFrom.get(cursor)!;
        }
        return route;
      }
      open.delete(current);
      const node = this.nodes.get(current)!;
      for (const neighborKey of node.links) {
        const neighbor = this.nodes.get(neighborKey)!;
        const tentative = (g.get(current) ?? Infinity) + node.position.distanceTo(neighbor.position);
        if (tentative >= (g.get(neighborKey) ?? Infinity)) continue;
        cameFrom.set(neighborKey, current);
        g.set(neighborKey, tentative);
        f.set(neighborKey, tentative + neighbor.position.distanceTo(target.position));
        open.add(neighborKey);
      }
    }
    return [];
  }

  debugPositions() {
    const values: number[] = [];
    const visited = new Set<string>();
    for (const node of this.nodes.values()) for (const link of node.links) {
      const edge = [node.key, link].sort().join('|');
      if (visited.has(edge)) continue;
      visited.add(edge);
      const other = this.nodes.get(link);
      if (!other) continue;
      values.push(...node.position.toArray(), ...other.position.toArray());
    }
    return values;
  }
}

export class CitizenSystem {
  readonly root = new THREE.Group();
  readonly debugRoot = new THREE.Group();
  private readonly renderRoot = new THREE.Group();
  private readonly seed: number;
  private readonly citizens: Citizen[] = [];
  private graph: NavGraph;
  private cells: Map<string, Cell>;
  private nextCitizen = 0;
  private meetingTime = new Map<string, number>();
  private nextSharedMoment = new Map<string, number>();
  private relationshipAccumulator = 0;
  private currentHours = 0;
  private businesses: BusinessSave[] = [];
  private discoveries = new Set<string>();
  private pendingBusinessVisits: BusinessVisit[] = [];
  private readonly walkDirection = new THREE.Vector3();
  private readonly laneOffset = new THREE.Vector3();
  private readonly laneTarget = new THREE.Vector3();
  private readonly pickCenter = new THREE.Vector3();
  private readonly pickClosest = new THREE.Vector3();
  private readonly batches = createFigureBatches();
  private readonly batchList = Object.values(this.batches).flat();
  private readonly renderMatrix = new THREE.Matrix4();
  private readonly limbMatrix = new THREE.Matrix4();
  private readonly tint = new THREE.Color();
  private readonly poseTarget: Pose = { ...REST_POSE };
  // Quay slabs sit a little above the walk height, so the disc floats to clear them.
  private readonly shadowOffset = new THREE.Matrix4().makeRotationX(-Math.PI / 2).setPosition(0, .05, 0);
  private readonly legOffset = new THREE.Matrix4().makeTranslation(0, FIGURE_OFFSETS.legDrop, 0);
  private readonly shoeOffset = new THREE.Matrix4().makeTranslation(0, FIGURE_OFFSETS.shoeDrop, FIGURE_OFFSETS.shoeForward);
  private readonly sleeveOffset = new THREE.Matrix4().makeTranslation(0, FIGURE_OFFSETS.sleeveDrop, 0);
  private readonly handOffset = new THREE.Matrix4().makeTranslation(0, FIGURE_OFFSETS.handDrop, 0);
  private readonly hairOffset = new THREE.Matrix4().makeTranslation(0, FIGURE_OFFSETS.hair, 0);
  private readonly hatOffset = new THREE.Matrix4().makeTranslation(0, FIGURE_OFFSETS.hat, 0);
  private readonly capOffset = new THREE.Matrix4().makeTranslation(0, FIGURE_OFFSETS.cap, 0);
  private readonly stickOffset = new THREE.Matrix4().makeRotationX(.18).setPosition(.03, -.26, .05);
  private readonly broomOffset = new THREE.Matrix4().makeRotationX(-.9).setPosition(0, -.3, .12);
  private readonly rodOffset = new THREE.Matrix4().makeRotationX(-1.15).setPosition(.02, -.12, .2);
  private readonly umbrellaHandleOffset = new THREE.Matrix4().makeTranslation(0, .05, .02);
  private readonly umbrellaOffset = new THREE.Matrix4().makeTranslation(0, .27, .02);
  private readonly lanternOffset = new THREE.Matrix4().makeTranslation(0, -.2, .02);
  private readonly cargoOffset = new THREE.Matrix4().makeTranslation(.05, -.19, .06);
  private rainIntensity = 0;
  private night = false;

  constructor(seed: number, cells: Map<string, Cell>, saved: CitizenSave[]) {
    this.seed = seed;
    this.cells = cells;
    this.graph = new NavGraph(cells, seed);
    this.root.name = 'citizens';
    this.renderRoot.name = 'citizen-instance-batches';
    this.renderRoot.add(...this.batchList);
    this.debugRoot.name = 'citizen-navigation';
    this.debugRoot.visible = false;
    this.root.add(this.renderRoot, this.debugRoot);
    for (const data of saved) this.restoreCitizen(data);
    this.nextCitizen = this.citizens.reduce((largest, citizen) => Math.max(largest, citizenIndex(citizen.id)), -1) + 1;
    this.reconcileHomes();
    this.rebuildDebugGraph();
    this.updateRenderInstances();
  }

  /** Rain above a quarter opens umbrellas and hurries walkers home. */
  setWeather(rainIntensity: number) {
    this.rainIntensity = rainIntensity;
  }

  rebuild(cells: Map<string, Cell>) {
    this.cells = cells;
    this.graph = new NavGraph(cells, this.seed);
    for (const citizen of this.citizens) {
      citizen.path = [];
      citizen.targetKey = null;
      const nearest = this.graph.closest(citizen.model.position);
      if (nearest) citizen.model.position.copy(nearest.position);
    }
    this.reconcileHomes();
    this.rebuildDebugGraph();
  }

  setBusinesses(businesses: BusinessSave[]) {
    const activeWorkers = new Set(businesses.flatMap((business) => [business.ownerId, ...(business.employeeIds ?? [])]));
    for (const previous of this.businesses) {
      for (const citizenId of [previous.ownerId, ...(previous.employeeIds ?? [])]) {
        if (activeWorkers.has(citizenId)) continue;
        const citizen = this.citizens.find((candidate) => candidate.id === citizenId);
        if (!citizen || citizen.occupation === 'Fisher') continue;
        citizen.occupation = pick(OCCUPATIONS, hash(this.seed, this.citizens.indexOf(citizen), previous.openedAt, 954));
        citizen.activity = 'looking for a new use for the quiet ground floor';
      }
    }
    this.businesses = businesses.map((business) => ({ ...business, employeeIds: [...(business.employeeIds ?? [])] }));
    const businessIds = new Set(businesses.map((business) => business.id));
    for (const citizen of this.citizens) {
      if (citizen.pendingParcelBusinessId && !businessIds.has(citizen.pendingParcelBusinessId)) {
        citizen.pendingParcelBusinessId = null;
        citizen.carryingParcel = false;
      }
    }
    for (const business of businesses) {
      const owner = this.citizens.find((citizen) => citizen.id === business.ownerId);
      if (owner && owner.occupation !== 'Fisher') owner.occupation = businessOccupation(business.type);
      for (const employeeId of business.employeeIds ?? []) {
        const employee = this.citizens.find((citizen) => citizen.id === employeeId);
        if (employee && employee.occupation !== 'Fisher') employee.occupation = `${businessOccupation(business.type)}'s helper`;
      }
    }
  }

  setDiscoveries(discoveries: readonly string[]) {
    this.discoveries = new Set(discoveries);
    if (this.discoveries.has('fishing-boat') && !this.citizens.some((citizen) => citizen.occupation === 'Fisher')) this.assignOccupation('Fisher');
    if (this.discoveries.has('fishing-crew') && this.citizens.filter((citizen) => citizen.occupation === 'Fisher').length < 2) this.assignOccupation('Fisher', true);
  }

  private validHomes() {
    return [...this.cells.values()]
      .filter((cell) => CARDINALS.some(([dx, dz]) => !this.cells.has(keyOf(cell.x + dx, cell.z + dz))))
      .map((cell) => keyOf(cell.x, cell.z));
  }

  private reconcileHomes() {
    const homes = this.validHomes();
    const valid = new Set(homes);
    for (const citizen of [...this.citizens]) {
      if (valid.has(citizen.homeKey)) continue;
      const freeHome = homes.find((home) => this.residentCount(home, citizen) < this.homeCapacity(home));
      if (freeHome) {
        citizen.homeKey = freeHome;
        citizen.householdId = `household-${freeHome}`;
        const entrance = this.graph.entrance(freeHome);
        if (entrance) citizen.model.position.copy(entrance.position);
      } else if (citizen.residentKind !== 'visitor') {
        this.removeCitizen(citizen);
      }
    }

    for (const home of homes) {
      const residents = this.citizens
        .filter((citizen) => citizen.residentKind !== 'visitor' && citizen.homeKey === home)
        .sort((a, b) => (a.ageGroup === 'child' ? -1 : 1) - (b.ageGroup === 'child' ? -1 : 1));
      while (residents.length > this.homeCapacity(home)) {
        const citizen = residents.shift()!;
        const nextHome = homes.find((candidate) => candidate !== home && this.residentCount(candidate) < this.homeCapacity(candidate));
        if (!nextHome) {
          this.removeCitizen(citizen);
          continue;
        }
        citizen.homeKey = nextHome;
        citizen.householdId = `household-${nextHome}`;
        const entrance = this.graph.entrance(nextHome);
        if (entrance) citizen.model.position.copy(entrance.position);
      }
    }

    for (const home of homes) {
      while (this.residentCount(home) < this.homeCapacity(home)) this.spawnCitizen(home, this.residentCount(home) ? 'child' : undefined);
    }
  }

  private homeCapacity(homeKey: string) {
    return (this.cells.get(homeKey)?.height ?? 0) >= 3 ? 2 : 1;
  }

  private residentCount(homeKey: string, excluding?: Citizen) {
    return this.citizens.filter((citizen) => citizen !== excluding && citizen.residentKind !== 'visitor' && citizen.homeKey === homeKey).length;
  }

  private spawnCitizen(homeKey: string, forcedAge?: CitizenAgeGroup) {
    const index = this.nextCitizen++;
    const cell = parseCellKey(homeKey);
    const nameOffset = Math.floor(hash(this.seed, cell.x, cell.z, 901) * NAMES.length);
    let name = NAMES[(nameOffset + index) % NAMES.length];
    if (this.citizens.some((citizen) => citizen.name === name)) name = `${name} ${String.fromCharCode(65 + index % 26)}.`;
    const traitA = pick(TRAITS, hash(this.seed, cell.x, cell.z, 902));
    const traitB = pick(TRAITS.filter((trait) => trait !== traitA), hash(this.seed, cell.x, cell.z, 903));
    const entrance = this.graph.entrance(homeKey)?.position ?? new THREE.Vector3(cell.x * CELL, WALK_Y, cell.z * CELL);
    const ageRoll = hash(this.seed, cell.x, cell.z, 907 + index);
    const ageGroup: CitizenAgeGroup = forcedAge ?? (ageRoll < .16 ? 'elder' : 'adult');
    const data: CitizenSave = {
      id: `citizen-${this.seed}-${index}`,
      name,
      homeKey,
      position: [entrance.x, entrance.z],
      occupation: ageGroup === 'child' ? 'Student' : ageGroup === 'elder' ? 'Retired' : pick(OCCUPATIONS, hash(this.seed, cell.x, cell.z, 904)),
      traits: [traitA, traitB],
      relationships: [],
      color: Math.floor(hash(this.seed, cell.x, cell.z, 905) * TUNICS.length),
      ageGroup,
      householdId: `household-${homeKey}`,
      businessVisits: {},
      residentKind: 'resident',
    };
    this.restoreCitizen(data, true);
  }

  private restoreCitizen(data: CitizenSave, movingIn = false) {
    const normalized: CitizenSave = {
      ...data,
      ageGroup: data.ageGroup ?? 'adult',
      householdId: data.householdId ?? `household-${data.homeKey}`,
      businessVisits: { ...(data.businessVisits ?? {}) },
      residentKind: data.residentKind ?? 'resident',
    };
    const { group: model, parts } = this.createModel(normalized);
    model.position.set(data.position[0], data.elevation ?? WALK_Y, data.position[1]);
    // Routes are not persisted. Snap restored residents back to the rebuilt
    // graph so saves made with older surface heights do not leave them afloat.
    const restoredNode = this.graph.closest(model.position);
    if (restoredNode) model.position.copy(restoredNode.position);
    if (movingIn) model.scale.setScalar(.01);
    this.root.add(model);
    const index = citizenIndex(normalized.id);
    const heading = hash(this.seed, index, 1, 919) * Math.PI * 2;
    model.rotation.y = heading;
    this.citizens.push({
      ...normalized,
      traits: [...normalized.traits],
      relationships: [...normalized.relationships],
      model,
      parts,
      look: deriveLook(normalized, this.seed),
      pose: { ...REST_POSE },
      kind: 'stand',
      idleVariant: index % IDLE_VARIANTS,
      walkWeight: 0,
      danceWeight: 0,
      heading,
      facePoint: null,
      lane: (hash(this.seed, index, 2, 920) - .5) * .24,
      loiterAt: 0,
      loiterHome: model.position.clone(),
      chatLead: false,
      path: [],
      targetKey: null,
      nextDecisionAt: 0,
      activity: movingIn ? 'moving in' : 'watching the tide',
      stepPhase: hash(this.seed, this.citizens.length, 0, 906) * Math.PI * 2,
      carryingGood: null,
      pendingParcelBusinessId: null,
      carryingParcel: false,
    });
  }

  private removeCitizen(citizen: Citizen) {
    this.root.remove(citizen.model);
    this.citizens.splice(this.citizens.indexOf(citizen), 1);
  }

  private createModel(data: CitizenSave) {
    const group = new THREE.Group();
    group.userData.citizenId = data.id;
    const node = (parent: THREE.Object3D, x: number, y: number, z = 0) => {
      const object = new THREE.Object3D();
      object.position.set(x, y, z);
      parent.add(object);
      return object;
    };
    const at = FIGURE_OFFSETS;
    const tunic = node(group, 0, at.tunic);
    const parts: FigureParts = {
      legs: [-1, 1].map((side) => node(group, side * at.legX, at.legY)),
      tunic,
      apron: node(tunic, at.apron[0], at.apron[1] - at.tunic, at.apron[2]),
      pack: node(tunic, at.pack[0], at.pack[1] - at.tunic, at.pack[2]),
      arms: [-1, 1].map((side) => node(group, side * at.armX, at.shoulderY)),
      head: node(group, 0, at.head),
    };
    const child = data.ageGroup === 'child';
    if (child) parts.head.scale.setScalar(1.15);
    group.userData.targetScale = child ? .74 : data.ageGroup === 'elder' ? .94 : 1;
    group.scale.setScalar(group.userData.targetScale as number);
    return { group, parts };
  }

  update(deltaSeconds: number, timeOfDay: number, absoluteHours: number, realTime: number) {
    this.currentHours = absoluteHours;
    this.night = timeOfDay >= 19.5 || timeOfDay < 5.5;
    for (const citizen of this.citizens) {
      const targetScale = citizen.model.userData.targetScale as number ?? 1;
      if (citizen.model.scale.x < targetScale - .01) {
        const scale = Math.min(targetScale, citizen.model.scale.x + deltaSeconds * 1.8);
        citizen.model.scale.setScalar(scale);
      }
      if (!citizen.path.length && absoluteHours >= citizen.nextDecisionAt) this.chooseRoutine(citizen, timeOfDay, absoluteHours);
      if (!citizen.path.length) this.loiter(citizen, realTime);
      this.walk(citizen, deltaSeconds);
      this.animate(citizen, deltaSeconds, realTime);
    }
    this.relationshipAccumulator += deltaSeconds;
    if (this.relationshipAccumulator >= 1) {
      this.updateRelationships(this.relationshipAccumulator, timeOfDay, absoluteHours);
      this.relationshipAccumulator = 0;
    }
    this.updateRenderInstances();
  }

  /** Asleep residents are indoors, so they leave the street empty instead of standing at the door all night. */
  private indoors(citizen: Citizen) {
    return citizen.kind === 'sleep' && citizen.path.length === 0;
  }

  private place(batch: THREE.InstancedMesh, matrix: THREE.Matrix4, color?: number) {
    const index = batch.count++;
    batch.setMatrixAt(index, matrix);
    if (color !== undefined) batch.setColorAt(index, this.tint.setHex(color));
  }

  private updateRenderInstances() {
    for (const batch of this.batchList) batch.count = 0;
    const renderedCount = Math.min(this.citizens.length, MAX_RENDERED_CITIZENS);
    const matrix = this.renderMatrix;
    const limb = this.limbMatrix;
    const batches = this.batches;
    for (let index = 0; index < renderedCount; index++) {
      const citizen = this.citizens[index];
      if (this.indoors(citizen)) continue;
      const { model, parts, look } = citizen;
      const walking = citizen.path.length > 0;
      const umbrella = this.rainIntensity > .25;
      model.updateMatrix();
      const base = model.matrix;
      this.place(batches.shadows, matrix.multiplyMatrices(base, this.shadowOffset));
      for (const leg of parts.legs) {
        leg.updateMatrix();
        limb.multiplyMatrices(base, leg.matrix);
        this.place(batches.legs, matrix.multiplyMatrices(limb, this.legOffset), look.trousers);
        this.place(batches.shoes, matrix.multiplyMatrices(limb, this.shoeOffset));
      }
      parts.tunic.updateMatrix();
      limb.multiplyMatrices(base, parts.tunic.matrix);
      this.place(batches.tunics, limb, look.tunic);
      if (look.apron !== null) {
        parts.apron.updateMatrix();
        this.place(batches.aprons, matrix.multiplyMatrices(limb, parts.apron.matrix), look.apron);
      }
      if (look.pack !== null) {
        parts.pack.updateMatrix();
        this.place(batches.packs, matrix.multiplyMatrices(limb, parts.pack.matrix), look.pack);
      }
      for (const [side, arm] of parts.arms.entries()) {
        arm.updateMatrix();
        limb.multiplyMatrices(base, arm.matrix);
        this.place(batches.sleeves, matrix.multiplyMatrices(limb, this.sleeveOffset), look.tunic);
        this.place(batches.hands, matrix.multiplyMatrices(limb, this.handOffset), look.skin);
        if (side === 0) {
          if (umbrella) {
            this.place(batches.sticks, matrix.multiplyMatrices(limb, this.umbrellaHandleOffset));
            this.place(batches.umbrellas, matrix.multiplyMatrices(limb, this.umbrellaOffset));
          } else if (this.night && walking) {
            this.place(batches.lanterns, matrix.multiplyMatrices(limb, this.lanternOffset));
          }
        } else {
          if (citizen.carryingGood || citizen.carryingParcel) this.place(batches.cargo, matrix.multiplyMatrices(limb, this.cargoOffset));
          else if (citizen.kind === 'sweep' && !walking) this.place(batches.sticks, matrix.multiplyMatrices(limb, this.broomOffset));
          else if (citizen.kind === 'cast' && !walking) this.place(batches.sticks, matrix.multiplyMatrices(limb, this.rodOffset));
          else if (look.stick) this.place(batches.sticks, matrix.multiplyMatrices(limb, this.stickOffset));
        }
      }
      parts.head.updateMatrix();
      limb.multiplyMatrices(base, parts.head.matrix);
      this.place(batches.heads, limb, look.skin);
      this.place(batches.hair[look.hairStyle], matrix.multiplyMatrices(limb, this.hairOffset), look.hair);
      if (look.hat === 'straw') this.place(batches.straw, matrix.multiplyMatrices(limb, this.hatOffset));
      else if (look.hat === 'cap') this.place(batches.caps, matrix.multiplyMatrices(limb, this.capOffset));
    }
    for (const batch of this.batchList) {
      if (!batch.count) continue;
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
    }
  }

  private chooseRoutine(citizen: Citizen, hour: number, absoluteHours: number) {
    const home = this.graph.entrance(citizen.homeKey);
    const from = this.graph.closest(citizen.model.position);
    if (!from) return;
    let target = home;
    const choice = hash(this.seed, Math.floor(absoluteHours * 4), this.citizens.indexOf(citizen), 1001);
    citizen.kind = 'stand';
    citizen.facePoint = null;
    citizen.idleVariant = Math.floor(choice * IDLE_VARIANTS);
    const businessVisit = this.chooseBusinessVisit(citizen, hour, choice, from.key);
    const lanternTheatre = hour >= 18 && hour < 21.75 && choice < .84
      ? this.graph.identityNodeFor('lantern-square', (choice * 4.17 + this.citizens.indexOf(citizen) * .137) % 1, from.key, true)
      : undefined;
    const rooftopPartyTarget = lanternTheatre && choice < .52
      ? this.graph.rooftopNode(
        (choice * 3.17 + this.citizens.indexOf(citizen) * .137) % 1,
        from.key,
      )
      : undefined;
    const lanternPartyTarget = lanternTheatre && !rooftopPartyTarget
      ? this.graph.randomNode((choice * 3.71 + this.citizens.indexOf(citizen) * .193) % 1, from.key,
        (node) => node.position.distanceToSquared(lanternTheatre.node.position) < 6.8) ?? lanternTheatre.node
      : undefined;
    const signaturePlace = this.signatureLandmarkVisit(citizen, hour, choice, from.key);
    const confluencePlace = hour >= 9 && hour < 21 && choice < .84
      ? this.graph.confluenceNode((choice * 2.47 + this.citizens.indexOf(citizen) * .179) % 1, from.key)
      : undefined;
    const identityPlace = confluencePlace ? undefined : signaturePlace ?? (hour >= 9 && hour < 21 && choice < .72
      ? this.graph.identityNode((choice * 2.19 + this.citizens.indexOf(citizen) * .163) % 1, from.key)
      : undefined);
    const rooftopChance = citizen.occupation === 'Fisher' ? 0 : citizen.occupation === 'Gardener' ? .62 : citizen.ageGroup === 'elder' ? .4 : .3;
    const rooftop = !confluencePlace && !identityPlace && hour >= 7 && hour < 21 && (citizen.ageGroup !== 'child' || hour >= 15) && choice < rooftopChance
      ? this.graph.rooftopNode((choice * 3.17 + this.citizens.indexOf(citizen) * .137) % 1, from.key)
      : undefined;
    const formationPlace = !confluencePlace && !identityPlace && hour >= 9 && hour < 21 && choice < .58
      ? this.graph.formationNode((choice * 2.73 + this.citizens.indexOf(citizen) * .193) % 1, from.key)
      : undefined;
    if (citizen.carryingParcel && home) {
      const shop = this.businesses.find((business) => business.id === citizen.pendingParcelBusinessId);
      citizen.activity = `carrying a parcel home${shop ? ` from ${shop.name}` : ''}`;
      target = home;
    } else if (hour < 4.5 || (hour < 6 && citizen.occupation !== 'Fisher') || hour >= 22) {
      citizen.activity = 'sleeping at home';
      citizen.kind = 'sleep';
    } else if (rooftopPartyTarget && !businessVisit?.owned) {
      citizen.activity = citizen.ageGroup === 'child'
        ? 'dancing beneath the rooftop lanterns'
        : 'joining the parties across the flat rooftops';
      target = rooftopPartyTarget;
      citizen.kind = 'dance';
    } else if (lanternPartyTarget && !businessVisit?.owned) {
      citizen.activity = citizen.ageGroup === 'child'
        ? 'dancing through the lantern light in the square'
        : citizen.occupation === 'Cook'
          ? 'sharing festival food beside the lantern theatre'
          : 'dancing with neighbors beneath the lanterns';
      target = lanternPartyTarget;
      citizen.kind = 'dance';
    } else if (businessVisit?.owned) {
      citizen.activity = this.ownerActivity(businessVisit.business.type);
      citizen.kind = OWNER_KINDS[businessVisit.business.type];
      target = businessVisit.target;
    } else if (citizen.ageGroup === 'child' && hour < 15) {
      const guardian = hour < 9 ? this.householdGuardian(citizen, from.key) : null;
      const plaza = this.discoveries.has('birds-nest') ? this.graph.plazaNode(choice, from.key) : undefined;
      citizen.activity = guardian
        ? `heading out with ${guardian.citizen.name}`
        : plaza ? 'feeding the birds in the plaza after lessons' : this.discoveries.has('birds-nest') ? 'looking up at the tower nest after lessons' : 'walking to lessons with a neighbor';
      target = guardian?.target ?? plaza ?? this.graph.randomNode(choice, from.key);
    } else if (rooftop) {
      citizen.activity = this.rooftopActivity(citizen, this.graph.rooftopLabel(rooftop.key));
      target = rooftop;
    } else if (citizen.ageGroup === 'elder' && hour >= 14 && hour < 18) {
      citizen.activity = 'resting by the water and greeting passersby';
      citizen.kind = 'sit';
      target = this.graph.randomNode(choice, from.key, (node) => Math.hypot(node.position.x, node.position.z) > 3);
    } else if (hour < 9) {
      if (businessVisit) {
        citizen.activity = this.visitorActivity(businessVisit.business.type);
        target = businessVisit.target;
      } else {
        const morningWork = this.professionRoutine(citizen, hour, choice, from.key);
        citizen.activity = morningWork?.activity ?? 'taking an early walk';
        citizen.kind = morningWork?.kind ?? 'stand';
        target = morningWork?.target ?? this.graph.randomNode(choice, from.key, (node) => Math.hypot(node.position.x, node.position.z) > 2);
      }
    } else if (hour < 12) {
      if (businessVisit && choice > .35) {
        citizen.activity = this.visitorActivity(businessVisit.business.type);
        target = businessVisit.target;
      } else {
        const work = this.professionRoutine(citizen, hour, choice, from.key);
        citizen.activity = work?.activity ?? (confluencePlace
          ? this.graph.confluenceActivity(confluencePlace.node.key, confluencePlace.id, citizen.ageGroup, citizen.occupation)
          : identityPlace
          ? this.graph.identityActivity(identityPlace.node.key, identityPlace.id, citizen.ageGroup, citizen.occupation)
          : formationPlace
          ? formationGatheringActivity(formationPlace.id, citizen.ageGroup, citizen.occupation)
          : `working as a ${citizen.occupation.toLowerCase()}`);
        target = work?.target ?? confluencePlace?.node ?? identityPlace?.node ?? formationPlace?.node ?? this.graph.randomNode(choice, from.key);
        citizen.kind = work?.kind ?? 'stand';
      }
    } else if (hour < 14) {
      const plaza = choice < .34 ? this.graph.plazaNode(choice * 2.7, from.key) : undefined;
      citizen.activity = businessVisit
        ? this.visitorActivity(businessVisit.business.type)
        : confluencePlace
          ? this.graph.confluenceActivity(confluencePlace.node.key, confluencePlace.id, citizen.ageGroup, citizen.occupation)
        : identityPlace
          ? this.graph.identityActivity(identityPlace.node.key, identityPlace.id, citizen.ageGroup, citizen.occupation)
          : formationPlace
          ? formationGatheringActivity(formationPlace.id, citizen.ageGroup, citizen.occupation)
          : plaza ? 'sitting in the plaza' : 'looking for lunch';
      target = businessVisit?.target ?? confluencePlace?.node ?? identityPlace?.node ?? formationPlace?.node ?? plaza ?? this.graph.randomNode(choice, from.key);
      if (plaza && target === plaza) citizen.kind = 'sit';
    } else if (hour < 18) {
      if (businessVisit && choice > .55) {
        citizen.activity = this.visitorActivity(businessVisit.business.type);
        target = businessVisit.target;
      } else {
        const fishmonger = !confluencePlace && !identityPlace && !formationPlace && this.discoveries.has('harbor-cats') && (citizen.traits.includes('curious') || citizen.traits.includes('sociable')) && choice < .22
          ? this.businesses.find((business) => business.type === 'fishmonger')
          : undefined;
        const catVisit = fishmonger ? this.graph.entrance(fishmonger.cellKey) : undefined;
        const friendVisit = confluencePlace || identityPlace || formationPlace || catVisit || citizen.traits.includes('quiet') ? null : this.chooseFriendVisit(citizen, choice, from.key);
        citizen.activity = confluencePlace
          ? this.graph.confluenceActivity(confluencePlace.node.key, confluencePlace.id, citizen.ageGroup, citizen.occupation)
          : identityPlace
          ? this.graph.identityActivity(identityPlace.node.key, identityPlace.id, citizen.ageGroup, citizen.occupation)
          : formationPlace
          ? formationGatheringActivity(formationPlace.id, citizen.ageGroup, citizen.occupation)
          : catVisit
          ? 'stopping to greet the harbor cats'
          : friendVisit
            ? `visiting ${friendVisit.friend.name} at home`
            : citizen.traits.includes('quiet') ? 'watching the harbor' : 'walking past the neighbors\' doors';
        target = confluencePlace?.node ?? identityPlace?.node ?? formationPlace?.node ?? catVisit ?? friendVisit?.target ?? this.graph.randomNode(choice, from.key);
      }
    } else if (hour < 21) {
      if (businessVisit) {
        citizen.activity = this.visitorActivity(businessVisit.business.type);
        target = businessVisit.target;
      } else {
        citizen.activity = confluencePlace
          ? this.graph.confluenceActivity(confluencePlace.node.key, confluencePlace.id, citizen.ageGroup, citizen.occupation)
          : identityPlace
          ? this.graph.identityActivity(identityPlace.node.key, identityPlace.id, citizen.ageGroup, citizen.occupation)
          : formationPlace
          ? formationGatheringActivity(formationPlace.id, citizen.ageGroup, citizen.occupation)
          : citizen.traits.includes('sociable') ? 'taking an evening stroll' : 'heading home slowly';
        target = confluencePlace?.node ?? identityPlace?.node ?? formationPlace?.node ?? this.graph.randomNode(choice, from.key);
      }
    } else {
      citizen.activity = 'walking home beneath the lanterns';
    }
    if (!target) return;
    if (citizen.kind === 'stand') citizen.kind = kindFromText(citizen.activity);
    citizen.facePoint = this.facingFor(citizen, target);
    if (businessVisit && !businessVisit.owned && target.key === businessVisit.target.key) this.recordBusinessVisit(citizen, businessVisit.business);
    citizen.targetKey = target.key;
    citizen.path = this.graph.path(from.key, target.key);
    citizen.nextDecisionAt = absoluteHours + .35 + choice * .65;
  }

  private signatureLandmarkVisit(citizen: Citizen, hour: number, choice: number, from: string) {
    const profession = citizen.occupation;
    const candidates: Array<{ id: PlaceIdentityId; chance: number }> = [];
    if (hour >= 6 && hour < 13 && ['Fisher', 'Cook', 'Fishmonger', 'Baker'].includes(profession)) candidates.push({ id: 'canal-market', chance: .86 });
    if (hour >= 8 && hour < 18 && (profession === 'Gardener' || citizen.ageGroup === 'child')) candidates.push({ id: 'garden-commons', chance: .82 });
    if (hour >= 8 && hour < 18 && ['Artisan', 'Potter', 'Weaver', 'Bookbinder'].includes(profession)) candidates.push({ id: 'makers-walk', chance: .84 });
    if (hour >= 17 && hour < 22) candidates.push({ id: 'roof-village', chance: .78 });
    if (hour >= 5.5 && hour < 12 && ['Fisher', 'Cartographer'].includes(profession)) candidates.push({ id: 'high-harbor', chance: .88 });
    if (hour >= 18 && hour < 21.5) candidates.push({ id: 'lantern-square', chance: .9 });
    if (!candidates.length) return undefined;
    const start = Math.floor(choice * candidates.length) % candidates.length;
    for (let offset = 0; offset < candidates.length; offset++) {
      const candidate = candidates[(start + offset) % candidates.length];
      if (choice > candidate.chance) continue;
      const place = this.graph.identityNodeFor(candidate.id, (choice * 3.41 + offset * .29) % 1, from, true);
      if (place) return place;
    }
    return undefined;
  }

  private professionRoutine(citizen: Citizen, hour: number, choice: number, from: string) {
    if (citizen.occupation === 'Fisher') {
      const target = this.graph.dockNode(choice, from) ?? this.graph.randomNode(choice, from);
      const casting = hour >= 9 && choice < .5;
      const activity = hour < 6
        ? 'carrying the nets down to the morning boat'
        : hour < 9
          ? this.discoveries.has('silver-shoal') ? 'watching the boat cast its net over the silver shoal' : 'sorting the morning catch beside the boat'
          : casting ? 'casting a line off the quay' : 'mending nets along the quay';
      const kind: ActivityKind = hour < 6 ? 'stand' : casting ? 'cast' : hour < 9 && this.discoveries.has('silver-shoal') ? 'watch' : 'knead';
      return target ? { target, activity, kind } : null;
    }
    if (citizen.occupation === 'Gardener') {
      const target = this.graph.rooftopNode(choice, from) ?? this.graph.plazaNode(choice, from) ?? this.graph.randomNode(choice, from);
      return target ? { target, activity: this.graph.rooftopLabel(target.key) ? 'watering the rooftop planters' : 'tending the public flowers', kind: 'knead' as ActivityKind } : null;
    }
    if (citizen.occupation === 'Teacher') {
      const target = this.graph.plazaNode(choice, from) ?? this.graph.randomNode(choice, from);
      return target ? { target, activity: hour < 9 ? 'walking to lessons with the children' : 'holding a small lesson in the open air', kind: 'chat' as ActivityKind } : null;
    }
    if (citizen.occupation === 'Cartographer') {
      const target = this.graph.rooftopNode(choice, from) ?? this.graph.dockNode(choice, from) ?? this.graph.randomNode(choice, from);
      return target ? { target, activity: this.graph.rooftopLabel(target.key) ? 'sketching the harbor from above' : 'measuring the tide against the quay', kind: 'watch' as ActivityKind } : null;
    }
    if (citizen.occupation === 'Bookbinder') {
      const bookstore = this.businesses.find((business) => business.type === 'bookstore');
      const entrance = bookstore ? this.graph.entrance(bookstore.cellKey) : undefined;
      const target = entrance && this.graph.canReach(from, entrance.key) ? entrance : this.graph.randomNode(choice, from);
      return target ? { target, activity: bookstore ? 'delivering a newly bound book' : 'carrying a parcel of stitched pages', kind: 'stand' as ActivityKind } : null;
    }
    if (citizen.occupation === 'Caretaker') {
      const target = this.graph.randomNode(choice, from);
      return target ? { target, activity: hour < 9 ? 'opening shutters along the lane' : 'checking the lamps and doorways', kind: 'watch' as ActivityKind } : null;
    }
    if (citizen.occupation === 'Cook') {
      const market = this.businesses.find((business) => business.type === 'fishmonger' || business.type === 'flower-shop');
      const entrance = market ? this.graph.entrance(market.cellKey) : undefined;
      const target = entrance && this.graph.canReach(from, entrance.key) ? entrance : this.graph.randomNode(choice, from);
      return target ? { target, activity: market ? 'choosing ingredients for the midday kitchen' : 'bringing a basket back to the kitchen', kind: 'stand' as ActivityKind } : null;
    }
    return null;
  }

  private chooseBusinessVisit(citizen: Citizen, hour: number, choice: number, from: string) {
    const open = this.businesses.filter((business) => isBusinessOpen(business.type, hour));
    const owned = open.find((business) => business.ownerId === citizen.id);
    const preferredTypes: BusinessType[] = hour < 9
      ? ['bakery', 'fishmonger', 'flower-shop']
      : hour < 15
        ? ['cafe', 'tea-house', 'bakery', 'flower-shop', 'bookstore', 'fishmonger', 'workshop', 'pottery', 'mill', 'smokehouse', 'weaver', 'shipyard', 'restaurant']
        : hour < 19
          ? ['workshop', 'pottery', 'smokehouse', 'weaver', 'shipyard', 'flower-shop', 'bookstore', 'cafe', 'tea-house', 'restaurant', 'inn']
          : ['restaurant', 'tea-house', 'cafe', 'bookstore', 'inn'];
    const reachable = (business: BusinessSave) => {
      const entrance = this.graph.entrance(business.cellKey);
      return entrance && this.graph.canReach(from, entrance.key);
    };
    const favorite = open.find((business) => business.id === citizen.favoriteBusinessId && reachable(business));
    const employedAt = open.find((business) => business.employeeIds?.includes(citizen.id) && reachable(business));
    const options = owned && reachable(owned)
      ? [owned]
      : employedAt
        ? [employedAt]
        : favorite && choice > .25
          ? [favorite]
      : open.filter((business) => preferredTypes.includes(business.type) && reachable(business));
    const business = options[Math.floor(choice * options.length) % options.length];
    if (!business) return null;
    const target = this.graph.entrance(business.cellKey);
    if (!target) return null;
    return { business, target, owned: business.ownerId === citizen.id || business.employeeIds?.includes(citizen.id) === true };
  }

  private recordBusinessVisit(citizen: Citizen, business: BusinessSave) {
    citizen.businessVisits ??= {};
    citizen.businessVisits[business.id] = (citizen.businessVisits[business.id] ?? 0) + 1;
    if ((citizen.businessVisits[business.id] ?? 0) >= 3) citizen.favoriteBusinessId = business.id;
    this.pendingBusinessVisits.push({ businessId: business.id, citizenId: citizen.id });
    const tier = businessProsperityTier(business);
    const parcelChance = tier === 2 ? .82 : tier === 1 ? .52 : 0;
    if (!citizen.pendingParcelBusinessId
      && !citizen.carryingGood
      && hash(this.seed, Math.floor(this.currentHours * 4), this.citizens.indexOf(citizen), 1502) < parcelChance) {
      citizen.pendingParcelBusinessId = business.id;
      const entrance = this.graph.entrance(business.cellKey);
      if (entrance && citizen.model.position.distanceToSquared(entrance.position) < .01) {
        citizen.carryingParcel = true;
        citizen.activity = `collecting a parcel from ${business.name}`;
        citizen.nextDecisionAt = this.currentHours + .08;
      }
    }
  }

  private chooseFriendVisit(citizen: Citizen, choice: number, from: string) {
    const friends = citizen.relationships
      .map((id) => this.citizens.find((candidate) => candidate.id === id))
      .filter((friend): friend is Citizen => Boolean(friend));
    if (!friends.length) return null;
    const start = Math.floor(choice * friends.length) % friends.length;
    for (let offset = 0; offset < friends.length; offset++) {
      const friend = friends[(start + offset) % friends.length];
      const target = this.graph.entrance(friend.homeKey);
      if (target && this.graph.canReach(from, target.key)) return { friend, target };
    }
    return null;
  }

  private ownerActivity(type: BusinessType) {
    return {
      bakery: 'setting warm bread in the window',
      cafe: 'brewing tea for the morning tables',
      'flower-shop': 'tying fresh stems into little bundles',
      workshop: 'working with the door propped open',
      bookstore: 'stacking new arrivals by the window',
      fishmonger: 'arranging the morning catch',
      restaurant: 'preparing the long table for supper',
      'tea-house': 'warming the kettle for afternoon guests',
      inn: 'welcoming travelers from the quay',
      pottery: 'turning a small bowl at the wheel',
      mill: 'grinding grain between the millstones',
      smokehouse: 'hanging the morning catch over cedar smoke',
      weaver: 'passing the shuttle through blue thread',
      shipyard: 'fitting new ribs along a little keel',
    }[type];
  }

  private rooftopActivity(citizen: Citizen, feature: string | null) {
    if (citizen.occupation === 'Gardener' || feature?.includes('garden')) return 'tending the rooftop planters';
    if (citizen.ageGroup === 'child') return 'playing on the rooftop terrace';
    if (citizen.ageGroup === 'elder') return 'resting in the rooftop garden';
    if (citizen.traits.includes('sociable')) return 'meeting neighbors on the rooftop';
    if (citizen.traits.includes('quiet')) return 'watching the harbor from the rooftop';
    return feature === 'roof promenade' ? 'walking the roof promenade' : 'taking the air on the rooftop';
  }

  private visitorActivity(type: BusinessType) {
    return {
      bakery: 'buying a warm bun',
      cafe: 'lingering over a cup of tea',
      'flower-shop': 'choosing flowers for a neighbor',
      workshop: 'watching the artisan work',
      bookstore: 'browsing the shelf by the window',
      fishmonger: 'choosing fish for supper',
      restaurant: 'joining the evening supper table',
      'tea-house': 'sharing a quiet pot of tea',
      inn: 'listening to stories at the inn',
      pottery: 'turning a glazed cup in the light',
      mill: 'collecting a small sack of flour',
      smokehouse: 'choosing fish for a journey',
      weaver: 'feeling a new bolt of cloth',
      shipyard: 'watching a boat take shape',
    }[type] ?? `visiting the ${businessLabel(type)}`;
  }

  private speedFactor(citizen: Citizen) {
    const age = citizen.ageGroup === 'child' ? 1.15 : citizen.ageGroup === 'elder' ? .72 : 1;
    return age * (this.rainIntensity > .25 ? 1.25 : 1);
  }

  private walk(citizen: Citizen, deltaSeconds: number) {
    const target = citizen.path[0];
    if (!target) return;
    const direction = this.walkDirection.copy(target).sub(citizen.model.position);
    const perpendicular = this.laneOffset.set(direction.z, 0, -direction.x);
    if (perpendicular.lengthSq() > 1e-6) direction.addScaledVector(perpendicular.normalize(), citizen.lane);
    const distance = direction.length();
    const factor = this.speedFactor(citizen);
    const step = Math.min(distance, deltaSeconds * WALK_SPEED * factor);
    if (distance > .001) {
      direction.normalize();
      citizen.model.position.addScaledVector(direction, step);
      this.turnToward(citizen, Math.atan2(direction.x, direction.z), deltaSeconds * 9);
    }
    citizen.stepPhase += deltaSeconds * STRIDE_RATE * factor;
    const arrivalRadius = citizen.path.length > 1 ? .16 : .06;
    if (distance >= arrivalRadius) return;
    if (citizen.path.length === 1) {
      const aside = this.standingRoom(citizen, target, perpendicular);
      citizen.model.position.set(target.x + perpendicular.x * aside, target.y, target.z + perpendicular.z * aside);
    }
    citizen.path.shift();
    if (citizen.path.length) return;
    citizen.loiterHome = citizen.model.position.clone();
    if (citizen.carryingGood) {
      citizen.activity = `delivered the ${citizen.carryingGood.replace('-', ' ')}`;
      citizen.carryingGood = null;
      citizen.nextDecisionAt = Math.max(citizen.nextDecisionAt, this.currentHours + .12);
    } else if (citizen.pendingParcelBusinessId) {
      const shop = this.businesses.find((business) => business.id === citizen.pendingParcelBusinessId);
      const shopEntrance = shop ? this.graph.entrance(shop.cellKey) : undefined;
      const homeEntrance = this.graph.entrance(citizen.homeKey);
      if (!citizen.carryingParcel && shopEntrance?.key === citizen.targetKey) {
        citizen.carryingParcel = true;
        citizen.activity = `collecting a parcel from ${shop?.name ?? 'the shop'}`;
        citizen.nextDecisionAt = Math.min(citizen.nextDecisionAt, this.currentHours + .08);
      } else if (citizen.carryingParcel && homeEntrance?.key === citizen.targetKey) {
        citizen.carryingParcel = false;
        citizen.pendingParcelBusinessId = null;
        citizen.activity = 'putting away a parcel from the shops';
        citizen.nextDecisionAt = Math.max(citizen.nextDecisionAt, this.currentHours + .12);
      }
    }
  }

  /** Two people who arrive at one doorstep stand shoulder to shoulder instead of inside each other. */
  private standingRoom(citizen: Citizen, target: THREE.Vector3, perpendicular: THREE.Vector3) {
    const spot = this.laneTarget;
    for (const aside of [citizen.lane, citizen.lane + .17, citizen.lane - .17, citizen.lane + .34]) {
      spot.set(target.x + perpendicular.x * aside, target.y, target.z + perpendicular.z * aside);
      const taken = this.citizens.some((other) => other !== citizen && !other.path.length && !this.indoors(other) && other.model.position.distanceToSquared(spot) < .14 * .14);
      if (!taken) return aside;
    }
    return citizen.lane;
  }

  private turnToward(citizen: Citizen, heading: number, amount: number) {
    let difference = heading - citizen.heading;
    difference = Math.atan2(Math.sin(difference), Math.cos(difference));
    citizen.heading += difference * Math.min(1, amount);
    citizen.model.rotation.y = citizen.heading;
  }

  /** A short step to a neighbouring spot and back, so nobody stands frozen through a long wait. */
  private loiter(citizen: Citizen, realTime: number) {
    if (realTime < citizen.loiterAt) return;
    const restless = citizen.kind === 'stand' || citizen.kind === 'watch';
    citizen.loiterAt = realTime + 9 + hash(this.seed, Math.floor(realTime), citizenIndex(citizen.id), 917) * 14;
    if (!restless || !citizen.loiterHome) return;
    const here = this.graph.closest(citizen.model.position);
    if (!here) return;
    const away = citizen.model.position.distanceToSquared(citizen.loiterHome) > .04;
    if (away) {
      citizen.path = [citizen.loiterHome.clone()];
      return;
    }
    const links = [...here.links].map((key) => this.graph.nodes.get(key)).filter((node): node is NavNode => Boolean(node));
    const next = links[Math.floor(hash(this.seed, Math.floor(realTime), citizenIndex(citizen.id), 918) * links.length)];
    if (!next || Math.abs(next.position.y - here.position.y) > .01) return;
    citizen.path = [this.walkDirection.copy(next.position).sub(here.position).multiplyScalar(.5).add(here.position).clone()];
  }

  private animate(citizen: Citizen, deltaSeconds: number, realTime: number) {
    const walking = citizen.path.length > 0;
    const kind = citizen.kind;
    const dancing = kind === 'dance';
    const beat = realTime * 4.6 + citizen.stepPhase * .1;
    const time = realTime + citizenIndex(citizen.id) * 1.7;
    const target = this.poseTarget;
    Object.assign(target, REST_POSE);
    if (citizen.ageGroup === 'elder') target.lean = .1;
    if (!walking) {
      switch (kind) {
        case 'stand':
        case 'watch':
          if (citizen.idleVariant === 0) target.roll = Math.sin(time * 1.1) * .02;
          else if (citizen.idleVariant === 1 || kind === 'watch') target.headYaw = Math.sin(time * .6) * .5 + Math.sin(time * .23) * .3;
          else target.roll = Math.sin(time * .35) > 0 ? .03 : -.03;
          break;
        case 'sit':
          target.crouch = .16;
          target.legL = target.legR = -Math.PI / 2 + .1;
          target.armLX = target.armRX = -.55;
          target.lean = .12;
          target.headYaw = Math.sin(time * .4) * .25;
          break;
        case 'chat':
          target.headPitch = Math.sin(time * 3.1) * .05;
          if (citizen.chatLead) target.armRX = -.45 + Math.sin(time * 2.3) * .25;
          target.roll = Math.sin(time * .9) * .015;
          break;
        case 'wave':
          target.armRZ = 2.5 + Math.sin(time * 6) * .25;
          target.armRX = -.2;
          break;
        case 'sweep':
          target.armLX = target.armRX = -.95;
          target.lean = .18;
          target.twist = Math.sin(time * 2.4) * .4;
          break;
        case 'knead':
          target.armLX = target.armRX = -1.05 + Math.sin(time * 3.4) * .12;
          target.lean = .2;
          target.bob = -Math.abs(Math.sin(time * 3.4)) * .012;
          break;
        case 'hammer':
          target.armLX = -.9;
          target.armRX = -.5 - Math.abs(Math.sin(time * 4.2)) * .95;
          target.lean = .12;
          break;
        case 'cast':
          target.armRX = -1.35 + Math.sin(time * 1.1) * .2;
          target.armLX = -.7;
          target.lean = .05;
          break;
        default:
          break;
      }
    }
    if (citizen.carryingGood || citizen.carryingParcel) {
      target.armRX = -.75;
      target.armRZ = .3;
    }
    if (this.rainIntensity > .25) {
      target.armLX = -1.5;
      target.armLZ = -.25;
    } else if (this.night && walking) {
      target.armLX = -.55;
    }
    if (citizen.look.stick && !walking && kind !== 'sit') target.armRX = -.35;
    const damping = 1 - Math.exp(-deltaSeconds * 10);
    const pose = citizen.pose;
    for (const key of POSE_KEYS) pose[key] += (target[key] - pose[key]) * damping;
    citizen.walkWeight += ((walking ? 1 : 0) - citizen.walkWeight) * Math.min(1, deltaSeconds * 8);
    citizen.danceWeight += ((dancing ? 1 : 0) - citizen.danceWeight) * Math.min(1, deltaSeconds * 4);

    const walk = citizen.walkWeight;
    const dance = citizen.danceWeight;
    const child = citizen.ageGroup === 'child';
    const swing = Math.sin(citizen.stepPhase) * .55 * walk;
    const stickHand = citizen.look.stick ? 0 : 1;
    const bounce = Math.max(0, Math.sin(beat)) * (walking ? .025 : .065) * dance;
    const bob = pose.bob + Math.abs(Math.sin(citizen.stepPhase)) * (child ? .02 : .01) * walk + bounce - pose.crouch;
    const { parts, model } = citizen;
    const at = FIGURE_OFFSETS;
    parts.legs[0].rotation.x = pose.legL + swing;
    parts.legs[1].rotation.x = pose.legR - swing;
    parts.tunic.position.y = at.tunic + bob;
    parts.tunic.rotation.set(pose.lean + walk * .05, pose.twist, pose.roll + Math.sin(beat * .5) * .13 * dance);
    parts.head.position.set(0, at.head + bob, Math.sin(pose.lean) * .18);
    parts.head.rotation.set(pose.headPitch - pose.lean * .4, pose.headYaw, 0);
    parts.arms[0].position.y = at.shoulderY + bob;
    parts.arms[1].position.y = at.shoulderY + bob;
    parts.arms[0].rotation.set(pose.armLX - swing * .6 + Math.sin(beat * .5) * .35 * dance, 0, pose.armLZ - (.92 + Math.sin(beat) * .38) * dance);
    parts.arms[1].rotation.set(pose.armRX + swing * .6 * stickHand - Math.cos(beat * .5) * .35 * dance, 0, pose.armRZ + (.92 + Math.cos(beat) * .38) * dance);
    model.rotation.z = Math.sin(citizen.stepPhase) * .025 * walk + Math.sin(realTime * 2.1 + citizen.stepPhase) * .055 * dance;
    if (!walking && citizen.facePoint) {
      const toFace = this.walkDirection.copy(citizen.facePoint).sub(model.position);
      if (toFace.lengthSq() > .0004) this.turnToward(citizen, Math.atan2(toFace.x, toFace.z), deltaSeconds * 4);
    }
  }

  /** In the morning a child tags along with a household adult who is already on the way somewhere. */
  private householdGuardian(child: Citizen, from: string) {
    const guardian = this.citizens.find((other) => other !== child && other.householdId === child.householdId && other.ageGroup !== 'child' && other.path.length > 0 && other.targetKey);
    const target = guardian?.targetKey ? this.graph.nodes.get(guardian.targetKey) : undefined;
    if (!guardian || !target || !this.graph.canReach(from, target.key)) return null;
    return { citizen: guardian, target };
  }

  /** Doorstep visitors face the door; people who sit down face the open water. */
  private facingFor(citizen: Citizen, target: NavNode) {
    const cellKey = this.graph.entranceCells.get(target.key);
    if (cellKey) {
      const cell = parseCellKey(cellKey);
      return new THREE.Vector3(cell.x * CELL, target.position.y, cell.z * CELL);
    }
    if (citizen.kind === 'sit' || citizen.kind === 'watch') return target.position.clone().multiplyScalar(2);
    return null;
  }

  private faceEachOther(first: Citizen, second: Citizen) {
    first.kind = second.kind = 'chat';
    first.facePoint = second.model.position;
    second.facePoint = first.model.position;
    first.chatLead = true;
    second.chatLead = false;
  }

  beginDelivery(fromCellKey: string, toCellKey: string, good: CraftGood) {
    const source = this.graph.entrance(fromCellKey);
    const destination = this.graph.entrance(toCellKey);
    if (!source || !destination || !this.graph.canReach(source.key, destination.key)) return null;
    const owners = new Set(this.businesses.map((business) => business.ownerId));
    const candidates = this.citizens
      .filter((citizen) => citizen.ageGroup !== 'child' && citizen.residentKind !== 'visitor' && !citizen.carryingGood && !owners.has(citizen.id))
      .map((citizen) => ({ citizen, from: this.graph.closest(citizen.model.position) }))
      .filter((entry): entry is { citizen: Citizen; from: NavNode } => Boolean(entry.from && this.graph.canReach(entry.from.key, source.key)))
      .sort((a, b) => Number(b.citizen.occupation === 'Caretaker') - Number(a.citizen.occupation === 'Caretaker'));
    const chosen = candidates[0];
    if (!chosen) return null;
    chosen.citizen.path = [
      ...this.graph.path(chosen.from.key, source.key),
      ...this.graph.path(source.key, destination.key),
    ];
    chosen.citizen.targetKey = destination.key;
    chosen.citizen.carryingGood = good;
    chosen.citizen.activity = `carrying ${good.replace('-', ' ')} between workshops`;
    chosen.citizen.nextDecisionAt = this.currentHours + 1.2;
    return chosen.citizen.id;
  }

  private updateRelationships(deltaSeconds: number, hour: number, absoluteHours: number) {
    const bucketSize = .8;
    const buckets = new Map<string, Citizen[]>();
    for (const citizen of this.citizens) {
      const bx = Math.floor(citizen.model.position.x / bucketSize);
      const bz = Math.floor(citizen.model.position.z / bucketSize);
      const key = `${bx},${bz}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(citizen);
      buckets.set(key, bucket);
    }
    let comparisons = 0;
    for (const first of this.citizens) {
      const bx = Math.floor(first.model.position.x / bucketSize);
      const bz = Math.floor(first.model.position.z / bucketSize);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const second of buckets.get(`${bx + dx},${bz + dz}`) ?? []) {
          if (first.id >= second.id || comparisons++ >= 480) continue;
          if (first.model.position.distanceToSquared(second.model.position) > .16) continue;
          const key = `${first.id}|${second.id}`;
          const meeting = (this.meetingTime.get(key) ?? 0) + deltaSeconds;
          this.meetingTime.set(key, meeting);
          if (meeting > 12 && !first.relationships.includes(second.id)) {
            first.relationships.push(second.id);
            second.relationships.push(first.id);
            first.activity = `chatting with ${second.name}`;
            second.activity = `chatting with ${first.name}`;
            this.faceEachOther(first, second);
            this.nextSharedMoment.set(key, absoluteHours + .5);
          } else if (first.relationships.includes(second.id) && absoluteHours >= (this.nextSharedMoment.get(key) ?? 0)) {
            const activity = hour < 10 ? 'sharing breakfast with' : hour < 17 ? 'trading harbor news with' : hour < 21 ? 'sharing the evening with' : 'walking home beside';
            first.activity = `${activity} ${second.name}`;
            second.activity = `${activity} ${first.name}`;
            first.path = [];
            second.path = [];
            this.faceEachOther(first, second);
            first.nextDecisionAt = absoluteHours + .14;
            second.nextDecisionAt = absoluteHours + .14;
            this.nextSharedMoment.set(key, absoluteHours + 1.25);
          }
        }
      }
    }
  }

  citizenIdFrom(object: THREE.Object3D | null) {
    let current = object;
    while (current) {
      if (typeof current.userData.citizenId === 'string') return current.userData.citizenId as string;
      current = current.parent;
    }
    return null;
  }

  /** Pick one moving resident without raycasting every hidden source body part. */
  pick(raycaster: THREE.Raycaster) {
    let pickedId: string | null = null;
    let pickedDistance = Infinity;
    const renderedCount = Math.min(this.citizens.length, MAX_RENDERED_CITIZENS);
    for (let index = 0; index < renderedCount; index++) {
      const citizen = this.citizens[index];
      if (this.indoors(citizen)) continue;
      const scale = citizen.model.scale.x;
      this.pickCenter.copy(citizen.model.position);
      this.pickCenter.y += .3 * scale;
      raycaster.ray.closestPointToPoint(this.pickCenter, this.pickClosest);
      if (this.pickClosest.distanceToSquared(this.pickCenter) > .24 * .24 * scale * scale) continue;
      const distance = raycaster.ray.origin.distanceTo(this.pickClosest);
      if (distance < raycaster.near || distance > raycaster.far || distance >= pickedDistance) continue;
      pickedDistance = distance;
      pickedId = citizen.id;
    }
    return pickedId;
  }

  noticeDiscovery(activity: string) {
    for (const citizen of this.citizens.slice(0, 3)) {
      citizen.activity = activity;
      citizen.kind = kindFromText(activity);
      citizen.path = [];
      citizen.nextDecisionAt = this.currentHours + .12;
    }
  }

  beginMoment(activity: string, filter: { occupation?: string; ageGroup?: CitizenAgeGroup; favoriteBusinessType?: BusinessType }) {
    const favoriteBusinesses = filter.favoriteBusinessType
      ? new Set(this.businesses.filter((business) => business.type === filter.favoriteBusinessType).map((business) => business.id))
      : null;
    const participants = this.citizens.filter((citizen) =>
      (!filter.occupation || citizen.occupation === filter.occupation)
      && (!filter.ageGroup || citizen.ageGroup === filter.ageGroup)
      && (!favoriteBusinesses || Boolean(citizen.favoriteBusinessId && favoriteBusinesses.has(citizen.favoriteBusinessId))),
    );
    for (const citizen of participants.slice(0, 5)) {
      citizen.activity = activity;
      citizen.kind = kindFromText(activity);
      citizen.nextDecisionAt = Math.max(citizen.nextDecisionAt, this.currentHours + .4);
    }
    return participants.length;
  }

  assignOccupation(occupation: string, additional = false) {
    const existing = this.citizens.find((citizen) => citizen.occupation === occupation);
    if (existing && !additional) {
      existing.activity = `preparing to work as a ${occupation.toLowerCase()}`;
      return existing.id;
    }
    const businessOwners = new Set(this.businesses.map((business) => business.ownerId));
    const businessEmployees = new Set(this.businesses.flatMap((business) => business.employeeIds ?? []));
    const eligible = this.citizens
      .filter((candidate) => !businessOwners.has(candidate.id) && candidate.occupation !== occupation && candidate.ageGroup !== 'child' && candidate.residentKind !== 'visitor');
    const citizen = eligible
      .sort((a, b) => {
        const employeeDifference = Number(businessEmployees.has(a.id)) - Number(businessEmployees.has(b.id));
        if (employeeDifference !== 0) return employeeDifference;
        const waterEdges = (candidate: Citizen) => {
          const home = parseCellKey(candidate.homeKey);
          return CARDINALS.filter(([dx, dz]) => !this.cells.has(keyOf(home.x + dx, home.z + dz))).length;
        };
        return waterEdges(b) - waterEdges(a);
      })[0];
    if (!citizen) return null;
    citizen.occupation = occupation;
    citizen.activity = `preparing to work as a ${occupation.toLowerCase()}`;
    citizen.look = deriveLook(citizen, this.seed);
    return citizen.id;
  }

  spawnVisitor(name = 'Mara', occupation = 'Traveler') {
    const existing = this.citizens.find((citizen) => citizen.residentKind === 'visitor' && citizen.name === name);
    if (existing) {
      existing.activity = 'sharing a story from beyond the harbor';
      return existing.id;
    }
    const inn = this.businesses.find((business) => business.type === 'inn');
    const homeKey = inn?.cellKey ?? this.validHomes()[0];
    if (!homeKey) return null;
    const entrance = this.graph.entrance(homeKey)?.position ?? new THREE.Vector3();
    const index = this.nextCitizen++;
    const data: CitizenSave = {
      id: `citizen-${this.seed}-${index}`,
      name,
      homeKey,
      position: [entrance.x, entrance.z],
      elevation: entrance.y,
      occupation,
      traits: ['adventurous', 'curious'],
      relationships: [],
      color: Math.floor(hash(this.seed, index, 0, 1480) * TUNICS.length),
      ageGroup: 'adult',
      householdId: `visitor-${index}`,
      businessVisits: {},
      residentKind: 'visitor',
    };
    this.restoreCitizen(data, true);
    return data.id;
  }

  gatherAt(x: number, z: number, activity: string) {
    const focus = new THREE.Vector3(x * CELL, WALK_Y, z * CELL);
    const center = this.graph.closest(focus);
    if (!center) return;
    this.citizens.forEach((citizen, index) => {
      const from = this.graph.closest(citizen.model.position);
      if (!from || !this.graph.canReach(from.key, center.key)) return;
      const target = this.graph.randomNode((index * .173) % 1, from.key, (node) => node.position.distanceToSquared(center.position) < 5.5) ?? center;
      citizen.path = this.graph.path(from.key, target.key);
      citizen.targetKey = target.key;
      citizen.activity = activity;
      citizen.kind = kindFromText(activity);
      citizen.facePoint = center.position;
      citizen.nextDecisionAt = this.currentHours + 1.2;
    });
  }

  drainBusinessVisits() {
    const visits = this.pendingBusinessVisits;
    this.pendingBusinessVisits = [];
    return visits;
  }

  debugSpawnCitizen() {
    const home = this.validHomes()
      .filter((candidate) => this.residentCount(candidate) < this.homeCapacity(candidate))
      .sort((a, b) => this.residentCount(a) - this.residentCount(b))[0];
    if (!home) return this.spawnVisitor(`Newcomer ${this.nextCitizen + 1}`, 'Newcomer');
    this.spawnCitizen(home, this.residentCount(home) ? 'child' : 'adult');
    return this.citizens.at(-1)?.id ?? null;
  }

  setNavDebugVisible(visible: boolean) { this.debugRoot.visible = visible; }

  navStats() {
    return { nodes: this.graph.nodes.size, links: this.graph.debugPositions().length / 6 };
  }

  walkingCount() { return this.citizens.filter((citizen) => citizen.path.length > 0).length; }

  formationUseCounts() {
    const counts = new Map<FormationId, number>();
    for (const citizen of this.citizens) {
      if (!citizen.targetKey) continue;
      const id = this.graph.formationPlaces.get(citizen.targetKey);
      const title = id ? FORMATION_BY_ID.get(id)?.title : undefined;
      if (id && title && citizen.activity.toLowerCase().includes(title.toLowerCase())) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  identityUseCounts() {
    const counts = new Map<PlaceIdentityId, number>();
    for (const citizen of this.citizens) {
      if (!citizen.targetKey) continue;
      const id = this.graph.identityPlaces.get(citizen.targetKey);
      const definition = id ? PLACE_IDENTITY_BY_ID.get(id) : undefined;
      const title = this.graph.identityLandmarkPlaces.has(citizen.targetKey) ? definition?.landmark.title : definition?.title;
      if (id && title && citizen.activity.toLowerCase().includes(title.toLowerCase())) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  confluenceUseCounts() {
    const counts = new Map<ConfluenceId, number>();
    for (const citizen of this.citizens) {
      if (!citizen.targetKey) continue;
      const id = this.graph.confluencePlaces.get(citizen.targetKey);
      const definition = id ? CONFLUENCE_BY_ID.get(id) : undefined;
      const title = this.graph.confluenceLandmarkPlaces.has(citizen.targetKey) ? definition?.landmark.title : definition?.title;
      if (id && title && citizen.activity.toLowerCase().includes(title.toLowerCase())) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    return counts;
  }

  private rebuildDebugGraph() {
    const wasVisible = this.debugRoot.visible;
    this.debugRoot.traverse((object) => {
      if (object instanceof THREE.LineSegments) {
        object.geometry.dispose();
        if (object.material instanceof THREE.Material) object.material.dispose();
      }
    });
    this.debugRoot.clear();
    const positions = this.graph.debugPositions();
    if (positions.length) {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      const material = new THREE.LineBasicMaterial({ color: 0xff4fd8, transparent: true, opacity: .8, depthTest: false });
      const lines = new THREE.LineSegments(geometry, material);
      lines.renderOrder = 12;
      this.debugRoot.add(lines);
    }
    this.debugRoot.visible = wasVisible;
  }

  /** World position of a resident, or null when the resident is gone. */
  positionOf(id: string) {
    return this.citizens.find((item) => item.id === id)?.model.position ?? null;
  }

  card(id: string): CitizenCard | null {
    const citizen = this.citizens.find((item) => item.id === id);
    if (!citizen) return null;
    const home = parseCellKey(citizen.homeKey);
    const friends = citizen.relationships
      .map((friendId) => this.citizens.find((item) => item.id === friendId)?.name)
      .filter(Boolean);
    return {
      id,
      name: citizen.name,
      occupation: citizen.occupation,
      home: citizen.residentKind === 'visitor'
        ? `Staying at ${this.businesses.find((business) => business.cellKey === citizen.homeKey)?.name ?? 'the harbor'}`
        : `${citizen.ageGroup === 'child' ? 'Child' : citizen.ageGroup === 'elder' ? 'Elder' : 'Adult'} in household ${home.x + 10}/${home.z + 10}`,
      likes: `${citizen.traits.join(', ')}${citizen.favoriteBusinessId ? ` · regular at ${this.businesses.find((business) => business.id === citizen.favoriteBusinessId)?.name ?? 'a local shop'}` : ''}`,
      activity: citizen.activity,
      destination: this.destinationLabel(citizen),
      relationship: friends.length ? `Friends with ${friends.join(', ')}` : 'Still getting to know the neighbors',
    };
  }

  private destinationLabel(citizen: Citizen) {
    if (!citizen.targetKey) return 'Staying here';
    const confluence = this.graph.confluenceLabel(citizen.targetKey);
    if (confluence && citizen.activity.toLowerCase().includes(confluence.toLowerCase())) return confluence;
    const identity = this.graph.identityLabel(citizen.targetKey);
    if (identity && citizen.activity.toLowerCase().includes(identity.toLowerCase())) return identity;
    const formation = this.graph.formationLabel(citizen.targetKey);
    if (formation && citizen.activity.toLowerCase().includes(formation.toLowerCase())) return formation;
    if (this.graph.entrance(citizen.homeKey)?.key === citizen.targetKey) {
      return citizen.residentKind === 'visitor' ? 'Lodgings' : 'Home';
    }
    const business = this.businesses.find((candidate) => this.graph.entrance(candidate.cellKey)?.key === citizen.targetKey);
    if (business) return business.name;
    if (this.graph.plazas.includes(citizen.targetKey)) return 'Harbor plaza';
    const rooftop = this.graph.rooftopLabel(citizen.targetKey);
    if (rooftop) return rooftop === 'rooftop deck' ? 'A rooftop' : rooftop.replace(/^./, (letter) => letter.toUpperCase());
    const friend = this.citizens.find((candidate) => candidate.id !== citizen.id
      && citizen.relationships.includes(candidate.id)
      && this.graph.entrance(candidate.homeKey)?.key === citizen.targetKey);
    if (friend) return `${friend.name}'s home`;
    if (/water|tide|harbor|boat|quay/.test(citizen.activity)) return 'Waterfront';
    return citizen.path.length ? 'A nearby street' : 'Staying here';
  }

  population() { return this.citizens.length; }

  residents() { return this.serialize(); }

  serialize(): CitizenSave[] {
    return this.citizens.map((citizen) => ({
      id: citizen.id,
      name: citizen.name,
      homeKey: citizen.homeKey,
      position: [citizen.model.position.x, citizen.model.position.z],
      elevation: citizen.model.position.y,
      occupation: citizen.occupation,
      traits: [...citizen.traits],
      relationships: [...citizen.relationships],
      color: citizen.color,
      ageGroup: citizen.ageGroup,
      householdId: citizen.householdId,
      favoriteBusinessId: citizen.favoriteBusinessId,
      businessVisits: { ...(citizen.businessVisits ?? {}) },
      residentKind: citizen.residentKind,
    }));
  }
}
