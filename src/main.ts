import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CityRenderer } from './city';
import { CitizenSystem } from './citizens';
import { BusinessSystem, type BusinessUpdate } from './businesses';
import { createWorldSnapshot, DISCOVERY_EVENTS, GrowSystem, resolveFocus, type DiscoveryEffect, type TriggeredDiscovery } from './grow';
import type { JournalEntry, SavedTown } from './types';
import './style.css';

const STORAGE_KEY = 'little-tides-town-v1';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="hud">
    <div class="brand"><h1>Little Tides</h1><p>潮町 · a town from the sea</p></div>
    <div class="time-widget" aria-label="Time and simulation speed">
      <span id="clock-display">Day 1 · 07:30</span>
      <div class="speed-controls">
        <button data-speed="0" aria-label="Pause simulation">Ⅱ</button>
        <button data-speed="1" class="active" aria-label="Normal simulation speed">1×</button>
        <button data-speed="3" aria-label="Triple simulation speed">3×</button>
      </div>
    </div>
    <div class="top-actions">
      <button id="journal-open" aria-label="Open observation journal">Journal <span id="journal-count">0</span></button>
      <button id="center" aria-label="Center camera">Center view</button>
      <button id="reset" aria-label="Start a new town">New tide</button>
    </div>
    <div class="toast" id="toast"></div>
    <div class="perf-panel" id="perf-panel">Performance</div>
    <aside class="citizen-card" id="citizen-card" aria-live="polite">
      <button class="card-close" id="card-close" aria-label="Close citizen card">×</button>
      <span class="card-kicker">Town resident</span>
      <h2 id="citizen-name"></h2>
      <p class="card-role" id="citizen-role"></p>
      <p id="citizen-home"></p>
      <dl>
        <div><dt>Likes</dt><dd id="citizen-likes"></dd></div>
        <div><dt>Now</dt><dd id="citizen-activity"></dd></div>
      </dl>
      <p class="card-relationship" id="citizen-relationship"></p>
    </aside>
    <div class="recipe-note" id="note"><strong>Harbor notebook</strong><span>Click the water. Old walls and new stories will find their own shape.</span></div>
    <div class="hint" id="hint">
      <span><i class="mouse"></i> click to build</span>
      <span>right-click to undo</span>
      <span>drag to orbit · scroll to zoom</span>
    </div>
    <div class="journal-scrim" id="journal-scrim" aria-hidden="true">
      <aside class="journal" role="dialog" aria-modal="true" aria-labelledby="journal-title">
        <header>
          <div><span class="journal-kicker">Observations from the water</span><h2 id="journal-title">Harbor Journal</h2></div>
          <button id="journal-close" aria-label="Close observation journal">×</button>
        </header>
        <p class="journal-intro">No tasks to finish—only small things the town has shown you.</p>
        <div class="journal-list" id="journal-list"></div>
      </aside>
    </div>
  </div>
`;

const saved = loadTown();
const seed = saved?.seed ?? Math.floor(Math.random() * 2_000_000_000);
let timeOfDay = saved?.timeOfDay ?? 7.5;
let day = saved?.day ?? 1;
let simulationSpeed = 1;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91c7c1);
scene.fog = new THREE.FogExp2(0x91c7c1, .0135);

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .1, 150);
camera.position.set(18, 19, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
const maximumPixelRatio = Math.min(devicePixelRatio, 1.5);
let renderPixelRatio = maximumPixelRatio;
renderer.setPixelRatio(renderPixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
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

const hemi = new THREE.HemisphereLight(0xffe8bd, 0x315f63, 2.25);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffc984, 4.7);
sun.position.set(-14, 23, 12);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -25;
sun.shadow.camera.right = 25;
sun.shadow.camera.top = 25;
sun.shadow.camera.bottom = -25;
sun.shadow.camera.near = 3;
sun.shadow.camera.far = 60;
sun.shadow.bias = -.0005;
scene.add(sun);

const waterUniforms = { uTime: { value: 0 }, uDay: { value: 1 } };
const waterMaterial = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: false,
  vertexShader: `
    uniform float uTime;
    uniform float uDay;
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
    uniform float uDay;
    varying float vWave;
    varying vec3 vWorld;
    void main() {
      float ribbons = sin((vWorld.x + vWorld.z) * .7 + uTime * .45) * .5 + .5;
      vec3 deep = vec3(.075, .34, .37);
      vec3 pale = vec3(.24, .61, .58);
      vec3 color = mix(deep, pale, .50 + vWave * 1.75 + ribbons * .055);
      color += vec3(.055, .035, .008) * ribbons;
      color *= mix(.34, 1.0, uDay);
      color += vec3(.018, .026, .055) * (1.0 - uDay);
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
  new THREE.MeshStandardMaterial({ color: 0x7d9274, roughness: 1 }),
);
seabed.position.y = -1.2;
seabed.receiveShadow = true;
scene.add(seabed);

const city = new CityRenderer(seed);
scene.add(city.root);
if (saved) city.load(saved.cells);
const citizens = new CitizenSystem(seed, city.cells, saved?.citizens ?? []);
scene.add(citizens.root);
const businesses = new BusinessSystem(seed, saved?.businesses ?? []);
businesses.maintain(citizens.residents(), city.cells);
city.setBusinesses(businesses.all());
citizens.setBusinesses(businesses.all());
const grow = new GrowSystem(DISCOVERY_EVENTS, saved?.discoveries ?? [], saved?.journal ?? [], commitDiscoveryEffect);
renderJournal();
const lastJournalEntry = grow.entries().at(-1);
if (lastJournalEntry) setNote(lastJournalEntry.note);

const hoverMaterial = new THREE.MeshBasicMaterial({ color: 0xffd894, transparent: true, opacity: .56, depthWrite: false });
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
let selectedCitizenId: string | null = null;

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
  if (event.button === 0) {
    if (inspectCitizen(event.clientX, event.clientY)) return;
    hideCitizenCard();
    build(hoveredCell.x, hoveredCell.z);
  }
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
  hoverMaterial.color.setHex(allowed ? 0xffd894 : 0xc65f57);
}

function inspectCitizen(clientX: number, clientY: number) {
  pointer.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const intersection = raycaster.intersectObject(citizens.root, true)[0];
  const citizenId = citizens.citizenIdFrom(intersection?.object ?? null);
  if (!citizenId) return false;
  selectedCitizenId = citizenId;
  updateCitizenCard();
  hover.visible = false;
  return true;
}

function updateCitizenCard() {
  if (!selectedCitizenId) return;
  const card = citizens.card(selectedCitizenId);
  if (!card) return false;
  document.querySelector('#citizen-name')!.textContent = card.name;
  document.querySelector('#citizen-role')!.textContent = card.occupation;
  document.querySelector('#citizen-home')!.textContent = card.home;
  document.querySelector('#citizen-likes')!.textContent = card.likes;
  document.querySelector('#citizen-activity')!.textContent = card.activity;
  document.querySelector('#citizen-relationship')!.textContent = card.relationship;
  document.querySelector('#citizen-card')!.classList.add('show');
}

function hideCitizenCard() {
  selectedCitizenId = null;
  document.querySelector('#citizen-card')!.classList.remove('show');
}

function build(x: number, z: number) {
  const before = city.topologyLabel(x, z);
  if (!city.place(x, z)) {
    showToast(city.get(x, z) ? 'That tower is tall enough.' : 'Build beside the town to coax it outward.');
    softTone(150, .05);
    return;
  }
  const after = city.topologyLabel(x, z);
  citizens.rebuild(city.cells);
  applyBusinessUpdate(businesses.maintain(citizens.residents(), city.cells), false);
  performanceWarmup = 0;
  performanceCooldown = 0;
  renderer.shadowMap.needsUpdate = true;
  popSound();
  persistSoon();
  document.querySelector('#hint')?.classList.add('hidden');
  if (before !== after || after === 'tower') showToast(`The stones settle into a ${after}.`);
  evaluateDiscoveries();
}

function demolish(x: number, z: number) {
  if (!city.remove(x, z)) return;
  citizens.rebuild(city.cells);
  applyBusinessUpdate(businesses.maintain(citizens.residents(), city.cells), true);
  performanceWarmup = 0;
  performanceCooldown = 0;
  renderer.shadowMap.needsUpdate = true;
  hideCitizenCard();
  softTone(190, .07);
  persistSoon();
  evaluateDiscoveries();
}

function persistSoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveTown, 250);
}

function saveTown() {
  const data: SavedTown = {
    version: 4,
    seed,
    cells: city.serialize(),
    timeOfDay,
    day,
    citizens: citizens.serialize(),
    businesses: businesses.serialize(),
    discoveries: grow.discoveredIds(),
    journal: grow.entries(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadTown(): SavedTown | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedTown | null;
    return parsed?.version === 1 || parsed?.version === 2 || parsed?.version === 3 || parsed?.version === 4 ? parsed : null;
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

function currentSnapshot() {
  return createWorldSnapshot({
    cells: city.cells.values(),
    citizens: citizens.residents(),
    businesses: businesses.serialize(),
    day,
    timeOfDay,
    priorDiscoveries: grow.discoveredIds(),
  });
}

function evaluateDiscoveries() {
  const triggered = grow.evaluate(currentSnapshot());
  if (!triggered.length) return;
  renderJournal();
  persistSoon();
}

function commitDiscoveryEffect(effect: DiscoveryEffect, discovery: TriggeredDiscovery) {
  const focus = resolveFocus(discovery.event.focus, discovery.snapshot);
  if (effect.kind === 'city') {
    if (focus) city.celebrateAt(focus.x, focus.z);
    return;
  }
  if (effect.kind === 'citizens') {
    citizens.noticeDiscovery(effect.activity);
    return;
  }
  showToast(effect.caption);
  setNote(discovery.entry.note);
  if (focus) controls.target.lerp(city.worldPosition(focus.x, focus.z).setY(1), .14);
  const tones = {
    stone: [310, 430],
    green: [390, 590],
    water: [360, 520],
    warm: [470, 680],
    people: [420, 620],
  } as const;
  const [low, high] = tones[effect.tone];
  softTone(low, .17);
  softTone(high, .22, .09);
}

function renderJournal() {
  const list = document.querySelector<HTMLDivElement>('#journal-list')!;
  const entries = grow.entries().reverse();
  document.querySelector('#journal-count')!.textContent = String(entries.length);
  list.replaceChildren();
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'journal-empty';
    empty.textContent = 'The pages are waiting for the town’s first small surprise.';
    list.append(empty);
    return;
  }
  for (const entry of entries) list.append(createJournalEntry(entry));
}

function createJournalEntry(entry: JournalEntry) {
  const article = document.createElement('article');
  article.className = 'journal-entry';
  const illustration = document.createElement('div');
  illustration.className = 'journal-illustration';
  illustration.dataset.scene = entry.illustration;
  illustration.setAttribute('aria-hidden', 'true');
  illustration.append(document.createElement('i'), document.createElement('i'), document.createElement('i'));
  const copy = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = entry.title;
  const time = document.createElement('span');
  time.className = 'journal-time';
  const hours = Math.floor(entry.timeOfDay);
  const minutes = Math.floor((entry.timeOfDay - hours) * 60);
  time.textContent = `Day ${entry.day} · ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const note = document.createElement('p');
  note.textContent = entry.note;
  copy.append(time, title, note);
  article.append(illustration, copy);
  return article;
}

function setJournalOpen(open: boolean) {
  const scrim = document.querySelector('#journal-scrim')!;
  scrim.classList.toggle('show', open);
  scrim.setAttribute('aria-hidden', String(!open));
}

function applyBusinessUpdate(update: BusinessUpdate, announce: boolean) {
  if (!update.changed) return;
  const current = businesses.all();
  city.setBusinesses(current);
  citizens.setBusinesses(current);
  renderer.shadowMap.needsUpdate = true;
  if (announce && update.closed[0]) {
    showToast(`${update.closed[0].name} has quietly closed its shutters.`);
    setNote(`The sign at ${update.closed[0].name} has come down. Perhaps another door will open elsewhere.`);
  }
  persistSoon();
  if (update.opened.length) evaluateDiscoveries();
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

document.querySelector('#card-close')!.addEventListener('click', hideCitizenCard);
document.querySelector('#journal-open')!.addEventListener('click', () => setJournalOpen(true));
document.querySelector('#journal-close')!.addEventListener('click', () => setJournalOpen(false));
document.querySelector('#journal-scrim')!.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) setJournalOpen(false);
});
document.querySelectorAll<HTMLButtonElement>('[data-speed]').forEach((button) => {
  button.addEventListener('click', () => {
    simulationSpeed = Number(button.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach((item) => item.classList.toggle('active', item === button));
    showToast(simulationSpeed === 0 ? 'The town holds its breath.' : simulationSpeed === 3 ? 'The tide of time quickens.' : 'The town settles into its rhythm.');
    persistSoon();
  });
});

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'p') document.querySelector('#perf-panel')!.classList.toggle('show');
  if (event.key.toLowerCase() === 'j') setJournalOpen(!document.querySelector('#journal-scrim')!.classList.contains('show'));
  if (event.key === 'Escape') setJournalOpen(false);
});

const ambience = createAmbience();
scene.add(ambience.root);

function createAmbience() {
  const root = new THREE.Group();
  const sailMaterial = new THREE.MeshStandardMaterial({ color: 0xb9493e, side: THREE.DoubleSide, roughness: .9 });
  const hullMaterial = new THREE.MeshStandardMaterial({ color: 0x593e34, roughness: .95 });
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
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(.45, .05, .34), new THREE.MeshStandardMaterial({ color: 0xd7b260, roughness: 1 }));
  canopy.position.set(-.22, .28, 0);
  boat.add(canopy);
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

  const cloudMaterial = new THREE.MeshStandardMaterial({ color: 0xffe2bc, transparent: true, opacity: .42, roughness: 1, depthWrite: false });
  const clouds = new THREE.Group();
  for (let c = 0; c < 5; c++) {
    const cloud = new THREE.Group();
    for (let puff = 0; puff < 4; puff++) {
      const shape = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1 + (puff % 2) * .45, 1), cloudMaterial);
      shape.scale.set(1.65, .55, .7);
      shape.position.set(puff * 1.25, Math.sin(puff) * .32, 0);
      cloud.add(shape);
    }
    cloud.position.set(-24 + c * 11, 10 + (c % 2) * 2.5, -20 - c * 2);
    clouds.add(cloud);
  }
  root.add(clouds);

  const sunDisc = new THREE.Mesh(
    new THREE.CircleGeometry(2.2, 32),
    new THREE.MeshBasicMaterial({ color: 0xffc36f, transparent: true, opacity: .65, depthWrite: false }),
  );
  sunDisc.position.set(-17, 14, -28);
  sunDisc.lookAt(camera.position);
  root.add(sunDisc);

  const starPositions: number[] = [];
  for (let i = 0; i < 170; i++) {
    const angle = i * 2.39996;
    const radius = 28 + (i % 17) * 1.15;
    starPositions.push(Math.cos(angle) * radius, 12 + (i % 13) * 1.35, Math.sin(angle) * radius);
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.Float32BufferAttribute(starPositions, 3));
  const starMaterial = new THREE.PointsMaterial({ color: 0xffe4a3, size: .13, transparent: true, opacity: 0, depthWrite: false });
  const stars = new THREE.Points(starGeometry, starMaterial);
  root.add(stars);
  return {
    root,
    update(time: number, daylight: number) {
      const angle = time * .045;
      boat.position.set(Math.cos(angle) * 16, -.12 + Math.sin(time * 1.4) * .07, Math.sin(angle) * 12);
      boat.rotation.y = -angle + Math.PI / 2;
      boat.rotation.z = Math.sin(time * 1.1) * .035;
      const birdAngle = time * .085;
      birds.position.set(Math.cos(birdAngle) * 9, 7.5 + Math.sin(time * .35), Math.sin(birdAngle) * 9);
      birds.rotation.y = -birdAngle;
      birds.children.forEach((bird, i) => { bird.rotation.z = Math.sin(time * 5 + i) * .22; });
      clouds.position.x = Math.sin(time * .018) * 2.5;
      cloudMaterial.opacity = .12 + daylight * .32;
      starMaterial.opacity = Math.pow(1 - daylight, 2) * (.62 + Math.sin(time * .7) * .08);
      (sunDisc.material as THREE.MeshBasicMaterial).opacity = daylight * .68;
    },
  };
}

const clock = new THREE.Clock();
const daySky = new THREE.Color(0x91c7c1);
const nightSky = new THREE.Color(0x192b43);
const dawnSky = new THREE.Color(0xc47f72);
const currentSky = new THREE.Color();
let clockUpdate = 0;
let autosaveElapsed = 0;
let shadowElapsed = 0;
let frameTimeEma = 16.7;
let performanceWarmup = 0;
let performanceCooldown = 0;
let performanceUpdate = 0;
let businessCheckElapsed = 0;
let discoveryCheckElapsed = 0;
let nightMode = false;
let shadowsActive = true;

function daylightAt(hour: number) {
  const solar = Math.sin((hour - 6) / 12 * Math.PI);
  return THREE.MathUtils.clamp(solar * .9 + .1, .04, 1);
}

function updateTimeDisplay() {
  const hours = Math.floor(timeOfDay);
  const minutes = Math.floor((timeOfDay - hours) * 60);
  document.querySelector('#clock-display')!.textContent = `Day ${day} · ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} · ${citizens.population()} ${citizens.population() === 1 ? 'resident' : 'residents'}`;
  updateCitizenCard();
}

function animate() {
  requestAnimationFrame(animate);
  const rawDelta = clock.getDelta();
  if (document.hidden) return;
  const delta = Math.min(rawDelta, .1);
  const time = clock.elapsedTime;
  frameTimeEma += (rawDelta * 1000 - frameTimeEma) * .035;
  performanceWarmup += rawDelta;
  performanceCooldown += rawDelta;
  performanceUpdate += rawDelta;
  businessCheckElapsed += delta;
  discoveryCheckElapsed += delta;
  const deltaHours = delta * simulationSpeed * .05;
  timeOfDay += deltaHours;
  if (timeOfDay >= 24) {
    timeOfDay %= 24;
    day += 1;
    setNote('Another day has folded itself into the harbor. The routines remain, but never quite repeat.');
  }
  const absoluteHours = day * 24 + timeOfDay;
  const daylight = daylightAt(timeOfDay);
  const nextNightMode = daylight < .24;
  if (nextNightMode !== nightMode) {
    nightMode = nextNightMode;
    document.body.classList.toggle('night', nightMode);
  }
  const twilight = Math.max(0, 1 - Math.abs(timeOfDay - 18.6) / 2.4, 1 - Math.abs(timeOfDay - 5.7) / 2.1);
  currentSky.copy(nightSky).lerp(daySky, daylight).lerp(dawnSky, twilight * .28);
  scene.background = currentSky;
  if (scene.fog instanceof THREE.FogExp2) scene.fog.color.copy(currentSky);
  hemi.intensity = .42 + daylight * 1.83;
  sun.intensity = .12 + daylight * 4.58;
  const sunAngle = (timeOfDay - 6) / 24 * Math.PI * 2;
  sun.position.set(Math.cos(sunAngle) * 18, 5 + daylight * 20, Math.sin(sunAngle) * 16);
  shadowElapsed += rawDelta;
  if (shadowsActive && shadowElapsed > 1.4) {
    renderer.shadowMap.needsUpdate = true;
    shadowElapsed = 0;
  }
  renderer.toneMappingExposure = .72 + daylight * .36;
  waterUniforms.uTime.value = time;
  waterUniforms.uDay.value = daylight;
  city.update(time);
  city.setDaylight(daylight);
  citizens.update(delta * simulationSpeed, timeOfDay, absoluteHours, time);
  if (businessCheckElapsed > .5) {
    const businessUpdate = businesses.update(citizens.residents(), city.cells, absoluteHours);
    applyBusinessUpdate(businessUpdate, true);
    businessCheckElapsed = 0;
  }
  if (discoveryCheckElapsed > .5) {
    evaluateDiscoveries();
    discoveryCheckElapsed = 0;
  }
  ambience.update(time, daylight);
  clockUpdate += delta;
  autosaveElapsed += delta;
  if (clockUpdate > .25) {
    updateTimeDisplay();
    clockUpdate = 0;
  }
  if (autosaveElapsed > 12) {
    saveTown();
    autosaveElapsed = 0;
  }
  if (performanceWarmup > 3 && performanceCooldown > 3 && frameTimeEma > 22 && renderPixelRatio > 1) {
    renderPixelRatio = Math.max(1, renderPixelRatio - (frameTimeEma > 30 ? .3 : .2));
    renderer.setPixelRatio(renderPixelRatio);
    performanceCooldown = 0;
  } else if (performanceWarmup > 8 && performanceCooldown > 4 && frameTimeEma > 26 && renderPixelRatio <= 1 && shadowsActive) {
    shadowsActive = false;
    renderer.shadowMap.enabled = false;
    performanceCooldown = 0;
  } else if (performanceWarmup > 20 && performanceCooldown > 15 && frameTimeEma < 17.5 && renderPixelRatio < maximumPixelRatio) {
    renderPixelRatio = Math.min(maximumPixelRatio, renderPixelRatio + .1);
    renderer.setPixelRatio(renderPixelRatio);
    performanceCooldown = 0;
  }
  if (performanceUpdate > .75) {
    const info = renderer.info.render;
    document.querySelector('#perf-panel')!.textContent = `${Math.round(1000 / frameTimeEma)} fps · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris · ${businesses.all().length} shops · ${renderPixelRatio.toFixed(1)}×${shadowsActive ? '' : ' · lite'}`;
    performanceUpdate = 0;
  }
  controls.update();
  renderer.render(scene, camera);
}
updateTimeDisplay();
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(renderPixelRatio);
});
