import * as THREE from 'three';
import { businessLabel, businessOccupation, isBusinessOpen } from './businesses';
import { CARDINALS, type BusinessSave, type BusinessType, type Cell, type CitizenAgeGroup, type CitizenSave, keyOf } from './types';
import { hash, pick } from './random';
import { findPlazaAnchors } from './topology';
import {
  arcadeFeature, isRoofAccessCell, isWalkableRoof, roofAccessDirection, roofCourtFeature, walkableSteppedTerrace,
} from './architecture';
import {
  CELL_SIZE, FLOOR_HEIGHT, GROUND_WALK_Y, HIGH_CROSSING_WALK_Y, QUAY_PATH_OFFSET,
  TERRACE_STEP_COUNT, terraceStepOutward, terraceStepWalkY, roofWalkY,
} from './spatial';

const CELL = CELL_SIZE;
const FLOOR = FLOOR_HEIGHT;
const EDGE = CELL / 2;
const WALK_OUT = QUAY_PATH_OFFSET;
const WALK_Y = GROUND_WALK_Y;
const BRIDGE_Y = HIGH_CROSSING_WALK_Y;
const NAMES = ['Mei', 'Ren', 'Aiko', 'Hana', 'Jun', 'Mina', 'Sora', 'Tomo', 'Yuna', 'Bo', 'Kiko', 'Nori', 'Aya', 'Kenji', 'Momo', 'Lin', 'Haru', 'Emi'];
const TRAITS = ['sociable', 'quiet', 'ambitious', 'curious', 'artistic', 'industrious', 'dreamy', 'patient', 'adventurous'];
const OCCUPATIONS = ['Baker', 'Fisher', 'Gardener', 'Teacher', 'Bookbinder', 'Caretaker', 'Cartographer', 'Cook'];
const CLOTHES = [0xc9564d, 0xd99a42, 0x457b78, 0x536c92, 0xa75e77, 0x718551];
const MAX_RENDERED_CITIZENS = 512;

type NavNode = {
  key: string;
  position: THREE.Vector3;
  links: Set<string>;
};

type Citizen = CitizenSave & {
  model: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
  body: THREE.Object3D;
  head: THREE.Object3D;
  hair: THREE.Object3D;
  hat: THREE.Object3D | null;
  path: THREE.Vector3[];
  targetKey: string | null;
  nextDecisionAt: number;
  activity: string;
  stepPhase: number;
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
  readonly plazas: string[] = [];
  readonly rooftops = new Map<string, string>();
  private readonly cells: Map<string, Cell>;
  private readonly seed: number;

  constructor(cells: Map<string, Cell>, seed: number) {
    this.cells = cells;
    this.seed = seed;
    this.build();
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
        this.entrances.set(keyOf(cell.x, cell.z), this.addNode(cell.x * CELL + dx * WALK_OUT, cell.z * CELL + dz * WALK_OUT));
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
    for (const node of this.nodes.values()) {
      const next = node.position.distanceToSquared(position);
      if (next < distance) {
        distance = next;
        closest = node;
      }
    }
    return closest;
  }

  randomNode(value: number, from: string, predicate?: (node: NavNode) => boolean) {
    const reachable = new Set<string>();
    const pending = [from];
    while (pending.length) {
      const key = pending.pop()!;
      if (reachable.has(key)) continue;
      reachable.add(key);
      for (const neighbor of this.nodes.get(key)?.links ?? []) pending.push(neighbor);
    }
    const component = [...this.nodes.values()].filter((node) => reachable.has(node.key));
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

  rooftopNode(value: number, from: string) {
    const reachable = new Set<string>();
    const pending = [from];
    while (pending.length) {
      const key = pending.pop()!;
      if (reachable.has(key)) continue;
      reachable.add(key);
      for (const neighbor of this.nodes.get(key)?.links ?? []) pending.push(neighbor);
    }
    const options = [...this.rooftops.keys()].filter((key) => reachable.has(key));
    if (!options.length) return undefined;
    return this.nodes.get(options[Math.floor(value * options.length) % options.length]);
  }

  rooftopLabel(key: string) { return this.rooftops.get(key) ?? null; }

  canReach(from: string, to: string) {
    if (from === to) return true;
    const visited = new Set([from]);
    const pending = [from];
    while (pending.length) {
      const key = pending.pop()!;
      for (const neighbor of this.nodes.get(key)?.links ?? []) {
        if (neighbor === to) return true;
        if (visited.has(neighbor)) continue;
        visited.add(neighbor);
        pending.push(neighbor);
      }
    }
    return false;
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
  private readonly skinMaterial = new THREE.MeshStandardMaterial({ color: 0xd9a47c, roughness: .9 });
  private readonly darkMaterial = new THREE.MeshStandardMaterial({ color: 0x3f3432, roughness: 1 });
  private readonly hatMaterial = new THREE.MeshStandardMaterial({ color: 0xc79d58, roughness: 1 });
  private readonly clothesMaterials = CLOTHES.map((color) => new THREE.MeshStandardMaterial({ color, roughness: .95 }));
  private readonly bodyGeometry = new THREE.CapsuleGeometry(.09, .16, 3, 7);
  private readonly headGeometry = new THREE.SphereGeometry(.09, 9, 7);
  private readonly hairGeometry = new THREE.SphereGeometry(.094, 9, 6, 0, Math.PI * 2, 0, Math.PI * .48);
  private readonly legGeometry = new THREE.CylinderGeometry(.022, .027, .17, 6);
  private readonly hatGeometry = new THREE.ConeGeometry(.145, .065, 12);
  private readonly bodyInstances: THREE.InstancedMesh[];
  private readonly headInstances: THREE.InstancedMesh;
  private readonly hairInstances: THREE.InstancedMesh;
  private readonly legInstances: THREE.InstancedMesh;
  private readonly hatInstances: THREE.InstancedMesh;
  private readonly renderMatrix = new THREE.Matrix4();

  constructor(seed: number, cells: Map<string, Cell>, saved: CitizenSave[]) {
    this.seed = seed;
    this.cells = cells;
    this.graph = new NavGraph(cells, seed);
    this.root.name = 'citizens';
    this.renderRoot.name = 'citizen-instance-batches';
    this.bodyInstances = this.clothesMaterials.map((material, index) => this.createInstanceBatch(this.bodyGeometry, material, `citizen-bodies-${index}`));
    this.headInstances = this.createInstanceBatch(this.headGeometry, this.skinMaterial, 'citizen-heads');
    this.hairInstances = this.createInstanceBatch(this.hairGeometry, this.darkMaterial, 'citizen-hair');
    this.legInstances = this.createInstanceBatch(this.legGeometry, this.darkMaterial, 'citizen-legs');
    this.hatInstances = this.createInstanceBatch(this.hatGeometry, this.hatMaterial, 'citizen-hats');
    this.renderRoot.add(...this.bodyInstances, this.headInstances, this.hairInstances, this.legInstances, this.hatInstances);
    this.debugRoot.name = 'citizen-navigation';
    this.debugRoot.visible = false;
    this.root.add(this.renderRoot, this.debugRoot);
    for (const data of saved) this.restoreCitizen(data);
    this.nextCitizen = this.citizens.reduce((largest, citizen) => {
      const index = Number(citizen.id.split('-').at(-1));
      return Number.isFinite(index) ? Math.max(largest, index) : largest;
    }, -1) + 1;
    this.reconcileHomes();
    this.rebuildDebugGraph();
    this.updateRenderInstances();
  }

  private createInstanceBatch(geometry: THREE.BufferGeometry, material: THREE.Material, name: string) {
    const mesh = new THREE.InstancedMesh(geometry, material, MAX_RENDERED_CITIZENS * (name === 'citizen-legs' ? 2 : 1));
    mesh.name = name;
    mesh.count = 0;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // Picking uses the original invisible parts so an instance ID never has to
    // be translated back through color-specific body batches.
    mesh.raycast = () => {};
    return mesh;
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
    for (const business of businesses) {
      const owner = this.citizens.find((citizen) => citizen.id === business.ownerId);
      if (owner && owner.occupation !== 'Fisher') owner.occupation = businessOccupation(business.type);
      for (const employeeId of business.employeeIds ?? []) {
        const employee = this.citizens.find((citizen) => citizen.id === employeeId);
        if (employee && employee.occupation !== 'Fisher') employee.occupation = `${businessOccupation(business.type)}’s helper`;
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
      color: Math.floor(hash(this.seed, cell.x, cell.z, 905) * CLOTHES.length),
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
    const model = this.createModel(normalized);
    model.position.set(data.position[0], data.elevation ?? WALK_Y, data.position[1]);
    // Routes are not persisted. Snap restored residents back to the rebuilt
    // graph so saves made with older surface heights do not leave them afloat.
    const restoredNode = this.graph.closest(model.position);
    if (restoredNode) model.position.copy(restoredNode.position);
    if (movingIn) model.scale.setScalar(.01);
    this.root.add(model);
    this.citizens.push({
      ...normalized,
      traits: [...normalized.traits],
      relationships: [...normalized.relationships],
      model,
      leftLeg: model.userData.leftLeg as THREE.Object3D,
      rightLeg: model.userData.rightLeg as THREE.Object3D,
      body: model.userData.body as THREE.Object3D,
      head: model.userData.head as THREE.Object3D,
      hair: model.userData.hair as THREE.Object3D,
      hat: model.userData.hat as THREE.Object3D | null,
      path: [],
      targetKey: null,
      nextDecisionAt: 0,
      activity: movingIn ? 'moving in' : 'watching the tide',
      stepPhase: hash(this.seed, this.citizens.length, 0, 906) * Math.PI * 2,
    });
  }

  private removeCitizen(citizen: Citizen) {
    this.root.remove(citizen.model);
    this.citizens.splice(this.citizens.indexOf(citizen), 1);
  }

  private createModel(data: CitizenSave) {
    const group = new THREE.Group();
    group.userData.citizenId = data.id;
    const clothes = this.clothesMaterials[data.color % this.clothesMaterials.length];
    const body = new THREE.Mesh(this.bodyGeometry, clothes);
    body.name = 'citizen-body';
    body.position.y = .285;
    const head = new THREE.Mesh(this.headGeometry, this.skinMaterial);
    head.name = 'citizen-head';
    head.position.y = .5;
    const hair = new THREE.Mesh(this.hairGeometry, this.darkMaterial);
    hair.name = 'citizen-hair';
    hair.position.y = .515;
    const legs: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(this.legGeometry, this.darkMaterial);
      leg.position.set(side * .047, .085, 0);
      leg.name = side < 0 ? 'leg-left' : 'leg-right';
      legs.push(leg);
      group.add(leg);
    }
    let hat: THREE.Mesh | null = null;
    if (data.occupation === 'Fisher' || data.occupation === 'Gardener') {
      hat = new THREE.Mesh(this.hatGeometry, this.hatMaterial);
      hat.name = 'occupation-hat';
      hat.position.y = .61;
      group.add(hat);
    }
    group.add(body, head, hair);
    group.userData.leftLeg = legs[0];
    group.userData.rightLeg = legs[1];
    group.userData.body = body;
    group.userData.head = head;
    group.userData.hair = hair;
    group.userData.hat = hat;
    const targetScale = data.ageGroup === 'child' ? .76 : data.ageGroup === 'elder' ? .94 : 1;
    group.userData.targetScale = targetScale;
    group.scale.setScalar(targetScale);
    group.traverse((object) => { object.userData.citizenId = data.id; });
    for (const child of group.children) child.visible = false;
    return group;
  }

  update(deltaSeconds: number, timeOfDay: number, absoluteHours: number, realTime: number) {
    this.currentHours = absoluteHours;
    for (const citizen of this.citizens) {
      const targetScale = citizen.model.userData.targetScale as number ?? 1;
      if (citizen.model.scale.x < targetScale - .01) {
        const scale = Math.min(targetScale, citizen.model.scale.x + deltaSeconds * 1.8);
        citizen.model.scale.setScalar(scale);
      }
      if (!citizen.path.length && absoluteHours >= citizen.nextDecisionAt) this.chooseRoutine(citizen, timeOfDay, absoluteHours);
      this.walk(citizen, deltaSeconds, realTime);
    }
    this.relationshipAccumulator += deltaSeconds;
    if (this.relationshipAccumulator >= 1) {
      this.updateRelationships(this.relationshipAccumulator, timeOfDay, absoluteHours);
      this.relationshipAccumulator = 0;
    }
    this.updateRenderInstances();
  }

  private setActorPart(batch: THREE.InstancedMesh, index: number, model: THREE.Group, part: THREE.Object3D) {
    model.updateMatrix();
    part.updateMatrix();
    batch.setMatrixAt(index, this.renderMatrix.multiplyMatrices(model.matrix, part.matrix));
  }

  private updateRenderInstances() {
    const bodyCounts = this.bodyInstances.map(() => 0);
    let heads = 0;
    let hairs = 0;
    let legs = 0;
    let hats = 0;
    for (const citizen of this.citizens.slice(0, MAX_RENDERED_CITIZENS)) {
      const color = citizen.color % this.bodyInstances.length;
      this.setActorPart(this.bodyInstances[color], bodyCounts[color]++, citizen.model, citizen.body);
      this.setActorPart(this.headInstances, heads++, citizen.model, citizen.head);
      this.setActorPart(this.hairInstances, hairs++, citizen.model, citizen.hair);
      this.setActorPart(this.legInstances, legs++, citizen.model, citizen.leftLeg);
      this.setActorPart(this.legInstances, legs++, citizen.model, citizen.rightLeg);
      if (citizen.hat) this.setActorPart(this.hatInstances, hats++, citizen.model, citizen.hat);
    }
    this.bodyInstances.forEach((batch, index) => {
      batch.count = bodyCounts[index];
      if (batch.count) batch.instanceMatrix.needsUpdate = true;
    });
    for (const [batch, count] of [[this.headInstances, heads], [this.hairInstances, hairs], [this.legInstances, legs], [this.hatInstances, hats]] as const) {
      batch.count = count;
      if (count) batch.instanceMatrix.needsUpdate = true;
    }
  }

  private chooseRoutine(citizen: Citizen, hour: number, absoluteHours: number) {
    const home = this.graph.entrance(citizen.homeKey);
    const from = this.graph.closest(citizen.model.position);
    if (!from) return;
    let target = home;
    const choice = hash(this.seed, Math.floor(absoluteHours * 4), this.citizens.indexOf(citizen), 1001);
    const businessVisit = this.chooseBusinessVisit(citizen, hour, choice, from.key);
    const rooftopChance = citizen.occupation === 'Gardener' ? .62 : citizen.ageGroup === 'elder' ? .4 : .3;
    const rooftop = hour >= 7 && hour < 21 && (citizen.ageGroup !== 'child' || hour >= 15) && choice < rooftopChance
      ? this.graph.rooftopNode((choice * 3.17 + this.citizens.indexOf(citizen) * .137) % 1, from.key)
      : undefined;
    if (hour < 4.5 || (hour < 6 && citizen.occupation !== 'Fisher') || hour >= 22) {
      citizen.activity = 'sleeping at home';
    } else if (businessVisit?.owned) {
      citizen.activity = this.ownerActivity(businessVisit.business.type);
      target = businessVisit.target;
    } else if (citizen.ageGroup === 'child' && hour < 15) {
      const plaza = this.discoveries.has('birds-nest') ? this.graph.plazaNode(choice, from.key) : undefined;
      citizen.activity = plaza ? 'feeding the birds in the plaza after lessons' : this.discoveries.has('birds-nest') ? 'looking up at the tower nest after lessons' : 'walking to lessons with a neighbor';
      target = plaza ?? this.graph.randomNode(choice, from.key);
    } else if (rooftop) {
      citizen.activity = this.rooftopActivity(citizen, this.graph.rooftopLabel(rooftop.key));
      target = rooftop;
    } else if (citizen.ageGroup === 'elder' && hour >= 14 && hour < 18) {
      citizen.activity = 'resting by the water and greeting passersby';
      target = this.graph.randomNode(choice, from.key, (node) => Math.hypot(node.position.x, node.position.z) > 3);
    } else if (hour < 9) {
      if (businessVisit) {
        citizen.activity = this.visitorActivity(businessVisit.business.type);
        target = businessVisit.target;
      } else {
        citizen.activity = citizen.occupation === 'Fisher'
          ? this.discoveries.has('silver-shoal') ? 'following the silver shoal toward the nets' : 'checking the morning tide'
          : 'taking an early walk';
        target = this.graph.randomNode(choice, from.key, (node) => Math.hypot(node.position.x, node.position.z) > 2);
      }
    } else if (hour < 12) {
      if (businessVisit && choice > .35) {
        citizen.activity = this.visitorActivity(businessVisit.business.type);
        target = businessVisit.target;
      } else {
        citizen.activity = `working as a ${citizen.occupation.toLowerCase()}`;
        target = this.graph.randomNode(choice, from.key);
      }
    } else if (hour < 14) {
      const plaza = choice < .34 ? this.graph.plazaNode(choice * 2.7, from.key) : undefined;
      citizen.activity = businessVisit ? this.visitorActivity(businessVisit.business.type) : plaza ? 'sitting in the plaza' : 'looking for lunch';
      target = businessVisit?.target ?? plaza ?? this.graph.randomNode(choice, from.key);
    } else if (hour < 18) {
      if (businessVisit && choice > .55) {
        citizen.activity = this.visitorActivity(businessVisit.business.type);
        target = businessVisit.target;
      } else {
        const fishmonger = this.discoveries.has('harbor-cats') && (citizen.traits.includes('curious') || citizen.traits.includes('sociable')) && choice < .22
          ? this.businesses.find((business) => business.type === 'fishmonger')
          : undefined;
        const catVisit = fishmonger ? this.graph.entrance(fishmonger.cellKey) : undefined;
        const friendVisit = catVisit || citizen.traits.includes('quiet') ? null : this.chooseFriendVisit(citizen, choice, from.key);
        citizen.activity = catVisit
          ? 'stopping to greet the harbor cats'
          : friendVisit
            ? `visiting ${friendVisit.friend.name} at home`
            : citizen.traits.includes('quiet') ? 'watching the harbor' : 'walking past the neighbors’ doors';
        target = catVisit ?? friendVisit?.target ?? this.graph.randomNode(choice, from.key);
      }
    } else if (hour < 21) {
      if (businessVisit) {
        citizen.activity = this.visitorActivity(businessVisit.business.type);
        target = businessVisit.target;
      } else {
        citizen.activity = citizen.traits.includes('sociable') ? 'taking an evening stroll' : 'heading home slowly';
        target = this.graph.randomNode(choice, from.key);
      }
    } else {
      citizen.activity = 'walking home beneath the lanterns';
    }
    if (!target) return;
    if (businessVisit && !businessVisit.owned && target.key === businessVisit.target.key) this.recordBusinessVisit(citizen, businessVisit.business);
    citizen.targetKey = target.key;
    citizen.path = this.graph.path(from.key, target.key);
    citizen.nextDecisionAt = absoluteHours + .35 + choice * .65;
  }

  private chooseBusinessVisit(citizen: Citizen, hour: number, choice: number, from: string) {
    const open = this.businesses.filter((business) => isBusinessOpen(business.type, hour));
    const owned = open.find((business) => business.ownerId === citizen.id);
    const preferredTypes: BusinessType[] = hour < 9
      ? ['bakery', 'fishmonger', 'flower-shop']
      : hour < 15
        ? ['cafe', 'tea-house', 'bakery', 'flower-shop', 'bookstore', 'fishmonger', 'workshop', 'pottery', 'restaurant']
        : hour < 19
          ? ['workshop', 'pottery', 'flower-shop', 'bookstore', 'cafe', 'tea-house', 'restaurant', 'inn']
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
    }[type] ?? `visiting the ${businessLabel(type)}`;
  }

  private walk(citizen: Citizen, deltaSeconds: number, realTime: number) {
    const target = citizen.path[0];
    const left = citizen.leftLeg;
    const right = citizen.rightLeg;
    if (!target) {
      citizen.model.rotation.z = Math.sin(realTime * 1.4 + citizen.stepPhase) * .006;
      if (left && right) left.rotation.x = right.rotation.x = 0;
      return;
    }
    const direction = this.walkDirection.copy(target).sub(citizen.model.position);
    const distance = direction.length();
    const step = Math.min(distance, deltaSeconds * .58);
    if (distance > .001) {
      direction.normalize();
      citizen.model.position.addScaledVector(direction, step);
      citizen.model.rotation.y = Math.atan2(direction.x, direction.z);
    }
    citizen.stepPhase += deltaSeconds * 8;
    citizen.model.rotation.z = Math.sin(citizen.stepPhase) * .025;
    if (left && right) {
      left.rotation.x = Math.sin(citizen.stepPhase) * .5;
      right.rotation.x = -Math.sin(citizen.stepPhase) * .5;
    }
    if (distance < .055) {
      citizen.model.position.x = target.x;
      citizen.model.position.y = target.y;
      citizen.model.position.z = target.z;
      citizen.path.shift();
    }
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
            this.nextSharedMoment.set(key, absoluteHours + .5);
          } else if (first.relationships.includes(second.id) && absoluteHours >= (this.nextSharedMoment.get(key) ?? 0)) {
            const activity = hour < 10 ? 'sharing breakfast with' : hour < 17 ? 'trading harbor news with' : hour < 21 ? 'sharing the evening with' : 'walking home beside';
            first.activity = `${activity} ${second.name}`;
            second.activity = `${activity} ${first.name}`;
            first.path = [];
            second.path = [];
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

  noticeDiscovery(activity: string) {
    for (const citizen of this.citizens.slice(0, 3)) {
      citizen.activity = activity;
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
    if ((occupation === 'Fisher' || occupation === 'Gardener') && !citizen.model.getObjectByName('occupation-hat')) {
      const hat = new THREE.Mesh(this.hatGeometry, this.hatMaterial);
      hat.name = 'occupation-hat';
      hat.position.y = .61;
      hat.userData.citizenId = citizen.id;
      hat.visible = false;
      citizen.model.add(hat);
      citizen.model.userData.hat = hat;
      citizen.hat = hat;
    }
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
      color: Math.floor(hash(this.seed, index, 0, 1480) * CLOTHES.length),
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
        : `${citizen.ageGroup === 'child' ? 'Child' : citizen.ageGroup === 'elder' ? 'Elder' : 'Adult'} in household ${home.x + 10}–${home.z + 10}`,
      likes: `${citizen.traits.join(', ')}${citizen.favoriteBusinessId ? ` · regular at ${this.businesses.find((business) => business.id === citizen.favoriteBusinessId)?.name ?? 'a local shop'}` : ''}`,
      activity: citizen.activity,
      destination: this.destinationLabel(citizen),
      relationship: friends.length ? `Friends with ${friends.join(', ')}` : 'Still getting to know the neighbors',
    };
  }

  private destinationLabel(citizen: Citizen) {
    if (!citizen.targetKey) return 'Staying here';
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
    if (friend) return `${friend.name}’s home`;
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
