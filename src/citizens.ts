import * as THREE from 'three';
import { CARDINALS, type Cell, type CitizenSave, keyOf } from './types';
import { hash, pick } from './random';

const CELL = 2.45;
const EDGE = CELL / 2;
const WALK_OUT = EDGE + .24;
const WALK_Y = .27;
const NAMES = ['Mei', 'Ren', 'Aiko', 'Hana', 'Jun', 'Mina', 'Sora', 'Tomo', 'Yuna', 'Bo', 'Kiko', 'Nori', 'Aya', 'Kenji', 'Momo', 'Lin', 'Haru', 'Emi'];
const TRAITS = ['sociable', 'quiet', 'curious', 'artistic', 'industrious', 'dreamy', 'patient', 'adventurous'];
const OCCUPATIONS = ['Baker', 'Fisher', 'Gardener', 'Teacher', 'Bookbinder', 'Caretaker', 'Cartographer', 'Cook'];
const CLOTHES = [0xc9564d, 0xd99a42, 0x457b78, 0x536c92, 0xa75e77, 0x718551];

type NavNode = {
  key: string;
  position: THREE.Vector3;
  links: Set<string>;
};

type Citizen = CitizenSave & {
  model: THREE.Group;
  leftLeg: THREE.Object3D;
  rightLeg: THREE.Object3D;
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
  relationship: string;
};

function nodeKey(x: number, z: number) {
  return `${Math.round(x * 100)},${Math.round(z * 100)}`;
}

function parseCellKey(key: string) {
  const [x, z] = key.split(',').map(Number);
  return { x, z };
}

export class NavGraph {
  readonly nodes = new Map<string, NavNode>();
  readonly entrances = new Map<string, string>();
  private readonly cells: Map<string, Cell>;
  private readonly seed: number;

  constructor(cells: Map<string, Cell>, seed: number) {
    this.cells = cells;
    this.seed = seed;
    this.build();
  }

  private addNode(x: number, z: number) {
    const key = nodeKey(x, z);
    if (!this.nodes.has(key)) this.nodes.set(key, { key, position: new THREE.Vector3(x, WALK_Y, z), links: new Set() });
    return key;
  }

  private connect(a: string, b: string) {
    if (a === b) return;
    this.nodes.get(a)?.links.add(b);
    this.nodes.get(b)?.links.add(a);
  }

  private build() {
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

  randomNode(value: number, predicate?: (node: NavNode) => boolean) {
    const options = [...this.nodes.values()].filter((node) => !predicate || predicate(node));
    return options.length ? options[Math.floor(value * options.length) % options.length] : undefined;
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
}

export class CitizenSystem {
  readonly root = new THREE.Group();
  private readonly seed: number;
  private readonly citizens: Citizen[] = [];
  private graph: NavGraph;
  private cells: Map<string, Cell>;
  private nextCitizen = 0;
  private meetingTime = new Map<string, number>();
  private relationshipAccumulator = 0;
  private readonly walkDirection = new THREE.Vector3();
  private readonly skinMaterial = new THREE.MeshStandardMaterial({ color: 0xd9a47c, roughness: .9 });
  private readonly darkMaterial = new THREE.MeshStandardMaterial({ color: 0x3f3432, roughness: 1 });
  private readonly hatMaterial = new THREE.MeshStandardMaterial({ color: 0xc79d58, roughness: 1 });
  private readonly clothesMaterials = CLOTHES.map((color) => new THREE.MeshStandardMaterial({ color, roughness: .95 }));
  private readonly bodyGeometry = new THREE.CapsuleGeometry(.105, .19, 3, 7);
  private readonly headGeometry = new THREE.SphereGeometry(.105, 9, 7);
  private readonly hairGeometry = new THREE.SphereGeometry(.109, 9, 6, 0, Math.PI * 2, 0, Math.PI * .48);
  private readonly legGeometry = new THREE.CylinderGeometry(.025, .03, .2, 6);
  private readonly hatGeometry = new THREE.ConeGeometry(.18, .08, 12);

  constructor(seed: number, cells: Map<string, Cell>, saved: CitizenSave[]) {
    this.seed = seed;
    this.cells = cells;
    this.graph = new NavGraph(cells, seed);
    this.root.name = 'citizens';
    for (const data of saved) this.restoreCitizen(data);
    this.nextCitizen = this.citizens.reduce((largest, citizen) => {
      const index = Number(citizen.id.split('-').at(-1));
      return Number.isFinite(index) ? Math.max(largest, index) : largest;
    }, -1) + 1;
    this.reconcileHomes();
  }

  rebuild(cells: Map<string, Cell>) {
    this.cells = cells;
    this.graph = new NavGraph(cells, this.seed);
    for (const citizen of this.citizens) {
      citizen.path = [];
      citizen.targetKey = null;
    }
    this.reconcileHomes();
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
      const freeHome = homes.find((home) => !this.citizens.some((other) => other !== citizen && other.homeKey === home));
      if (freeHome) {
        citizen.homeKey = freeHome;
      } else {
        this.removeCitizen(citizen);
      }
    }

    const occupied = new Set(this.citizens.map((citizen) => citizen.homeKey));
    for (const home of homes) {
      if (!occupied.has(home)) this.spawnCitizen(home);
    }
  }

  private spawnCitizen(homeKey: string) {
    const index = this.nextCitizen++;
    const cell = parseCellKey(homeKey);
    const nameOffset = Math.floor(hash(this.seed, cell.x, cell.z, 901) * NAMES.length);
    let name = NAMES[(nameOffset + index) % NAMES.length];
    if (this.citizens.some((citizen) => citizen.name === name)) name = `${name} ${String.fromCharCode(65 + index % 26)}.`;
    const traitA = pick(TRAITS, hash(this.seed, cell.x, cell.z, 902));
    const traitB = pick(TRAITS.filter((trait) => trait !== traitA), hash(this.seed, cell.x, cell.z, 903));
    const entrance = this.graph.entrance(homeKey)?.position ?? new THREE.Vector3(cell.x * CELL, WALK_Y, cell.z * CELL);
    const data: CitizenSave = {
      id: `citizen-${this.seed}-${index}`,
      name,
      homeKey,
      position: [entrance.x, entrance.z],
      occupation: pick(OCCUPATIONS, hash(this.seed, cell.x, cell.z, 904)),
      traits: [traitA, traitB],
      relationships: [],
      color: Math.floor(hash(this.seed, cell.x, cell.z, 905) * CLOTHES.length),
    };
    this.restoreCitizen(data, true);
  }

  private restoreCitizen(data: CitizenSave, movingIn = false) {
    const model = this.createModel(data);
    model.position.set(data.position[0], WALK_Y, data.position[1]);
    if (movingIn) model.scale.setScalar(.01);
    this.root.add(model);
    this.citizens.push({
      ...data,
      traits: [...data.traits],
      relationships: [...data.relationships],
      model,
      leftLeg: model.userData.leftLeg as THREE.Object3D,
      rightLeg: model.userData.rightLeg as THREE.Object3D,
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
    body.position.y = .34;
    const head = new THREE.Mesh(this.headGeometry, this.skinMaterial);
    head.position.y = .62;
    const hair = new THREE.Mesh(this.hairGeometry, this.darkMaterial);
    hair.position.y = .64;
    const legs: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      const leg = new THREE.Mesh(this.legGeometry, this.darkMaterial);
      leg.position.set(side * .055, .13, 0);
      leg.name = side < 0 ? 'leg-left' : 'leg-right';
      legs.push(leg);
      group.add(leg);
    }
    if (data.occupation === 'Fisher' || data.occupation === 'Gardener') {
      const hat = new THREE.Mesh(this.hatGeometry, this.hatMaterial);
      hat.position.y = .72;
      group.add(hat);
    }
    group.add(body, head, hair);
    group.userData.leftLeg = legs[0];
    group.userData.rightLeg = legs[1];
    group.traverse((object) => { object.userData.citizenId = data.id; });
    return group;
  }

  update(deltaSeconds: number, timeOfDay: number, absoluteHours: number, realTime: number) {
    for (const citizen of this.citizens) {
      if (citizen.model.scale.x < .99) {
        const scale = Math.min(1, citizen.model.scale.x + deltaSeconds * 1.8);
        citizen.model.scale.setScalar(scale);
      }
      if (!citizen.path.length && absoluteHours >= citizen.nextDecisionAt) this.chooseRoutine(citizen, timeOfDay, absoluteHours);
      this.walk(citizen, deltaSeconds, realTime);
    }
    this.relationshipAccumulator += deltaSeconds;
    if (this.relationshipAccumulator >= 1) {
      this.updateRelationships(this.relationshipAccumulator);
      this.relationshipAccumulator = 0;
    }
  }

  private chooseRoutine(citizen: Citizen, hour: number, absoluteHours: number) {
    const home = this.graph.entrance(citizen.homeKey);
    let target = home;
    const choice = hash(this.seed, Math.floor(absoluteHours * 4), this.citizens.indexOf(citizen), 1001);
    if (hour < 6 || hour >= 22) {
      citizen.activity = 'sleeping at home';
    } else if (hour < 9) {
      citizen.activity = citizen.occupation === 'Fisher' ? 'checking the morning tide' : 'taking an early walk';
      target = this.graph.randomNode(choice, (node) => Math.hypot(node.position.x, node.position.z) > 2);
    } else if (hour < 12) {
      citizen.activity = `working as a ${citizen.occupation.toLowerCase()}`;
      target = this.graph.randomNode(choice);
    } else if (hour < 14) {
      citizen.activity = 'looking for lunch';
      target = this.graph.randomNode(choice);
    } else if (hour < 18) {
      citizen.activity = citizen.traits.includes('quiet') ? 'watching the harbor' : 'visiting a neighbor';
      target = this.graph.randomNode(choice);
    } else if (hour < 21) {
      citizen.activity = citizen.traits.includes('sociable') ? 'taking an evening stroll' : 'heading home slowly';
      target = this.graph.randomNode(choice);
    } else {
      citizen.activity = 'walking home beneath the lanterns';
    }
    if (!target) return;
    const from = this.graph.closest(citizen.model.position);
    if (!from) return;
    citizen.targetKey = target.key;
    citizen.path = this.graph.path(from.key, target.key);
    citizen.nextDecisionAt = absoluteHours + .35 + choice * .65;
  }

  private walk(citizen: Citizen, deltaSeconds: number, realTime: number) {
    const target = citizen.path[0];
    const left = citizen.leftLeg;
    const right = citizen.rightLeg;
    if (!target) {
      citizen.model.position.y = WALK_Y + Math.sin(realTime * 1.4 + citizen.stepPhase) * .006;
      if (left && right) left.rotation.x = right.rotation.x = 0;
      return;
    }
    const direction = this.walkDirection.copy(target).sub(citizen.model.position);
    direction.y = 0;
    const distance = direction.length();
    const step = Math.min(distance, deltaSeconds * .58);
    if (distance > .001) {
      direction.normalize();
      citizen.model.position.addScaledVector(direction, step);
      citizen.model.rotation.y = Math.atan2(direction.x, direction.z);
    }
    citizen.stepPhase += deltaSeconds * 8;
    citizen.model.position.y = WALK_Y + Math.abs(Math.sin(citizen.stepPhase)) * .025;
    if (left && right) {
      left.rotation.x = Math.sin(citizen.stepPhase) * .5;
      right.rotation.x = -Math.sin(citizen.stepPhase) * .5;
    }
    if (distance < .055) {
      citizen.model.position.x = target.x;
      citizen.model.position.z = target.z;
      citizen.path.shift();
    }
  }

  private updateRelationships(deltaSeconds: number) {
    for (let a = 0; a < this.citizens.length; a++) for (let b = a + 1; b < this.citizens.length; b++) {
      const first = this.citizens[a];
      const second = this.citizens[b];
      if (first.model.position.distanceToSquared(second.model.position) > .16) continue;
      const key = `${first.id}|${second.id}`;
      const time = (this.meetingTime.get(key) ?? 0) + deltaSeconds;
      this.meetingTime.set(key, time);
      if (time > 12 && !first.relationships.includes(second.id)) {
        first.relationships.push(second.id);
        second.relationships.push(first.id);
        first.activity = `chatting with ${second.name}`;
        second.activity = `chatting with ${first.name}`;
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
      home: `Lives by quay ${home.x + 10}–${home.z + 10}`,
      likes: citizen.traits.join(', '),
      activity: citizen.activity,
      relationship: friends.length ? `Friends with ${friends.join(', ')}` : 'Still getting to know the neighbors',
    };
  }

  population() { return this.citizens.length; }

  serialize(): CitizenSave[] {
    return this.citizens.map((citizen) => ({
      id: citizen.id,
      name: citizen.name,
      homeKey: citizen.homeKey,
      position: [citizen.model.position.x, citizen.model.position.z],
      occupation: citizen.occupation,
      traits: [...citizen.traits],
      relationships: [...citizen.relationships],
      color: citizen.color,
    }));
  }
}
