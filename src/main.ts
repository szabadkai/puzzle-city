import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CityRenderer } from './city';
import type { SavedTown } from './types';
import './style.css';

const STORAGE_KEY = 'little-tides-town-v1';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="hud">
    <div class="brand"><h1>Little Tides</h1><p>a town from the sea</p></div>
    <div class="top-actions">
      <button id="center" aria-label="Center camera">Center view</button>
      <button id="reset" aria-label="Start a new town">New tide</button>
    </div>
    <div class="toast" id="toast"></div>
    <div class="recipe-note" id="note"><strong>Field note</strong><span>Click the water. The town will decide what it wants to become.</span></div>
    <div class="hint" id="hint">
      <span><i class="mouse"></i> click to build</span>
      <span>right-click to undo</span>
      <span>drag to orbit · scroll to zoom</span>
    </div>
  </div>
`;

const saved = loadTown();
let seed = saved?.seed ?? Math.floor(Math.random() * 2_000_000_000);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fdddf);
scene.fog = new THREE.FogExp2(0x9fdddf, .012);

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .1, 150);
camera.position.set(18, 19, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.querySelector('#app')!.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = .07;
controls.enablePan = true;
controls.screenSpacePanning = false;
controls.minDistance = 12;
controls.maxDistance = 46;
controls.minPolarAngle = .42;
controls.maxPolarAngle = 1.18;
controls.target.set(0, 1.3, 0);
controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
controls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;

const hemi = new THREE.HemisphereLight(0xfff4da, 0x4c8990, 2.4);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffe5bd, 4.2);
sun.position.set(-14, 23, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
sun.shadow.camera.near = 3;
sun.shadow.camera.far = 60;
sun.shadow.bias = -.0005;
scene.add(sun);

const waterUniforms = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(-.5, .8, .4) } };
const waterMaterial = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: false,
  vertexShader: `
    uniform float uTime;
    varying float vWave;
    varying vec3 vWorld;
    void main() {
      vec3 p = position;
      float wave = sin(p.x * .42 + uTime * .65) * .09 + sin(p.y * .58 - uTime * .48) * .055;
      p.z += wave;
      vWave = wave;
      vec4 world = modelMatrix * vec4(p, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    varying float vWave;
    varying vec3 vWorld;
    void main() {
      float ribbons = sin((vWorld.x + vWorld.z) * .7 + uTime * .45) * .5 + .5;
      vec3 deep = vec3(.16, .57, .64);
      vec3 pale = vec3(.34, .74, .76);
      vec3 color = mix(deep, pale, .46 + vWave * 1.9 + ribbons * .045);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(100, 100, 100, 100), waterMaterial);
water.rotation.x = -Math.PI / 2;
water.position.y = -.31;
water.receiveShadow = true;
scene.add(water);

const seabed = new THREE.Mesh(
  new THREE.CylinderGeometry(22.5, 25, .9, 28),
  new THREE.MeshStandardMaterial({ color: 0xb4c5a6, roughness: 1 }),
);
seabed.position.y = -1.2;
seabed.receiveShadow = true;
scene.add(seabed);

const city = new CityRenderer(seed);
scene.add(city.root);
if (saved) city.load(saved.cells);

const hoverMaterial = new THREE.MeshBasicMaterial({ color: 0xfff5c4, transparent: true, opacity: .52, depthWrite: false });
const hover = new THREE.Mesh(new RoundedBoxGeometry(CityRenderer.cellSize() * .9, .16, CityRenderer.cellSize() * .9, 4, .12), hoverMaterial);
hover.position.y = .04;
hover.visible = false;
scene.add(hover);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
let hoveredCell: { x: number; z: number } | null = null;
let pointerStart = new THREE.Vector2();
let dragged = false;
let toastTimer = 0;
let saveTimer = 0;
let audioContext: AudioContext | null = null;

renderer.domElement.addEventListener('pointerdown', (event) => {
  pointerStart.set(event.clientX, event.clientY);
  dragged = false;
  renderer.domElement.classList.add('dragging');
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 5) dragged = true;
  updateHover(event.clientX, event.clientY);
});

renderer.domElement.addEventListener('pointerup', (event) => {
  renderer.domElement.classList.remove('dragging');
  if (dragged || !hoveredCell) return;
  if (event.button === 0) build(hoveredCell.x, hoveredCell.z);
  if (event.button === 2) demolish(hoveredCell.x, hoveredCell.z);
});

renderer.domElement.addEventListener('pointerleave', () => {
  hover.visible = false;
  hoveredCell = null;
  renderer.domElement.classList.remove('dragging');
});
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

function updateHover(clientX: number, clientY: number) {
  pointer.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  if (!raycaster.ray.intersectPlane(interactionPlane, hit)) return;
  const size = CityRenderer.cellSize();
  const x = Math.round(hit.x / size);
  const z = Math.round(hit.z / size);
  if (Math.hypot(x, z) > 9.25) {
    hover.visible = false;
    hoveredCell = null;
    return;
  }
  hoveredCell = { x, z };
  const cell = city.get(x, z);
  const allowed = Boolean(cell) || city.isBuildable(x, z);
  hover.visible = true;
  hover.position.set(x * size, cell ? .35 + cell.height * 1.42 : .04, z * size);
  hoverMaterial.color.setHex(allowed ? 0xfff3ba : 0xd5726b);
}

function build(x: number, z: number) {
  const before = city.topologyLabel(x, z);
  if (!city.place(x, z)) {
    showToast(city.get(x, z) ? 'That tower is tall enough.' : 'Build beside the town to coax it outward.');
    softTone(150, .05);
    return;
  }
  const after = city.topologyLabel(x, z);
  popSound();
  persistSoon();
  document.querySelector('#hint')?.classList.add('hidden');
  if (before !== after || after === 'tower') showToast(`The stones settle into a ${after}.`);
  const neighbors = [[0,-1],[1,0],[0,1],[-1,0]];
  for (const [dx, dz] of neighbors) {
    const feature = city.topologyLabel(x + dx, z + dz);
    if (feature === 'courtyard garden') {
      showToast('A sheltered garden has taken root.');
      setNote('Where walls make shelter, green things seem to follow.');
      break;
    }
    if (feature === 'sea arch' || feature === 'high bridge') {
      showToast(feature === 'sea arch' ? 'An arch spans the tide.' : 'A high bridge joins the rooftops.');
      setNote('Tall neighbors sometimes reach across a narrow ribbon of sea.');
      break;
    }
  }
}

function demolish(x: number, z: number) {
  if (!city.remove(x, z)) return;
  softTone(190, .07);
  persistSoon();
}

function persistSoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveTown, 250);
}

function saveTown() {
  const data: SavedTown = { version: 1, seed, cells: city.serialize() };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadTown(): SavedTown | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedTown | null;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function showToast(message: string) {
  const toast = document.querySelector<HTMLDivElement>('#toast')!;
  toast.textContent = message;
  toast.classList.add('show');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 2200);
}

function setNote(message: string) {
  document.querySelector<HTMLSpanElement>('#note span')!.textContent = message;
}

function getAudio() {
  audioContext ??= new AudioContext();
  return audioContext;
}

function softTone(frequency: number, duration: number, delay = 0) {
  const context = getAudio();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, context.currentTime + delay);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.18, context.currentTime + delay + duration);
  gain.gain.setValueAtTime(.0001, context.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(.055, context.currentTime + delay + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + delay + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(context.currentTime + delay);
  oscillator.stop(context.currentTime + delay + duration + .02);
}

function popSound() {
  softTone(260, .11);
  softTone(430, .13, .045);
}

document.querySelector('#center')!.addEventListener('click', () => {
  controls.target.set(0, 1.3, 0);
  camera.position.set(18, 19, 20);
  controls.update();
});

document.querySelector('#reset')!.addEventListener('click', () => {
  if (!confirm('Let this town drift away and begin with a new tide?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

const ambience = createAmbience();
scene.add(ambience.root);

function createAmbience() {
  const root = new THREE.Group();
  const sailMaterial = new THREE.MeshStandardMaterial({ color: 0xffedcb, side: THREE.DoubleSide, roughness: .85 });
  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x9a5147, roughness: .9 });
  const boat = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(.25, .78, 4, 8), hullMaterial);
  hull.rotation.z = Math.PI / 2;
  hull.scale.y = .55;
  hull.castShadow = true;
  boat.add(hull);
  const mast = new THREE.Mesh(new THREE.CylinderGeometry(.018, .022, .9, 6), hullMaterial);
  mast.position.y = .48;
  boat.add(mast);
  const sail = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(.02, .83, 0), new THREE.Vector3(.02, .12, 0), new THREE.Vector3(.52, .18, 0),
  ]), sailMaterial);
  boat.add(sail);
  root.add(boat);

  const birds = new THREE.Group();
  const birdMaterial = new THREE.MeshBasicMaterial({ color: 0x47676b, side: THREE.DoubleSide });
  for (let i = 0; i < 7; i++) {
    const bird = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(-.18, 0, 0), new THREE.Vector3(0, -.06, 0), new THREE.Vector3(.18, 0, 0),
    ]), birdMaterial);
    bird.position.set(i * .6, Math.sin(i) * .34, Math.cos(i * 2) * .5);
    birds.add(bird);
  }
  root.add(birds);
  return {
    root,
    update(time: number) {
      const angle = time * .045;
      boat.position.set(Math.cos(angle) * 16, -.12 + Math.sin(time * 1.4) * .07, Math.sin(angle) * 12);
      boat.rotation.y = -angle + Math.PI / 2;
      boat.rotation.z = Math.sin(time * 1.1) * .035;
      const birdAngle = time * .085;
      birds.position.set(Math.cos(birdAngle) * 9, 7.5 + Math.sin(time * .35), Math.sin(birdAngle) * 9);
      birds.rotation.y = -birdAngle;
      birds.children.forEach((bird, i) => { bird.rotation.z = Math.sin(time * 5 + i) * .22; });
    },
  };
}

const clock = new THREE.Clock();
function animate() {
  requestAnimationFrame(animate);
  const time = clock.getElapsedTime();
  waterUniforms.uTime.value = time;
  city.update(time);
  ambience.update(time);
  controls.update();
  renderer.render(scene, camera);
}
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
});
