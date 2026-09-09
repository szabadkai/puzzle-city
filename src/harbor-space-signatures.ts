import * as THREE from 'three';
import { CARDINALS, keyOf, type Cell } from './types.ts';
import type { HarborSpace, SpacePoint } from './harbor-spaces.ts';

export type SpaceMaterials = Record<'stone' | 'dark' | 'wood' | 'cream' | 'green' | 'cloth' | 'light', THREE.Material>;

export const SPACE_SIGNATURES = {
  'sheltered-basin': 'Tide Landing',
  'working-basin': 'Twin Cargo Derricks',
  'boat-haven': 'Harbor Beacons',
  'pocket-lane': 'Moon Gate',
  'through-lane': 'Green Pergola',
  'market-lanes': 'Market Crown',
} as const;

function signaturePoint(space: HarborSpace, cells: ReadonlyMap<string, Cell>): SpacePoint {
  if (space.kind === 'basin') {
    const [dx, dz] = CARDINALS[space.direction];
    const ordered = [...space.tiles].sort((a, b) => a.x * dx + a.z * dz - b.x * dx - b.z * dz || a.z - b.z || a.x - b.x);
    // Haven marks the actual mouth. The other two occupy a back-bank berth.
    if (space.id === 'boat-haven') return ordered.at(-1)!;
    const back = ordered.filter((point) => point.x * dx + point.z * dz === ordered[0].x * dx + ordered[0].z * dz);
    return back.at(-1)!;
  }
  const neighbors = (point: SpacePoint) => CARDINALS.filter(([dx, dz]) =>
    !cells.has(keyOf(point.x + dx, point.z + dz))).length;
  if (space.id === 'market-lanes') return [...space.tiles].sort((a, b) => neighbors(b) - neighbors(a) || a.z - b.z || a.x - b.x)[0];
  return space.tiles[Math.floor((space.tiles.length - 1) / 2)];
}

/** Authored silhouettes sit inside the detected footprint; all ground-level
 * supports stay off the central walking axes and the clear boat channel. */
export function buildSpaceSignature(parent: THREE.Group, x: number, z: number, space: HarborSpace, cells: ReadonlyMap<string, Cell>, m: SpaceMaterials) {
  const anchor = signaturePoint(space, cells);
  const primary = anchor.x === x && anchor.z === z;
  const [forwardX, forwardZ] = CARDINALS[space.direction];
  const backTiles = space.kind === 'basin'
    ? space.tiles.filter((point) => cells.has(keyOf(point.x - forwardX, point.z - forwardZ)))
    : [];
  const lateralX = forwardZ, lateralZ = -forwardX;
  backTiles.sort((a, b) => a.x * lateralX + a.z * lateralZ - b.x * lateralX - b.z * lateralZ);
  const onBackLanding = backTiles.some((point) => point.x === x && point.z === z);
  const onDerrickEnd = space.id === 'working-basin' && (
    backTiles[0]?.x === x && backTiles[0]?.z === z ||
    backTiles.at(-1)?.x === x && backTiles.at(-1)?.z === z
  );
  if (!primary && space.id !== 'through-lane' && !(space.id === 'sheltered-basin' && onBackLanding) && !onDerrickEnd) return;
  const g = new THREE.Group();
  g.name = `space-signature-${space.id}`;
  if (primary) parent.userData.spaceSignature = SPACE_SIGNATURES[space.id as keyof typeof SPACE_SIGNATURES];
  parent.add(g);
  const mesh = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material, px: number, py: number, pz: number) => {
    const item = new THREE.Mesh(geometry, material); item.name = name;
    item.position.set(px, py, pz); item.castShadow = true; item.receiveShadow = true; g.add(item); return item;
  };
  const box = (name: string, w: number, h: number, d: number, px: number, py: number, pz: number, material = m.wood) =>
    mesh(name, new THREE.BoxGeometry(w, h, d), material, px, py, pz);
  const beam = (name: string, a: number[], b: number[], radius = .035, material = m.wood) => {
    const from = new THREE.Vector3(...a), to = new THREE.Vector3(...b), delta = to.clone().sub(from);
    const item = mesh(name, new THREE.CylinderGeometry(radius, radius, delta.length(), 7), material, 0, 0, 0);
    item.position.copy(from).add(to).multiplyScalar(.5);
    item.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize()); return item;
  };
  const lantern = (px: number, py: number, pz: number, scale = 1) => {
    mesh('signature-lantern', new THREE.SphereGeometry(.12 * scale, 8, 6), m.light, px, py, pz).scale.y = 1.35;
    box('lantern-cap', .23 * scale, .035, .23 * scale, px, py + .15 * scale, pz, m.dark);
  };

  if (space.kind === 'basin') {
    // Local +z faces the sea for every rotated basin.
    const [dx, dz] = CARDINALS[space.direction];
    g.rotation.y = Math.atan2(dx, dz);
    if (space.id === 'sheltered-basin') {
      // Every back-bank tile contributes a bay, turning the full width into a
      // continuous civic landing instead of a single prop beside one house.
      for (let step = 0; step < 3; step++) box('tide-landing-step', 2.28, .12, .25, 0, .06 - step * .1, -.93 + step * .22, m.stone);
      box('tide-landing-gallery', 2.32, .1, .72, 0, .18, -.88, m.cream);
      for (const side of [-1.08, 1.08]) {
        box('landing-pier', .11, 1.95, .11, side, .91, -.87, m.green);
        beam('landing-brace', [side, 1.1, -.87], [side * .55, 1.65, -.87], .035, m.cream);
      }
      box('landing-lintel', 2.35, .16, .21, 0, 1.83, -.87, m.green);
      for (const side of [-1, 1]) {
        const roof = box('landing-tiled-roof', 1.28, .07, .78, side * .58, 2.02, -.79, m.green);
        roof.rotation.z = -side * .18;
      }
      for (const side of [-.72, 0, .72]) box('landing-balustrade', .08, .65, .08, side, .55, -.48, m.green);
      box('landing-rail', 1.62, .065, .065, 0, .87, -.48, m.green);
      if (primary) {
        box('tide-board', .42, .63, .05, .8, .9, -.8, m.cream);
        for (let tick = 0; tick < 5; tick++) box('tide-mark', tick % 2 ? .12 : .22, .026, .015, .8, .68 + tick * .1, -.765, m.dark);
        lantern(0, 1.5, -.8);
      }
    } else if (space.id === 'working-basin') {
      box('derrick-plinth', .4, .28, .34, .75, .12, -.88, m.stone);
      beam('derrick-mast', [.75, .25, -.88], [.75, 2.75, -.88], .095, m.green);
      beam('derrick-boom', [.75, 1.95, -.88], [-.75, 2.65, .35], .075, m.wood);
      beam('derrick-stay', [.75, 2.72, -.88], [-.75, 2.65, .35], .015, m.cream);
      beam('derrick-hoist', [-.75, 2.65, .35], [-.75, 1.45, .35], .017, m.dark);
      const pulley = mesh('derrick-pulley', new THREE.TorusGeometry(.13, .025, 6, 12), m.dark, -.75, 2.63, .35);
      pulley.rotation.y = .7;
      box('suspended-cargo', .45, .38, .4, -.75, 1.2, .35, m.wood);
      for (const offset of [-.14, .14]) box('cargo-strapping', .035, .4, .42, -.75 + offset, 1.2, .35, m.cream);
      beam('derrick-backstay', [.75, 2.7, -.88], [-.8, .14, -1.02], .018, m.cream);
      mesh('winch-wheel', new THREE.TorusGeometry(.23, .035, 6, 14), m.green, .75, .66, -.64);
    } else {
      // Independent beacons at the mouth leave the full middle channel open.
      for (const side of [-1, 1]) {
        box('beacon-foot', .28, .42, .35, side * 1.06, .1, 0, m.stone);
        box('beacon-column', .14, 1.8, .14, side * 1.06, 1.05, 0, side < 0 ? m.cloth : m.green);
        for (const height of [.55, 1.1, 1.65]) box('beacon-band', .155, .12, .155, side * 1.06, height, 0, m.cream);
        lantern(side * 1.06, 2.04, 0, 1.4);
        const cap = mesh('beacon-cap', new THREE.ConeGeometry(.26, .2, 4), m.green, side * 1.06, 2.31, 0);
        cap.rotation.y = Math.PI / 4;
        beam('beacon-pennant-pole', [side * 1.06, 2.3, 0], [side * 1.06, 2.78, 0], .02, m.dark);
        const shape = new THREE.Shape(); shape.moveTo(0, 0); shape.lineTo(-side * .52, -.12); shape.lineTo(0, -.25); shape.closePath();
        mesh('flag', new THREE.ShapeGeometry(shape), side < 0 ? m.cloth : m.cream, side * 1.06, 2.73, 0);
      }
    }
    return;
  }

  const wallAcrossX = cells.has(keyOf(x - 1, z)) && cells.has(keyOf(x + 1, z));
  const wallAcrossZ = cells.has(keyOf(x, z - 1)) && cells.has(keyOf(x, z + 1));
  if (!wallAcrossX && wallAcrossZ) g.rotation.y = Math.PI / 2;
  if (space.id === 'pocket-lane') {
    const arch = new THREE.Shape();
    arch.absarc(0, .95, 1.05, 0, Math.PI, false);
    arch.lineTo(-.81, .95); arch.absarc(0, .95, .81, Math.PI, 0, true); arch.closePath();
    const stoneArch = mesh('moon-gate-arch', new THREE.ExtrudeGeometry(arch, { depth: .2, bevelEnabled: false }), m.cream, 0, 0, .66);
    stoneArch.receiveShadow = true;
    for (const side of [-1, 1]) {
      box('moon-gate-pier', .24, .78, .24, side * .93, .57, .76, m.cream);
      box('moon-gate-foot', .33, .13, .32, side * .93, .24, .76, m.green);
    }
    mesh('moon-gate-medallion', new THREE.CircleGeometry(.12, 12), m.green, 0, 1.88, .872);
    box('gate-threshold', 1.48, .008, .28, 0, .185, .76, m.green);
  } else if (space.id === 'through-lane') {
    for (const end of [-.78, .78]) {
      for (const side of [-1, 1]) {
        box('pergola-post', .085, 1.65, .085, side * 1.04, 1.005, end, m.green);
        beam('pergola-bracket', [side * 1.04, 1.4, end], [side * .65, 1.84, end], .035, m.cream);
      }
      box('pergola-crossbeam', 2.25, .13, .12, 0, 1.88, end, m.green);
    }
    for (const side of [-1, 1]) {
      box('pergola-roof-wing', .54, .065, 2.42, side * .82, 2.02, 0, m.green);
      for (const offset of [-.75, 0, .75]) box('pergola-rib', .6, .035, .045, side * .82, 2.07, offset, m.cream);
    }
    if (primary) lantern(0, 1.66, -.78);
  } else {
    // One four-wing canopy at the actual junction; its open sides frame the
    // branching streets and its corner supports leave all four routes clear.
    for (const px of [-.89, .89]) for (const pz of [-.89, .89]) {
      box('market-crown-post', .09, 1.75, .09, px, 1.05, pz, m.green);
      lantern(px, 1.66, pz, .75);
    }
    for (let direction = 0; direction < 4; direction++) {
      const wing = new THREE.Group(); wing.rotation.y = direction * Math.PI / 2;
      for (let stripe = 0; stripe < 5; stripe++) {
        const roof = new THREE.Mesh(new THREE.BoxGeometry(.42, .055, 1.02), stripe % 2 ? m.cream : m.cloth);
        roof.position.set((stripe - 2) * .42, 2.12, .54); roof.rotation.x = .22; roof.castShadow = true; wing.add(roof);
        const valance = new THREE.Mesh(new THREE.BoxGeometry(.42, .18, .035), stripe % 2 ? m.cream : m.cloth);
        valance.position.set((stripe - 2) * .42, 1.92, 1.03); wing.add(valance);
      }
      g.add(wing);
    }
    mesh('market-crown-roof', new THREE.ConeGeometry(.62, .45, 4), m.green, 0, 2.48, 0).rotation.y = Math.PI / 4;
    mesh('market-crown-finial', new THREE.SphereGeometry(.1, 8, 6), m.cream, 0, 2.8, 0);
  }
}
