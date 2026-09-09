import * as THREE from 'three';
import { CARDINALS, type Cell, keyOf } from './types';
import { CELL_SIZE as CELL, GROUND_WALK_Y } from './spatial';
import type { HarborSpace } from './harbor-spaces';

type Materials = Record<'stone' | 'dark' | 'wood' | 'cream' | 'green' | 'cloth', THREE.Material>;

/** Small pieces share CityRenderer's palette materials and static batching. */
export function buildHarborSpace(group: THREE.Group, x: number, z: number, space: HarborSpace, cells: ReadonlyMap<string, Cell>, m: Materials, businessCells: ReadonlyMap<string, unknown>) {
  group.userData.harborSpace = space.id;
  const box = (name: string, w: number, h: number, d: number, px: number, py: number, pz: number, material: THREE.Material) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.name = name; mesh.position.set(px, py, pz); mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); return mesh;
  };
  const banks = CARDINALS.map(([dx, dz], direction) => ({ dx, dz, direction }))
    .filter(({ dx, dz }) => cells.has(keyOf(x + dx, z + dz)));
  if (space.kind === 'lane') {
    box('lane-paving', CELL, .22, CELL, 0, GROUND_WALK_Y - .11, 0, m.stone);
    // A recessed-looking central gutter keeps the long passage legible.
    const alongZ = banks.some(({ dx }) => dx !== 0);
    box('lane-drain', alongZ ? .045 : CELL, .008, alongZ ? CELL : .045, 0, GROUND_WALK_Y + .004, 0, m.dark);
    for (const offset of [-.8, -.4, .4, .8]) {
      box('lane-paving-joint', alongZ ? CELL : .015, .006, alongZ ? .015 : CELL, alongZ ? 0 : offset, GROUND_WALK_Y + .003, alongZ ? offset : 0, m.dark);
    }
    const bank = banks.find(({ dx, dz }) => !businessCells.has(keyOf(x + dx, z + dz)));
    if (bank) {
      const { dx, dz } = bank;
      // Keep the centerline and the route from each door clear.
      const px = dx * .86 + dz * .62, pz = dz * .86 - dx * .62;
      box('lane-stool-seat', .28, .065, .28, px, .42, pz, m.wood);
      for (const side of [-.09, .09]) box('lane-stool-leg', .045, .22, .2, px + side, .29, pz, m.wood);
      if (space.id !== 'pocket-lane') {
        box('lane-goods-table', dx ? .35 : .62, .08, dx ? .62 : .35, dx * .85 - dz * .64, .63, dz * .85 + dx * .64, m.wood);
        box('lane-goods-crate', .24, .25, .24, dx * .85 - dz * .64, .37, dz * .85 + dx * .64, m.green);
      }
    }
    const opposite = banks.find(({ dx, dz }) => banks.some((bank) => bank.dx === -dx && bank.dz === -dz));
    if (opposite) {
      const { dx, dz } = opposite;
      box('lane-laundry-line', dx ? CELL * 1.02 : .014, .014, dz ? CELL * 1.02 : .014, 0, 1.5, 0, m.dark);
      for (const side of [-.48, 0, .48]) {
        box('laundry-lane-cloth', dx ? .29 : .014, .36, dz ? .29 : .014, dx * side, 1.31, dz * side, side === 0 ? m.cream : m.cloth);
      }
    }
    if (space.id === 'market-lanes' && bank) {
      const canopy = box('lane-market-awning', bank.dx ? .62 : 1.15, .045, bank.dz ? .62 : 1.15,
        bank.dx * .86, 1.18, bank.dz * .86, m.cloth);
      canopy.rotation.set(bank.dz * .12, 0, -bank.dx * .12);
    }
    return;
  }

  // Basin water is never covered by a foundation. Its whole shoreline changes
  // with the form, so the result reads as a made place rather than a ring of
  // ordinary houses with one decorative prop.
  const ledgeMaterial = space.id === 'sheltered-basin' ? m.cream : space.id === 'working-basin' ? m.stone : m.wood;
  const ledgeDepth = space.id === 'working-basin' ? .5 : space.id === 'sheltered-basin' ? .4 : .28;
  for (const { dx, dz } of banks) {
    box(space.id + '-quay', dx ? ledgeDepth : CELL, space.id === 'working-basin' ? .22 : .13,
      dz ? ledgeDepth : CELL, dx * (1.18 - ledgeDepth / 2), .025, dz * (1.18 - ledgeDepth / 2), ledgeMaterial);
    if (space.id === 'sheltered-basin') {
      // Pale double steps make the full inlet edge feel like one calm landing.
      box('tide-terrace-lower-step', dx ? .2 : CELL, .075, dz ? .2 : CELL,
        dx * .76, -.08, dz * .76, m.stone);
      box('tide-terrace-green-inlay', dx ? .025 : CELL * .78, .012, dz ? .025 : CELL * .78,
        dx * .91, .103, dz * .91, m.green);
    }
    if (space.id === 'working-basin') {
      // Heavy aprons, bumpers and safety marks repeat around the working edge.
      for (const offset of [-.64, 0, .64]) {
        box('cargo-quay-stripe', dx ? .045 : .28, .018, dz ? .045 : .28,
          dx * .91 + dz * offset, .15, dz * .91 - dx * offset, offset === 0 ? m.green : m.cream);
      }
      box('cargo-quay-bumper', dx ? .09 : .34, .32, dz ? .09 : .34,
        dx * .72, -.02, dz * .72, m.dark);
    }
    for (const offset of [-.72, .72]) {
      box('basin-mooring-post', space.id === 'working-basin' ? .12 : .085,
        space.id === 'working-basin' ? .5 : .42, space.id === 'working-basin' ? .12 : .085,
        dx * .98 + dz * offset, .1, dz * .98 - dx * offset, space.id === 'sheltered-basin' ? m.green : m.wood);
    }
  }
  const index = space.tiles.findIndex((point) => point.x === x && point.z === z);
  const backBank = banks.find(({ direction }) => direction === (space.direction + 2) % 4);
  const boatBanks = space.tiles.filter((point) => {
    const [dx, dz] = CARDINALS[(space.direction + 2) % 4];
    return cells.has(keyOf(point.x + dx, point.z + dz));
  });
  const mooringTiles = space.id === 'boat-haven'
    ? space.tiles.filter((point) => CARDINALS.some(([dx, dz]) => cells.has(keyOf(point.x + dx, point.z + dz))))
    : boatBanks;
  const boatIndex = mooringTiles.findIndex((point) => point.x === x && point.z === z);
  const boatLimit = space.id === 'sheltered-basin' ? 1 : space.id === 'working-basin' ? 3 : 6;
  const boatBank = space.id === 'boat-haven' ? banks[boatIndex % Math.max(1, banks.length)] : backBank;
  if (boatBank && boatIndex >= 0 && boatIndex < boatLimit) {
    const bank = boatBank;
    const vessel = new THREE.Group(); vessel.name = 'basin-moored-sampan';
    const shape = new THREE.Shape();
    shape.moveTo(-.66, 0); shape.lineTo(-.44, -.24); shape.lineTo(.42, -.24);
    shape.lineTo(.69, 0); shape.lineTo(.42, .24); shape.lineTo(-.44, .24); shape.closePath();
    const geometry = new THREE.ExtrudeGeometry(shape, { depth: .16, bevelEnabled: false }); geometry.rotateX(-Math.PI / 2);
    const hull = new THREE.Mesh(geometry, m.wood); hull.position.y = -.18; vessel.add(hull);
    for (const offset of [-.33, .25]) {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(.15, .05, .42), m.cream); seat.position.set(offset, .005, 0); vessel.add(seat);
    }
    const oar = new THREE.Mesh(new THREE.BoxGeometry(1.05, .025, .065), m.wood); oar.rotation.y = .3; oar.position.y = .08; vessel.add(oar);
    if (space.id === 'working-basin') {
      vessel.name = 'basin-cargo-lighter';
      vessel.scale.set(1.28, 1, 1.16);
      for (const [cx, cz, material] of [[-.3, -.1, m.green], [.02, .1, m.cream], [.3, -.08, m.cloth]] as const) {
        const cargo = new THREE.Mesh(new THREE.BoxGeometry(.25, .2, .25), material);
        cargo.name = 'lighter-cargo'; cargo.position.set(cx, .19, cz); cargo.castShadow = true; vessel.add(cargo);
      }
    }
    if (space.id === 'boat-haven') {
      const canopy = new THREE.Mesh(new THREE.CylinderGeometry(.27, .27, .54, 8, 1, true, 0, Math.PI), m.cream);
      canopy.rotation.z = Math.PI / 2; canopy.position.set(-.12, .06, 0); vessel.add(canopy);
      const pennant = new THREE.Mesh(new THREE.ConeGeometry(.08, .25, 3), boatIndex % 2 ? m.green : m.cloth);
      pennant.name = 'haven-pennant'; pennant.rotation.z = Math.PI / 2; pennant.position.set(.36, .25, 0); vessel.add(pennant);
    }
    const stagger = (boatIndex % 3 - 1) * .22;
    vessel.position.set(bank.dx * .48 + bank.dz * stagger, 0, bank.dz * .48 - bank.dx * stagger);
    vessel.rotation.y = bank.dx ? Math.PI / 2 : 0;
    group.add(vessel);
    box('basin-mooring-rope', bank.dx ? .4 : .018, .018, bank.dz ? .4 : .018, bank.dx * .82, .02, bank.dz * .82, m.cream);
  }
  if (banks.length && space.id === 'working-basin' && index % 2 === 0) {
    const { dx, dz } = banks[0];
    box('basin-gear-chest', .23, .22, .23, dx * 1.03 + dz * .48, .2, dz * 1.03 - dx * .48, m.green);
    box('cargo-crate-stack', .42, .38, .36, dx * .88 - dz * .42, .35, dz * .88 + dx * .42, index % 4 ? m.wood : m.cloth);
    box('cargo-crate-band', .44, .045, .38, dx * .88 - dz * .42, .4, dz * .88 + dx * .42, m.cream);
    for (const offset of [-.12, 0, .12]) box('basin-net-rack', dx ? .025 : .62, .025, dz ? .025 : .62,
      dx * .98, .35 + offset, dz * .98, m.cream);
  }
  if (space.id === 'boat-haven') {
    const [dx, dz] = CARDINALS[space.direction], lx = dz, lz = -dx;
    const front = Math.max(...space.tiles.map((point) => point.x * dx + point.z * dz));
    if (x * dx + z * dz === front) {
      // A line of bright floats marks the narrow mouth even when the beacons
      // are hidden behind roofs from the current camera angle.
      for (const offset of [-.72, -.36, 0, .36, .72]) {
        box('haven-mouth-float', .17, .11, .17, lx * offset - dx * .52, .015, lz * offset - dz * .52,
          Math.abs(offset) < .1 ? m.cloth : m.cream);
      }
      box('haven-mouth-boom', Math.abs(lx) ? 1.72 : .035, .025, Math.abs(lz) ? 1.72 : .035,
        -dx * .52, .015, -dz * .52, m.dark);
    }
  }
}
