import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CityRenderer } from './city';
import { CitizenSystem } from './citizens';
import { BusinessSystem, type BusinessUpdate } from './businesses';
import { createWorldSnapshot, DISCOVERY_EVENTS, GrowSystem, resolveFocus, type DiscoveryEffect, type TriggeredDiscovery } from './grow';
import { HarborAmbience } from './harbor';
import type { JournalEntry, JournalIllustration, SavedTown } from './types';
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
    <aside class="grow-inspector" id="grow-inspector" aria-label="GROW developer inspector"></aside>
    <aside class="citizen-card" id="citizen-card" aria-live="polite">
      <button class="card-close" id="card-close" aria-label="Close citizen card">×</button>
      <span class="card-kicker">Town resident</span>
      <h2 id="citizen-name"></h2>
      <p class="card-role" id="citizen-role"></p>
      <p id="citizen-home"></p>
      <dl>
        <div><dt>Likes</dt><dd id="citizen-likes"></dd></div>
        <div><dt>Now</dt><dd id="citizen-activity"></dd></div>
        <div><dt>Going</dt><dd id="citizen-destination"></dd></div>
      </dl>
      <p class="card-relationship" id="citizen-relationship"></p>
    </aside>
    <div class="hint" id="hint">
      <span class="desktop-hint"><i class="mouse"></i> click to build</span>
      <span class="desktop-hint">right-click to remove</span>
      <span class="desktop-hint">drag to move · right-drag to orbit · scroll to zoom</span>
      <span class="touch-hint">Tap to build · drag to orbit · two fingers to move or zoom</span>
    </div>
    <nav class="mobile-controls" aria-label="Touch controls">
      <button class="touch-action active" data-touch-mode="build" aria-pressed="true">
        <span class="touch-action-icon" aria-hidden="true">＋</span><span>Build</span>
      </button>
      <button class="touch-action" data-touch-mode="remove" aria-pressed="false">
        <span class="touch-action-icon" aria-hidden="true">−</span><span>Remove</span>
      </button>
      <button class="touch-action" id="touch-center">
        <span class="touch-action-icon touch-compass" aria-hidden="true">⌖</span><span>Center</span>
      </button>
      <button class="touch-action" id="touch-help-toggle" aria-expanded="false">
        <span class="touch-action-icon" aria-hidden="true">?</span><span>Help</span>
      </button>
    </nav>
    <div class="touch-guide-scrim" id="touch-guide" aria-hidden="true">
      <section class="touch-guide" role="dialog" aria-modal="true" aria-labelledby="touch-guide-title">
        <span class="guide-kicker">How to play</span>
        <button class="guide-close" id="touch-guide-close" aria-label="Close touch guide">×</button>
        <h2 id="touch-guide-title">Shape the harbor by touch</h2>
        <div class="gesture-list">
          <div><span class="gesture-icon" aria-hidden="true">☝</span><p><strong>Tap</strong> the water to build. Tap a resident to meet them.</p></div>
          <div><span class="gesture-icon" aria-hidden="true">↔</span><p><strong>Drag</strong> with one finger to orbit around your town.</p></div>
          <div><span class="gesture-icon" aria-hidden="true">⌁</span><p><strong>Drag</strong> with two fingers to move the view, or pinch to zoom.</p></div>
          <div><span class="gesture-icon" aria-hidden="true">−</span><p>Choose <strong>Remove</strong>, then tap a building to take down one floor.</p></div>
        </div>
        <button class="guide-done" id="touch-guide-done">Got it</button>
      </section>
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
const committedEffects: string[] = [];
let navDebugVisible = false;
let forcedEventSelection = DISCOVERY_EVENTS[0]?.id ?? '';
let lastChimedHour = Math.floor(timeOfDay);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91c7c1);
scene.fog = new THREE.FogExp2(0x91c7c1, .0135);

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .1, 300);
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
controls.maxDistance = 120;
controls.minPolarAngle = .42;
controls.maxPolarAngle = 1.18;
controls.target.set(0, 1.3, 0);
controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
controls.touches.ONE = THREE.TOUCH.ROTATE;
controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;

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
const water = new THREE.Mesh(new THREE.PlaneGeometry(240, 240, 120, 120), waterMaterial);
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
const grow = new GrowSystem(
  DISCOVERY_EVENTS,
  saved?.discoveries ?? [],
  saved?.journal ?? [],
  saved?.eventLastTriggeredAt ?? {},
  commitDiscoveryEffect,
);
city.setDiscoveryState(grow.discoveredIds());
citizens.setDiscoveries(grow.discoveredIds());

const previewHeight = 1.28;
const hoverGeometry = new RoundedBoxGeometry(CityRenderer.cellSize() * .9, previewHeight, CityRenderer.cellSize() * .9, 4, .12);
const hoverMaterial = new THREE.MeshBasicMaterial({ color: 0xffd894, transparent: true, opacity: .24, depthWrite: false });
const hoverOutlineMaterial = new THREE.LineBasicMaterial({ color: 0xffd894, transparent: true, opacity: .9 });
const hover = new THREE.Mesh(hoverGeometry, hoverMaterial);
const hoverOutline = new THREE.LineSegments(new THREE.EdgesGeometry(hoverGeometry, 24), hoverOutlineMaterial);
hover.add(hoverOutline);
hover.position.y = .12;
hover.renderOrder = 3;
hover.visible = false;
scene.add(hover);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const interactionPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hit = new THREE.Vector3();
let hoveredCell: { x: number; z: number } | null = null;
const pointerStart = new THREE.Vector2();
const activePointers = new Set<number>();
let gesturePointerId: number | null = null;
let multiTouchGesture = false;
let dragged = false;
let toastTimer = 0;
let saveTimer = 0;
let audioContext: AudioContext | null = null;
let selectedCitizenId: string | null = null;
let touchMode: 'build' | 'remove' = 'build';

renderer.domElement.addEventListener('pointerdown', (event) => {
  activePointers.add(event.pointerId);
  if (activePointers.size === 1) {
    gesturePointerId = event.pointerId;
    pointerStart.set(event.clientX, event.clientY);
    dragged = false;
    multiTouchGesture = false;
    updateHover(event.clientX, event.clientY);
  } else {
    dragged = true;
    multiTouchGesture = true;
    hover.visible = false;
  }
});

renderer.domElement.addEventListener('pointermove', (event) => {
  if (event.pointerId !== gesturePointerId || multiTouchGesture) return;
  const dragThreshold = event.pointerType === 'touch' ? 10 : 5;
  if (Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > dragThreshold) {
    dragged = true;
    renderer.domElement.classList.add('dragging');
  }
  updateHover(event.clientX, event.clientY);
});

renderer.domElement.addEventListener('pointerup', (event) => {
  const completesGesture = event.pointerId === gesturePointerId;
  activePointers.delete(event.pointerId);
  if (!activePointers.size) renderer.domElement.classList.remove('dragging');
  if (!completesGesture || dragged || multiTouchGesture) {
    if (!activePointers.size) resetPointerGesture();
    return;
  }
  updateHover(event.clientX, event.clientY);
  if (!hoveredCell) {
    resetPointerGesture();
    return;
  }
  if (event.button === 0) {
    if (touchMode === 'remove') {
      hideCitizenCard();
      demolish(hoveredCell.x, hoveredCell.z);
    } else if (!inspectCitizen(event.clientX, event.clientY)) {
      hideCitizenCard();
      build(hoveredCell.x, hoveredCell.z);
    }
  }
  if (event.button === 2) demolish(hoveredCell.x, hoveredCell.z);
  if (event.pointerType === 'touch') {
    hover.visible = false;
    hoveredCell = null;
  }
  resetPointerGesture();
});

renderer.domElement.addEventListener('pointercancel', (event) => {
  activePointers.delete(event.pointerId);
  if (!activePointers.size) resetPointerGesture();
});

renderer.domElement.addEventListener('pointerleave', () => {
  if (activePointers.size) return;
  hover.visible = false;
  hoveredCell = null;
  renderer.domElement.classList.remove('dragging');
});
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

function resetPointerGesture() {
  gesturePointerId = null;
  multiTouchGesture = false;
  dragged = false;
  renderer.domElement.classList.remove('dragging');
}

function updateHover(clientX: number, clientY: number) {
  pointer.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const size = CityRenderer.cellSize();
  const cityHit = raycaster.intersectObject(city.root, true)
    .map((intersection) => city.cellFromObject(intersection.object))
    .find((cell) => cell !== null);
  if (!cityHit && !raycaster.ray.intersectPlane(interactionPlane, hit)) {
    hover.visible = false;
    hoveredCell = null;
    return;
  }
  const x = cityHit?.x ?? Math.round(hit.x / size);
  const z = cityHit?.z ?? Math.round(hit.z / size);
  if (Math.hypot(x, z) > 9.25) {
    hover.visible = false;
    hoveredCell = null;
    return;
  }
  hoveredCell = { x, z };
  const cell = city.get(x, z);
  const allowed = touchMode === 'remove' ? Boolean(cell) : cell ? cell.height < 5 : city.isBuildable(x, z);
  const color = allowed ? (touchMode === 'remove' ? 0xc65f57 : 0xffd894) : 0x82918c;
  hover.visible = true;
  hover.scale.y = cell ? 1 : .12;
  hover.position.set(x * size, cell ? .34 + cell.height * 1.42 + previewHeight / 2 : .12, z * size);
  hoverMaterial.color.setHex(color);
  hoverOutlineMaterial.color.setHex(color);
}

function inspectCitizen(clientX: number, clientY: number) {
  pointer.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const citizenId = raycaster.intersectObject(citizens.root, true)
    .map((intersection) => citizens.citizenIdFrom(intersection.object))
    .find((id) => id !== null) ?? null;
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
  document.querySelector('#citizen-destination')!.textContent = card.destination;
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
    showToast(city.get(x, z) ? 'That tower is tall enough.' : 'The water is too deep to build there.');
    softTone(150, .05);
    return;
  }
  const after = city.topologyLabel(x, z);
  citizens.rebuild(city.cells);
  ambience.scatterWildlife(x, z);
  refreshAmbience();
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
  ambience.scatterWildlife(x, z);
  refreshAmbience();
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
    version: 5,
    seed,
    cells: city.serialize(),
    timeOfDay,
    day,
    citizens: citizens.serialize(),
    businesses: businesses.serialize(),
    discoveries: grow.discoveredIds(),
    journal: grow.entries(),
    eventLastTriggeredAt: grow.recurringTriggerTimes(),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadTown(): SavedTown | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedTown | null;
    return parsed?.version === 1 || parsed?.version === 2 || parsed?.version === 3 || parsed?.version === 4 || parsed?.version === 5 ? parsed : null;
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

function currentSnapshot() {
  return createWorldSnapshot({
    cells: city.cells.values(),
    citizens: citizens.residents(),
    businesses: businesses.serialize(),
    seed,
    day,
    timeOfDay,
    priorDiscoveries: grow.discoveredIds(),
  });
}

function evaluateDiscoveries() {
  const triggered = grow.evaluate(currentSnapshot());
  if (!triggered.length) return;
  city.setDiscoveryState(grow.discoveredIds());
  citizens.setDiscoveries(grow.discoveredIds());
  refreshAmbience();
  renderJournal();
  persistSoon();
}

function commitDiscoveryEffect(effect: DiscoveryEffect, discovery: TriggeredDiscovery) {
  committedEffects.unshift(`${discovery.event.id} · ${effect.kind}.${effect.action}`);
  committedEffects.length = Math.min(committedEffects.length, 12);
  const focus = resolveFocus(discovery.event.focus, discovery.snapshot);
  if (effect.kind === 'city') {
    if (focus) city.celebrateAt(focus.x, focus.z);
    if (effect.action === 'decorate') {
      city.setDiscoveryState(grow.discoveredIds());
      citizens.setDiscoveries(grow.discoveredIds());
    }
    return;
  }
  if (effect.kind === 'business') {
    const update = businesses.openType(effect.businessType, citizens.residents(), city.cells, day * 24 + timeOfDay);
    applyBusinessUpdate(update, false);
    return;
  }
  if (effect.kind === 'citizens') {
    if (effect.action === 'notice') citizens.noticeDiscovery(effect.activity);
    else if (effect.action === 'moment') citizens.beginMoment(effect.activity, effect);
    else if (effect.action === 'assign-occupation') citizens.assignOccupation(effect.occupation, effect.additional);
    else if (effect.action === 'spawn-visitor') citizens.spawnVisitor(effect.name, effect.occupation);
    else if (focus) citizens.gatherAt(focus.x, focus.z, effect.activity);
    return;
  }
  if (effect.kind === 'wildlife') {
    ambience.wildlifeEffect(effect.action, effect.animal, focus);
    return;
  }
  if (effect.kind === 'ambience') {
    refreshAmbience();
    if (effect.action === 'celebrate') playCue('celebration');
    return;
  }
  showToast(effect.caption);
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
  if (discovery.event.id.includes('bell') || discovery.event.id === 'clock-tower') playCue('bell');
  if (discovery.event.id.includes('ferry') || discovery.event.id.includes('merchant')) playCue('horn');
}

function updateGrowInspector() {
  const panel = document.querySelector<HTMLElement>('#grow-inspector')!;
  if (!panel.classList.contains('show')) return;
  const snapshot = currentSnapshot();
  const events = grow.inspect(snapshot);
  const eligible = events.filter((event) => event.eligible && !event.discovered);
  const oneShotEvents = events.filter((event) => !event.repeatable);
  const repeatableEvents = events.filter((event) => event.repeatable);
  const complete = oneShotEvents.filter((event) => event.discovered).length;
  panel.replaceChildren();
  const heading = document.createElement('strong');
  heading.textContent = 'GROW inspector';
  const summary = document.createElement('p');
  const fleet = ambience.activeFleet();
  const selected = hoveredCell ? `${hoveredCell.x},${hoveredCell.z}: ${city.topologyLabel(hoveredCell.x, hoveredCell.z)}` : 'none';
  const nav = citizens.navStats();
  const fauna = ambience.wildlifeStats();
  summary.textContent = `Day ${snapshot.day} ${snapshot.timeOfDay.toFixed(2)} · speed ${simulationSpeed}× · ${snapshot.cells.length} cells · ${snapshot.population} citizens · ${snapshot.businesses.length} shops · ${snapshot.relationshipCount} relationships · ${snapshot.water.dockCount} docks · ${snapshot.water.canalCount} canals · ${snapshot.water.shelteredCount} sheltered water · fleet: ${fleet.join(', ') || 'none'} · fauna: ${fauna.birds} birds, ${fauna.gulls} gulls (${fauna.gullModes.flying} flying/${fauna.gullModes.feeding} feeding/${fauna.gullModes.perching} perched/${fauna.gullModes.scattering} scattering), ${fauna.fish} fish, ${fauna.crabs} crabs, ${fauna.cats} cats, ${fauna.butterflies} butterflies · nav: ${nav.nodes} nodes/${nav.links} links · selected: ${selected} · ${complete}/${oneShotEvents.length} discoveries · ${repeatableEvents.length} recurring moments`;
  const eligibleTitle = document.createElement('span');
  eligibleTitle.textContent = 'Eligible next';
  const eligibleList = document.createElement('p');
  eligibleList.textContent = eligible.length ? eligible.map((event) => event.id).join('\n') : 'none';
  const citizensTitle = document.createElement('span');
  citizensTitle.textContent = 'Citizens';
  const citizenList = document.createElement('p');
  citizenList.textContent = snapshot.citizens.map((citizen) => `${citizen.name} · ${citizen.ageGroup ?? 'adult'} · ${citizen.occupation}${citizen.residentKind === 'visitor' ? ' · visitor' : ''}`).join('\n') || 'none';
  const businessesTitle = document.createElement('span');
  businessesTitle.textContent = 'Businesses';
  const businessList = document.createElement('p');
  businessList.textContent = snapshot.businesses.map((business) => `${business.name} · ${business.visitCount ?? 0} visits · ${(business.employeeIds ?? []).length} helpers`).join('\n') || 'none';
  const effectsTitle = document.createElement('span');
  effectsTitle.textContent = 'Recent committed effects';
  const effects = document.createElement('p');
  effects.textContent = committedEffects.length ? committedEffects.join('\n') : 'none this session';
  const controls = document.createElement('div');
  controls.className = 'grow-tools';
  controls.innerHTML = `<button data-grow-action="nav">${navDebugVisible ? 'Hide' : 'Show'} nav</button><button data-grow-action="spawn">Spawn citizen</button><button data-grow-action="fauna">Scatter fauna</button><button data-grow-action="hour">+1 hour</button>`;
  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Discovery to force');
  for (const event of events) {
    const option = document.createElement('option');
    option.value = event.id;
    option.textContent = `${event.discovered ? '✓ ' : ''}${event.id}`;
    select.append(option);
  }
  if (events.some((event) => event.id === forcedEventSelection)) select.value = forcedEventSelection;
  select.addEventListener('change', () => { forcedEventSelection = select.value; });
  const force = document.createElement('button');
  force.dataset.growAction = 'force';
  force.textContent = 'Force event';
  controls.append(select, force);
  panel.append(heading, summary, controls, eligibleTitle, eligibleList, citizensTitle, citizenList, businessesTitle, businessList, effectsTitle, effects);
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

const JOURNAL_SKETCHES: Record<JournalIllustration, string> = {
  foundation: `
    <path class="wash" d="M27 55 Q52 48 79 55 L77 66 Q51 70 25 64Z"/>
    <path d="M22 58 Q52 52 84 58 M29 57 L31 43 L72 41 L76 56 M31 43 Q50 38 72 41 M39 43 L38 55 M52 41 L53 54 M64 42 L65 55"/>
    <path class="faint" d="M27 61 Q52 56 79 61 M33 46 Q52 41 70 44"/>`,
  garden: `
    <path class="wash botanical" d="M33 53 Q31 29 51 28 Q72 30 69 54Z"/>
    <path d="M20 61 Q51 55 86 60 M31 55 Q35 49 39 55 Q43 46 47 54 Q52 43 57 54 Q62 47 68 55 M50 55 Q49 42 52 28 M51 40 Q43 35 40 28 M52 37 Q61 32 65 24"/>
    <path class="faint" d="M35 58 Q51 52 72 58 M39 29 Q44 27 47 34 M58 31 Q63 27 66 25"/>`,
  arch: `
    <path class="wash water" d="M12 59 Q42 52 95 58 L95 70 L10 70Z"/>
    <path d="M12 59 Q38 53 96 58 M24 56 L25 27 L43 23 L46 55 M62 55 L65 22 L83 28 L84 57 M42 54 Q53 35 65 54 M30 31 L41 28 M68 27 L79 32"/>
    <path class="faint" d="M16 63 Q51 57 91 63 M44 57 Q53 40 63 56"/>`,
  bridge: `
    <path class="wash water" d="M9 57 Q50 51 99 58 L98 70 L8 70Z"/>
    <path d="M10 59 Q51 53 98 59 M18 55 L21 32 L37 27 L39 53 M69 53 L71 26 L88 32 L90 56 M36 33 Q53 22 72 31 M37 37 Q54 29 71 35 M43 34 L44 43 M51 30 L52 40 M61 30 L62 40"/>
    <path class="faint" d="M14 64 Q51 58 94 63"/>`,
  tower: `
    <path class="wash" d="M39 61 L41 21 L69 20 L72 62Z"/>
    <path d="M25 62 Q54 57 84 62 M41 59 L42 21 L68 20 L71 60 M38 22 Q54 14 72 21 M48 18 L49 11 M57 17 L58 9 M64 18 L66 12 M48 31 L62 30 M48 39 L63 38 M49 48 L64 47"/>
    <path class="faint" d="M45 59 L46 24 M70 62 Q53 56 37 62"/>`,
  neighbors: `
    <path class="wash warm" d="M27 58 L29 33 L48 30 L50 58 M58 58 L59 27 L80 31 L82 59Z"/>
    <path d="M17 61 Q52 56 91 61 M27 57 L29 33 L48 30 L50 58 M58 58 L59 27 L80 31 L82 59 M26 34 Q38 25 51 31 M56 29 Q70 20 83 30 M38 57 L38 43 M70 58 L70 42 M43 38 Q52 35 60 37"/>
    <circle cx="52" cy="36" r="2"/><circle cx="56" cy="36" r="2"/>`,
  street: `
    <path class="wash" d="M14 56 L18 35 L33 31 L36 55 L40 29 L55 25 L58 54 L63 34 L79 30 L85 56Z"/>
    <path d="M10 61 Q49 53 98 61 M16 56 L18 35 L33 31 L36 55 M38 55 L40 29 L55 25 L58 54 M61 55 L63 34 L79 30 L84 57 M16 36 L27 28 L36 33 M38 30 L49 20 L59 27 M61 35 L71 27 L83 32 M24 54 L24 44 M47 53 L47 38 M71 54 L71 43"/>
    <path class="faint" d="M18 65 Q52 57 91 64"/>`,
  friendship: `
    <path class="wash warm" d="M37 57 Q36 43 43 40 Q49 42 49 57 M57 58 Q56 41 63 39 Q70 42 69 58Z"/>
    <path d="M17 62 Q53 56 91 62 M40 58 L39 47 Q39 41 44 40 Q50 41 49 47 L49 58 M58 58 L57 46 Q57 40 63 39 Q70 41 69 47 L68 58 M44 39 Q43 33 47 31 Q52 34 49 39 M63 38 Q61 32 66 30 Q71 33 68 39 M49 48 Q54 45 58 47"/>
    <path class="faint" d="M47 50 Q54 48 61 50"/>`,
  bread: `
    <path class="wash warm" d="M30 59 Q31 39 53 36 Q78 39 79 58Z"/>
    <path d="M16 62 Q53 57 92 62 M29 58 Q30 40 53 36 Q77 39 80 58 M40 42 Q43 47 41 53 M51 38 Q55 45 52 51 M64 40 Q67 46 64 53 M24 30 Q29 25 25 20 M43 27 Q48 22 44 16 M64 28 Q69 23 66 18"/>
    <path class="faint" d="M33 61 Q55 54 76 60"/>`,
  tea: `
    <path class="wash water" d="M35 43 L69 43 L66 59 Q52 65 38 57Z"/>
    <path d="M17 62 Q50 57 91 62 M35 42 L38 56 Q51 63 65 57 L69 42Z M69 46 Q80 43 78 51 Q76 56 67 54 M33 41 Q52 45 71 41 M44 35 Q39 29 45 25 M56 35 Q51 29 57 23 M65 35 Q61 30 66 27"/>
    <path class="faint" d="M39 45 Q52 48 66 44"/>`,
  tools: `
    <path class="wash" d="M36 59 L65 26 L73 33 L45 63Z"/>
    <path d="M15 62 Q53 56 93 62 M34 58 L64 28 M40 63 L70 33 M63 27 L70 22 L77 29 L71 36 M34 57 L29 62 L37 65 L42 61 M44 29 L46 51 M40 30 L49 27 M41 35 L49 33"/>
    <path class="faint" d="M36 60 L68 29 M17 65 Q52 60 90 65"/>`,
  fish: `
    <path class="wash water" d="M24 53 Q45 36 70 47 L83 39 L81 56 L69 50 Q45 64 24 53Z"/>
    <path d="M15 62 Q51 57 94 62 M23 52 Q43 35 69 46 L82 38 L81 56 L69 50 Q45 64 23 52Z M35 48 Q45 55 55 45 M40 57 Q49 50 60 53"/>
    <circle cx="63" cy="46" r="1.7"/><path class="faint" d="M18 66 Q52 61 90 66"/>`,
  inn: `
    <path class="wash warm" d="M31 60 L33 28 L73 27 L77 60Z"/>
    <path d="M18 63 Q51 57 91 63 M31 59 L33 28 L73 27 L77 60 M29 30 Q52 19 77 28 M48 59 L48 43 L62 43 L63 59 M39 38 L43 38 M67 37 L71 37 M80 23 L80 36"/>
    <path class="accent-line" d="M75 34 Q80 29 85 34 L84 44 Q80 48 76 43Z M76 37 L84 37"/>`,
  market: `
    <path class="wash warm" d="M15 36 Q52 27 91 35 L86 46 Q51 40 19 47Z"/>
    <path d="M10 62 Q52 55 98 62 M18 59 L19 37 M86 58 L89 35 M15 36 Q52 26 92 35 M18 37 Q23 48 31 36 Q39 45 47 33 Q55 43 63 33 Q72 42 82 34 Q86 41 90 35 M28 48 L28 58 M52 45 L52 57 M76 46 L76 58"/>
    <path class="faint" d="M20 65 Q55 59 91 65"/>`,
  town: `
    <path class="wash water" d="M7 58 Q52 50 101 58 L100 70 L7 70Z"/>
    <path d="M7 59 Q51 51 101 59 M14 56 L17 39 L30 35 L34 55 M33 55 L36 28 L53 24 L58 53 M57 54 L61 34 L76 30 L80 55 M79 56 L83 42 L94 39 L96 58 M15 40 L25 31 L34 37 M34 30 L46 18 L59 27 M59 35 L69 26 L80 32 M82 43 L89 36 L97 41"/>
    <path class="accent-line" d="M43 39 L49 38 M66 43 L71 42 M87 49 L91 48"/><path class="faint" d="M10 65 Q54 57 98 64"/>`,
  pots: `
    <path class="wash botanical" d="M28 55 L31 42 L43 42 L45 56 M48 56 L50 38 L64 38 L66 56 M69 56 L72 44 L83 44 L84 57Z"/>
    <path d="M16 61 Q51 56 92 61 M28 43 L31 55 L43 55 L45 43 M49 39 L51 55 L64 55 L66 39 M70 45 L73 56 L83 56 L85 45 M37 42 Q34 33 38 27 M37 36 Q29 31 28 25 M38 34 Q45 28 45 23 M57 38 Q54 29 58 22 M57 31 Q49 26 50 20 M58 29 Q65 24 67 18 M78 44 Q77 36 82 31"/>
    <path class="faint" d="M18 65 Q52 60 89 65"/>`,
  gulls: `
    <path class="wash water" d="M9 59 Q52 51 99 59 L98 70 L8 70Z"/>
    <path d="M9 60 Q51 53 99 60 M25 35 Q32 27 40 35 Q48 25 57 34 M56 22 Q62 16 69 23 Q75 16 82 23 M28 58 L30 43 L46 40 L50 57 M28 44 L39 36 L50 41"/>
    <path class="faint" d="M13 65 Q53 58 94 65 M27 37 Q33 30 40 37"/>`,
  blossom: `
    <path class="wash botanical" d="M19 53 Q37 25 80 24 Q70 48 49 58Z"/>
    <path d="M14 62 Q51 55 94 62 M24 57 Q38 42 50 35 Q62 29 82 22 M47 37 Q39 30 31 28 M58 31 Q56 22 61 16 M66 28 Q75 31 83 28"/>
    <path class="accent-line" d="M27 27 q4-6 8 0 q6-2 4 4 q2 5-4 4 q-4 5-7 0 q-6 0-3-5Z M57 16 q4-6 8 0 q6-1 4 4 q2 5-4 4 q-4 5-7 0 q-5 0-2-5Z M78 27 q4-5 7 0 q5-1 3 4 q2 4-3 3 q-4 5-7 0 q-5 0-2-4Z"/>`,
  chorus: `
    <path class="wash night" d="M8 58 Q53 49 100 58 L99 70 L8 70Z"/>
    <path d="M8 60 Q53 51 100 60 M22 56 L25 39 L42 35 L46 55 M65 55 L67 34 L84 38 L87 57 M23 40 L34 31 L46 37 M65 36 L75 29 L87 37 M29 25 Q36 18 44 26 Q51 18 58 25"/>
    <path class="accent-line" d="M20 30 l3-2 m-1 4 l3 1 M60 20 l2-3 m1 4 l3-1 M85 26 l3-2 m-1 4 l3 1"/><path class="faint" d="M12 65 Q52 57 96 65"/>`,
  supper: `
    <path class="wash warm" d="M26 49 Q51 42 80 49 L76 58 Q52 63 29 57Z"/>
    <path d="M14 63 Q52 57 94 63 M26 49 Q52 42 80 49 Q76 58 29 57Z M36 57 L33 65 M69 57 L73 64 M36 47 Q35 37 40 34 Q46 35 45 45 M62 45 Q61 34 67 32 Q73 34 72 47 M40 33 Q39 27 44 26 Q49 29 46 34 M67 31 Q66 25 71 24 Q76 27 73 33"/>
    <path class="accent-line" d="M46 51 Q52 47 59 51 M50 53 l3 2 l3-3"/>`,
  festival: `
    <path class="wash warm" d="M13 31 Q51 20 95 29 L94 40 Q52 31 15 42Z"/>
    <path d="M11 62 Q52 55 98 62 M18 58 L20 39 M86 57 L89 37 M14 31 Q53 19 96 29 M22 29 L27 38 L33 26 L40 35 L47 23 L55 32 L63 22 L71 31 L80 23 L87 32 M24 58 L24 47 M79 57 L79 45"/>
    <path class="faint" d="M16 65 Q52 58 94 65"/>`,
  'blossom-night': `
    <path class="wash night" d="M8 58 Q52 50 100 58 L99 70 L8 70Z"/>
    <path d="M8 60 Q52 52 100 60 M15 32 Q51 21 94 30 M22 30 L28 38 L35 27 L43 35 L51 24 L60 32 L69 23 L78 31 L87 25 M22 57 Q39 43 52 36 Q65 28 88 21"/>
    <path class="accent-line" d="M30 35 q3-5 7 0 q5-1 3 4 q2 4-3 3 q-3 4-6 0 q-5 0-2-4Z M62 29 q3-5 7 0 q5-1 3 4 q2 4-3 3 q-3 4-6 0 q-4 0-2-4Z M82 22 q3-4 6 0 q4-1 3 3 q1 4-3 3 q-3 4-5 0 q-4 0-2-3Z"/>`,
  lanterns: `
    <path class="wash night" d="M7 58 Q52 49 101 58 L100 70 L7 70Z"/>
    <path d="M7 60 Q52 51 101 60 M13 56 L16 38 L31 34 L35 55 M34 55 L38 27 L55 23 L59 53 M58 54 L62 33 L78 29 L82 55 M81 56 L85 41 L96 38 L98 58 M14 39 L26 30 L35 36 M36 29 L48 18 L60 26 M60 34 L70 25 L82 31 M83 42 L90 35 L98 40"/>
    <path class="accent-line" d="M22 43 q4-3 8 0 l-1 8 q-3 4-7 0Z M44 35 q5-4 9 0 l-1 10 q-4 5-8 0Z M67 40 q4-3 8 0 l-1 9 q-3 4-7 0Z M87 47 q3-3 7 0 l-1 7 q-3 3-6 0Z"/><path class="faint" d="M11 65 Q53 57 97 65"/>`,
};

function createJournalSketch(scene: JournalIllustration) {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 108 72" focusable="false" aria-hidden="true">
    <g class="journal-sketch-lines">${JOURNAL_SKETCHES[scene]}</g>
  </svg>`;
  return template.content.firstElementChild!;
}

function createJournalEntry(entry: JournalEntry) {
  const article = document.createElement('article');
  article.className = 'journal-entry';
  const illustration = document.createElement('div');
  illustration.className = 'journal-illustration';
  illustration.dataset.scene = entry.illustration;
  illustration.setAttribute('aria-hidden', 'true');
  illustration.append(createJournalSketch(entry.illustration));
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

renderJournal();

function setJournalOpen(open: boolean) {
  const scrim = document.querySelector('#journal-scrim')!;
  scrim.classList.toggle('show', open);
  scrim.setAttribute('aria-hidden', String(!open));
}

function applyBusinessUpdate(update: BusinessUpdate, announce: boolean) {
  if (!update.changed) return;
  const current = businesses.all();
  const visibleChange = update.opened.length > 0 || update.closed.length > 0 || update.hired.length > 0;
  if (visibleChange) {
    city.setBusinesses(current);
    citizens.setBusinesses(current);
    refreshAmbience();
    renderer.shadowMap.needsUpdate = true;
  }
  if (announce && update.closed[0]) {
    showToast(`${update.closed[0].name} has quietly closed its shutters.`);
  }
  if (announce && update.hired[0]) {
    const hire = update.hired[0];
    const citizen = citizens.card(hire.citizenId);
    showToast(`${citizen?.name ?? 'A neighbor'} has begun helping at ${hire.business.name}.`);
    playCue('door');
  }
  persistSoon();
  if (update.opened.length) evaluateDiscoveries();
}

function getAudio() {
  audioContext ??= new AudioContext();
  return audioContext;
}

function softTone(frequency: number, duration: number, delay = 0, volume = .055, wave: OscillatorType = 'sine') {
  const context = getAudio();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = wave;
  oscillator.frequency.setValueAtTime(frequency, context.currentTime + delay);
  oscillator.frequency.exponentialRampToValueAtTime(frequency * 1.18, context.currentTime + delay + duration);
  gain.gain.setValueAtTime(.0001, context.currentTime + delay);
  gain.gain.exponentialRampToValueAtTime(volume, context.currentTime + delay + .012);
  gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + delay + duration);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start(context.currentTime + delay);
  oscillator.stop(context.currentTime + delay + duration + .02);
}

function playHarborAmbience(daylight: number) {
  if (!audioContext || audioContext.state !== 'running') return;
  playCue('water', daylight);
  if (citizens.walkingCount() > 0) playCue('footsteps');
  if (citizens.population() > 3 && daylight > .28) playCue('chatter');
  if (grow.discoveredIds().includes('gulls-return') && daylight > .4) playCue('gulls');
  if (daylight < .32) playCue('insects');
  if (ambience.activeFleet().some((kind) => kind === 'ferry' || kind === 'merchant boat')) playCue('horn');
  if (grow.discoveredIds().includes('lantern-finale')) {
    softTone(760, .38, .5, .01, 'sine');
    softTone(910, .42, .78, .008, 'sine');
  }
}

type SoundCue = 'water' | 'gulls' | 'footsteps' | 'door' | 'chatter' | 'bell' | 'horn' | 'insects' | 'celebration';

function playCue(cue: SoundCue, daylight = 1) {
  if (audioContext && audioContext.state !== 'running') return;
  if (cue === 'water') softTone(105 + daylight * 38, .7, 0, .009, 'sine');
  if (cue === 'gulls') { softTone(1120, .11, .12, .009, 'triangle'); softTone(870, .14, .25, .007, 'triangle'); }
  if (cue === 'footsteps') { softTone(155, .035, 0, .006, 'square'); softTone(145, .035, .16, .005, 'square'); }
  if (cue === 'door') softTone(220, .09, 0, .018, 'triangle');
  if (cue === 'chatter') { softTone(330, .08, .06, .005, 'sine'); softTone(410, .07, .2, .004, 'sine'); }
  if (cue === 'bell') { softTone(690, .72, 0, .035, 'sine'); softTone(1035, .85, .04, .018, 'sine'); }
  if (cue === 'horn') softTone(132, .62, .14, .02, 'sine');
  if (cue === 'insects') { softTone(1320, .08, .2, .004, 'triangle'); softTone(1480, .06, .34, .003, 'triangle'); }
  if (cue === 'celebration') {
    playCue('bell');
    [520, 660, 790, 1040].forEach((frequency, index) => softTone(frequency, .24, .18 + index * .11, .018, 'triangle'));
  }
}

function popSound() {
  softTone(260, .11);
  softTone(430, .13, .045);
}

function centerView() {
  controls.target.set(0, 1.3, 0);
  camera.position.set(18, 19, 20);
  controls.update();
}

document.querySelector('#center')!.addEventListener('click', centerView);
document.querySelector('#touch-center')!.addEventListener('click', () => {
  centerView();
  showToast('The harbor drifts back into view.');
});

function setTouchMode(mode: 'build' | 'remove') {
  touchMode = mode;
  hover.visible = false;
  hoveredCell = null;
  renderer.domElement.classList.toggle('remove-mode', mode === 'remove');
  document.querySelectorAll<HTMLButtonElement>('[data-touch-mode]').forEach((button) => {
    const active = button.dataset.touchMode === mode;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  showToast(mode === 'build' ? 'Tap the water to build.' : 'Tap a building to remove one floor.');
}

document.querySelectorAll<HTMLButtonElement>('[data-touch-mode]').forEach((button) => {
  button.addEventListener('click', () => setTouchMode(button.dataset.touchMode === 'remove' ? 'remove' : 'build'));
});

function setTouchGuideOpen(open: boolean) {
  const guide = document.querySelector<HTMLElement>('#touch-guide')!;
  const helpButton = document.querySelector<HTMLButtonElement>('#touch-help-toggle')!;
  guide.classList.toggle('show', open);
  guide.setAttribute('aria-hidden', String(!open));
  document.querySelector('.hud')!.classList.toggle('touch-guide-open', open);
  helpButton.setAttribute('aria-expanded', String(open));
  if (open) window.setTimeout(() => document.querySelector<HTMLButtonElement>('#touch-guide-done')!.focus(), 50);
  else if (guide.contains(document.activeElement)) helpButton.focus();
}

document.querySelector('#touch-help-toggle')!.addEventListener('click', () => setTouchGuideOpen(true));
document.querySelector('#touch-guide-close')!.addEventListener('click', () => setTouchGuideOpen(false));
document.querySelector('#touch-guide-done')!.addEventListener('click', () => setTouchGuideOpen(false));
document.querySelector('#touch-guide')!.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) setTouchGuideOpen(false);
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

document.querySelector('#grow-inspector')!.addEventListener('click', (event) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-grow-action]');
  if (!button) return;
  const action = button.dataset.growAction;
  if (action === 'nav') {
    navDebugVisible = !navDebugVisible;
    citizens.setNavDebugVisible(navDebugVisible);
  } else if (action === 'spawn') {
    const id = citizens.debugSpawnCitizen();
    showToast(id ? 'A developer-spawned citizen has arrived.' : 'Build a home before spawning a citizen.');
    refreshAmbience();
    persistSoon();
  } else if (action === 'fauna') {
    const focus = hoveredCell ?? { x: 0, z: 0 };
    ambience.scatterWildlife(focus.x, focus.z);
    showToast('The harbor wildlife scatters, then settles again.');
  } else if (action === 'hour') {
    timeOfDay += 1;
    if (timeOfDay >= 24) { timeOfDay %= 24; day += 1; }
    evaluateDiscoveries();
    persistSoon();
  } else if (action === 'force') {
    const discovery = grow.force(forcedEventSelection, currentSnapshot());
    if (discovery) {
      city.setDiscoveryState(grow.discoveredIds());
      citizens.setDiscoveries(grow.discoveredIds());
      refreshAmbience();
      renderJournal();
      showToast(`Forced: ${discovery.event.title}`);
      persistSoon();
    }
  }
  updateGrowInspector();
});

window.addEventListener('keydown', (event) => {
  if (event.key.toLowerCase() === 'p') document.querySelector('#perf-panel')!.classList.toggle('show');
  if (event.key.toLowerCase() === 'j') setJournalOpen(!document.querySelector('#journal-scrim')!.classList.contains('show'));
  if (event.key.toLowerCase() === 'g') {
    document.querySelector('#grow-inspector')!.classList.toggle('show');
    updateGrowInspector();
  }
  if (event.key === 'Escape') {
    setJournalOpen(false);
    setTouchGuideOpen(false);
  }
});

const ambience = new HarborAmbience(seed, camera, city.cells.values());
ambience.setDiscoveryState(grow.discoveredIds());
ambience.setTown(city.cells.values(), businesses.all(), citizens.residents());
scene.add(ambience.root);

function refreshAmbience() {
  ambience.setTown(city.cells.values(), businesses.all(), citizens.residents());
  ambience.setDiscoveryState(grow.discoveredIds());
  citizens.setDiscoveries(grow.discoveredIds());
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
let ambientSoundElapsed = 0;
let inspectorElapsed = 0;
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
  ambientSoundElapsed += rawDelta;
  inspectorElapsed += rawDelta;
  const deltaHours = delta * simulationSpeed * .05;
  timeOfDay += deltaHours;
  if (timeOfDay >= 24) {
    timeOfDay %= 24;
    day += 1;
  }
  const absoluteHours = day * 24 + timeOfDay;
  const currentHour = Math.floor(absoluteHours);
  if (currentHour !== lastChimedHour) {
    lastChimedHour = currentHour;
    if (grow.discoveredIds().includes('clock-tower')) playCue('bell');
  }
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
    const residentState = citizens.residents();
    applyBusinessUpdate(businesses.recordVisits(citizens.drainBusinessVisits(), residentState), true);
    const businessUpdate = businesses.update(residentState, city.cells, absoluteHours);
    applyBusinessUpdate(businessUpdate, true);
    businessCheckElapsed = 0;
  }
  if (discoveryCheckElapsed > .5) {
    evaluateDiscoveries();
    discoveryCheckElapsed = 0;
  }
  if (ambientSoundElapsed > 11) {
    playHarborAmbience(daylight);
    ambientSoundElapsed = 0;
  }
  if (inspectorElapsed > .75) {
    updateGrowInspector();
    inspectorElapsed = 0;
  }
  ambience.update(time, daylight, timeOfDay, absoluteHours);
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
