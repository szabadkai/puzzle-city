import * as THREE from 'three';

type NookMaterials = { wood: THREE.Material; metal: THREE.Material; cream: THREE.Material; green: THREE.Material; accent: THREE.Material };

/** Small domestic scenes fit the existing rooftop furniture footprint. */
export function buildRooftopNook(kind: 'mahjong' | 'tea' | 'reading', m: NookMaterials) {
  const root = new THREE.Group();
  root.name = `rooftop-${kind}-corner`;
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, name: string) => {
    const object = new THREE.Mesh(geometry, material);
    object.position.set(x, y, z);
    object.name = name;
    object.receiveShadow = true;
    root.add(object);
    return object;
  };
  const box = (w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, name: string) =>
    mesh(new THREE.BoxGeometry(w, h, d), material, x, y, z, name);
  const cylinder = (r: number, h: number, material: THREE.Material, x: number, y: number, z: number, name: string) =>
    mesh(new THREE.CylinderGeometry(r, r * .9, h, 10), material, x, y, z, name);

  // Open chair frames, slatted backs and cushions read as furniture at street scale.
  for (const side of [-1, 1]) {
    const z = side * .37;
    box(.25, .035, .24, m.wood, 0, .17, z, 'chair-seat');
    box(.22, .025, .2, m.accent, 0, .2, z, 'chair-cushion');
    for (const x of [-.095, .095]) for (const dz of [-.085, .085]) {
      box(.025, .16, .025, m.metal, x, .08, z + dz, 'chair-leg');
    }
    for (const x of [-.095, .095]) box(.022, .23, .022, m.metal, x, .27, z + side * .1, 'chair-back-post');
    for (const y of [.28, .35]) box(.23, .035, .025, m.wood, 0, y, z + side * .1, 'chair-back-slat');
  }
  box(.49, .045, .43, kind === 'mahjong' ? m.green : m.wood, 0, .29, 0, `rooftop-${kind}-table`);
  for (const x of [-.19, .19]) for (const z of [-.16, .16]) box(.03, .27, .03, m.metal, x, .135, z, 'table-leg');

  const cup = (x: number, z: number) => {
    cylinder(.027, .045, m.cream, x, .337, z, 'tea-cup');
    cylinder(.019, .003, m.wood, x, .361, z, 'tea-in-cup');
  };
  if (kind === 'mahjong') {
    for (const side of [-1, 1]) for (let i = 0; i < 5; i++) {
      box(.043, .048, .026, m.cream, (i - 2) * .052, .337, side * .14, 'mahjong-tile');
      box(.012, .018, .003, m.green, (i - 2) * .052, .341, side * .14 + side * .015, 'mahjong-mark');
    }
    for (let i = 0; i < 3; i++) box(.04, .018, .055, m.cream, -.05 + i * .055, .322, .01, 'discarded-tile').rotation.y = i * .38;
    cup(.18, -.03);
  } else if (kind === 'tea') {
    box(.27, .015, .19, m.accent, 0, .32, 0, 'tea-tray');
    mesh(new THREE.SphereGeometry(.057, 10, 7), m.cream, 0, .38, 0, 'teapot');
    cylinder(.035, .013, m.accent, 0, .432, 0, 'teapot-lid');
    const spout = cylinder(.018, .09, m.cream, .056, .39, 0, 'teapot-spout');
    spout.rotation.z = -.8;
    mesh(new THREE.TorusGeometry(.037, .009, 5, 10), m.cream, -.055, .385, 0, 'teapot-handle');
    cup(-.12, .07);
    cup(.13, -.07);
  } else {
    for (let i = 0; i < 3; i++) {
      box(.16, .026, .12, i % 2 ? m.accent : m.green, -.08, .328 + i * .028, .04, 'book-cover');
      box(.148, .016, .114, m.cream, -.078, .329 + i * .028, .04, 'book-pages');
    }
    cup(.15, .1);
    box(.16, .11, .065, m.accent, .09, .37, -.12, 'portable-radio');
    mesh(new THREE.CircleGeometry(.034, 10), m.metal, .066, .376, -.086, 'radio-speaker');
    cylinder(.005, .16, m.metal, .15, .493, -.12, 'radio-aerial');
  }
  return root;
}

/** Garment silhouettes hang from y=0 so wind and rain keep the clothes pegs fixed. */
export function laundryGeometry(kind: number, width: number, height: number) {
  const points = kind === 0
    ? [[-.25, 0], [-.5, -.13], [-.4, -.38], [-.27, -.28], [-.27, -1], [.27, -1], [.27, -.28], [.4, -.38], [.5, -.13], [.25, 0], [.12, -.1], [-.12, -.1]]
    : kind === 1
      ? [[-.4, 0], [-.43, -1], [-.06, -1], [0, -.4], [.06, -1], [.43, -1], [.4, 0]]
      : [[-.5, 0], [-.5, -1], [.5, -1], [.5, 0]];
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x * width, y * height)));
  return new THREE.ShapeGeometry(shape);
}
