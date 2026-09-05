import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CityRenderer, type CityMemoryInspection } from './city';
import { CitizenSystem } from './citizens';
import { BusinessSystem, type BusinessUpdate } from './businesses';
import { createWorldSnapshot, DISCOVERY_EVENTS, GrowSystem, resolveFocus, type DiscoveryClue, type DiscoveryEffect, type TriggeredDiscovery } from './grow';
import { HarborAmbience, type HarborMemoryInspection } from './harbor';
import { weatherAt, type TownMemorySnapshot } from './memory';
import { CraftingSystem } from './crafting';
import type { JournalEntry, JournalIllustration, SavedTown } from './types';
import { FLOOR_HEIGHT } from './spatial';
import { makeTidePostcard, readTidePostcard, TidePostcardError } from './tide-postcard';
import { makeTownStl } from './town-stl';
import { composePostcard, postcardDate } from './postcard-image';
import './style.css';

const STORAGE_KEY = 'little-tides-town-v1';
const MUSIC_MUTED_KEY = 'little-tides-music-muted';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="hud">
    <div class="brand"><h1>Little Tides</h1><p>潮町 · a town from the sea</p></div>
    <div class="time-widget" aria-label="Time and simulation speed">
      <span id="clock-display" class="desktop-clock">Day 1 · 07:30</span>
      <span id="mobile-clock-display" class="mobile-clock" aria-hidden="true">D1 · 07:30</span>
      <div class="speed-controls">
        <button data-speed="0" aria-label="Pause simulation">Ⅱ</button>
        <button data-speed="1" class="active" aria-label="Normal simulation speed">1×</button>
        <button data-speed="3" aria-label="Triple simulation speed">3×</button>
      </div>
      <button id="music-toggle" class="music-toggle" aria-label="Turn music off" aria-pressed="true"><span aria-hidden="true">♫</span></button>
    </div>
    <div class="top-actions">
      <button id="mobile-menu-toggle" class="mobile-menu-toggle" aria-label="Open town controls" aria-controls="top-actions-menu" aria-expanded="false"><span aria-hidden="true">☰</span></button>
      <div class="top-actions-menu" id="top-actions-menu">
        <button id="journal-open" aria-label="Open observation journal"><span class="desktop-journal-label">Journal</span><span class="mobile-journal-label" aria-hidden="true">▤</span><span id="journal-count">0</span></button>
        <button id="observe-toggle" title="Observe town history" aria-label="Observe town history" aria-pressed="false"><span class="desktop-observe-label">Observe</span><span class="mobile-observe-label" aria-hidden="true">◉</span></button>
        <button id="postcard-open" aria-label="Save or load a tide postcard"><span class="desktop-postcard-label">Postcard</span><span class="mobile-postcard-label" aria-hidden="true">⇧</span></button>
        <button id="about-open" aria-label="About Little Tides"><span class="desktop-about-label">About</span><span class="mobile-about-label" aria-hidden="true">i</span></button>
        <button id="reset" aria-label="Start a new town"><span class="desktop-reset-label">New tide</span><span class="mobile-reset-label" aria-hidden="true">↻</span></button>
      </div>
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
    <aside class="memory-card" id="memory-card" aria-label="Town memory" aria-live="polite">
      <button class="card-close" id="memory-card-close" aria-label="Close town memory">×</button>
      <span class="card-kicker" id="memory-kicker">Town memory</span>
      <h2 id="memory-title"></h2>
      <p class="card-role" id="memory-age"></p>
      <p id="memory-detail"></p>
      <p class="card-relationship" id="memory-note"></p>
    </aside>
    <aside class="tide-thread" id="tide-thread" aria-live="polite">
      <button class="thread-close" id="thread-close" aria-label="Stop following this thread">×</button>
      <span>Following a thread</span>
      <strong id="thread-title"></strong>
      <p id="thread-hint"></p>
      <div class="thread-progress" role="progressbar" aria-label="Discovery progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="thread-progress-fill"></i></div>
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
          <div><span class="gesture-icon" aria-hidden="true">◉</span><p>Choose <strong>Observe</strong> above, then tap a building, tree, animal, boat, or resident to read its history.</p></div>
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
    <div class="about-scrim" id="about-scrim" aria-hidden="true">
      <section class="about-panel" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <button class="about-close" id="about-close" aria-label="Close About">×</button>
        <span class="about-kicker">A town from the sea</span>
        <h2 id="about-title">Little Tides</h2>
        <p>Build without pressure and watch a tiny harbor find its own routines, friendships, and quiet surprises.</p>
        <p class="creator-credit">Made by <a href="https://szabadkai.com" target="_blank" rel="noreferrer">Levente Szabadkai</a>.</p>
        <p class="music-credit">Music: <a href="https://opengameart.org/content/caketown-cuteplayful" target="_blank" rel="noreferrer">“Caketown - Cute/playful”</a> by Matthew Pablo, licensed <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>.<br><a href="https://opengameart.org/content/free-contemplative-fantasy-music-pack" target="_blank" rel="noreferrer">“Déjà Vus”</a> by <a href="https://yannz41.itch.io" target="_blank" rel="noreferrer">YannZ</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. Transcoded from MP3 to 64 kbps AAC. <a href="https://open.spotify.com/intl-it/artist/76CUcHd0t0XViSm9YBbHBw" target="_blank" rel="noreferrer">Spotify</a> · <a href="mailto:yziango@gmail.com">Contact</a>.</p>
      </section>
    </div>
    <div class="postcard-scrim" id="postcard-scrim" aria-hidden="true">
      <section class="postcard-panel" role="dialog" aria-modal="true" aria-labelledby="postcard-title">
        <button class="postcard-close" id="postcard-close" aria-label="Close tide postcard">×</button>
        <span class="postcard-kicker">Keep this little harbor</span>
        <h2 id="postcard-title">Tide postcard</h2>
        <p>Save a shareable, restorable PNG—or bring your harbor into the physical world.</p>
        <div class="postcard-preview" aria-hidden="true"><span class="postcard-stamp">潮</span><strong id="postcard-message-preview">Wish you were here by the water.</strong><i id="postcard-date-preview">Day 1</i></div>
        <label class="postcard-inscription" for="postcard-message">Inscription<input id="postcard-message" maxlength="60" value="Wish you were here by the water."></label>
        <button class="postcard-save" id="postcard-save">Save tide postcard</button>
        <button class="postcard-stl" id="postcard-stl">Export 3D model (.stl)</button>
        <button class="postcard-load" id="postcard-load">Load a postcard</button>
        <input id="postcard-file" type="file" accept="image/png,.png" hidden>
        <p class="postcard-note" id="postcard-note" aria-live="polite">Anyone can view the picture. Little Tides can also read the town tucked inside it.</p>
      </section>
    </div>
  </div>
`;

const saved = loadTown();
const seed = saved?.seed ?? Math.floor(Math.random() * 2_000_000_000);
let timeOfDay = saved?.timeOfDay ?? 7.5;
let day = saved?.day ?? 1;
const restoredCatEntry = saved?.journal?.find((entry) => entry.eventId === 'harbor-cats');
let catColonyFoundedAt = saved?.catColonyFoundedAt
  ?? (saved?.discoveries?.includes('harbor-cats')
    ? restoredCatEntry ? restoredCatEntry.day * 24 + restoredCatEntry.timeOfDay : day * 24 + timeOfDay
    : undefined);
let simulationSpeed = 1;
const committedEffects: string[] = [];
let navDebugVisible = false;
let forcedEventSelection = DISCOVERY_EVENTS[0]?.id ?? '';
let lastChimedHour = Math.floor(timeOfDay);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x91c7c1);
const sceneFog = new THREE.FogExp2(0x91c7c1, .0135);
scene.fog = sceneFog;

const camera = new THREE.PerspectiveCamera(34, innerWidth / innerHeight, .1, 300);
camera.position.set(18, 19, 20);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
const maximumPixelRatio = Math.min(devicePixelRatio, 1.5);
let renderPixelRatio = maximumPixelRatio;
renderer.setPixelRatio(renderPixelRatio);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.querySelector('#app')!.prepend(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
// Keep dragging direct: camera movement should stop as soon as the pointer is released.
controls.enableDamping = false;
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

function createWaterNoiseTexture(size = 128) {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * Math.PI * 2;
    const v = y / size * Math.PI * 2;
    const first = Math.sin(u * 3 + Math.sin(v * 2)) * .5 + .5;
    const second = Math.sin(v * 5 - Math.cos(u * 2)) * .5 + .5;
    const fine = Math.sin((u + v) * 7) * .5 + .5;
    const index = (y * size + x) * 4;
    data[index] = Math.round(first * 255);
    data[index + 1] = Math.round(second * 255);
    data[index + 2] = Math.round(fine * 255);
    data[index + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

const waterUniforms = {
  uTime: { value: 0 },
  uDay: { value: 1 },
  uRain: { value: 0 },
  uNoise: { value: createWaterNoiseTexture() },
};
const waterMaterial = new THREE.ShaderMaterial({
  uniforms: waterUniforms,
  transparent: false,
  vertexShader: `
    varying vec3 vWorld;
    void main() {
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `,
  fragmentShader: `
    uniform float uTime;
    uniform float uDay;
    uniform float uRain;
    uniform sampler2D uNoise;
    varying vec3 vWorld;
    void main() {
      vec2 baseUv = vWorld.xz * .018;
      vec3 first = texture2D(uNoise, baseUv + vec2(uTime * .007, -uTime * .004)).rgb;
      vec3 second = texture2D(uNoise, baseUv * 1.73 + vec2(-uTime * .004, uTime * .006)).rgb;
      float wave = (first.r + second.g - 1.0) * (.12 + uRain * .08);
      float ribbons = first.b * .55 + second.r * .45;
      vec3 deep = vec3(.075, .34, .37);
      vec3 pale = vec3(.24, .61, .58);
      vec3 color = mix(deep, pale, .50 + wave * 1.75 + ribbons * .055);
      color += vec3(.055, .035, .008) * ribbons;
      color *= mix(.34, 1.0, uDay);
      color += vec3(.018, .026, .055) * (1.0 - uDay);
      color = mix(color, color * .72 + vec3(.025, .055, .065), uRain * .58);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), waterMaterial);
water.rotation.x = -Math.PI / 2;
water.position.y = -.31;
scene.add(water);

const city = new CityRenderer(seed);
scene.add(city.root);
if (saved) city.load(saved.cells, day * 24 + timeOfDay);
const citizens = new CitizenSystem(seed, city.cells, saved?.citizens ?? []);
scene.add(citizens.root);
const businesses = new BusinessSystem(seed, saved?.businesses ?? []);
businesses.maintain(citizens.residents(), city.cells);
city.setBusinesses(businesses.all());
citizens.setBusinesses(businesses.all());
const crafting = new CraftingSystem(saved?.crafting);
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
let musicMuted = localStorage.getItem(MUSIC_MUTED_KEY) === 'true';
const musicTracks = ['audio/deja-vus.m4a', 'audio/caketown.mp3'];
let musicTrackIndex = 0;
const backgroundMusic = new Audio(`${import.meta.env.BASE_URL}${musicTracks[musicTrackIndex]}`);
backgroundMusic.preload = 'metadata';
backgroundMusic.volume = .18;
backgroundMusic.addEventListener('ended', () => {
  musicTrackIndex = (musicTrackIndex + 1) % musicTracks.length;
  backgroundMusic.src = `${import.meta.env.BASE_URL}${musicTracks[musicTrackIndex]}`;
  void startBackgroundMusic();
});
let selectedCitizenId: string | null = null;
let touchMode: 'build' | 'remove' = 'build';
let followedThreadId: string | null = saved?.followedDiscoveryId ?? null;
let observeMode = false;
let selectedMemoryReader: (() => CityMemoryInspection | HarborMemoryInspection | null) | null = null;

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
  // Mouse/pen hover should keep the build target live before a gesture begins.
  if (!activePointers.size) {
    updateHover(event.clientX, event.clientY);
    return;
  }
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
  if (event.button === 0) {
    if (touchMode === 'remove' && hoveredCell) {
      hideCitizenCard();
      demolish(hoveredCell.x, hoveredCell.z);
    } else if (!inspectCitizen(event.clientX, event.clientY)) {
      hideCitizenCard();
      if (observeMode) inspectTownMemory(event.clientX, event.clientY);
      else if (hoveredCell) {
        hideMemoryCard();
        build(hoveredCell.x, hoveredCell.z);
      }
    }
  }
  if (event.button === 2 && hoveredCell) demolish(hoveredCell.x, hoveredCell.z);
  if (event.pointerType === 'touch') {
    hover.visible = false;
    hoveredCell = null;
    renderer.domElement.classList.remove('inspect-resident');
    renderer.domElement.classList.remove('inspect-observable');
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
  renderer.domElement.classList.remove('inspect-resident');
  renderer.domElement.classList.remove('inspect-observable');
  renderer.domElement.classList.remove('dragging');
});
renderer.domElement.addEventListener('contextmenu', (event) => event.preventDefault());

function resetPointerGesture() {
  gesturePointerId = null;
  multiTouchGesture = false;
  dragged = false;
  renderer.domElement.classList.remove('dragging');
}

function cancelCameraGesture() {
  for (const pointerId of [...activePointers]) {
    renderer.domElement.dispatchEvent(new PointerEvent('pointercancel', { pointerId }));
  }
  activePointers.clear();
  resetPointerGesture();
  hover.visible = false;
  hoveredCell = null;
  renderer.domElement.classList.remove('inspect-resident');
  renderer.domElement.classList.remove('inspect-observable');

  // Preserve the current view while forcing OrbitControls back to its idle state.
  controls.saveState();
  controls.reset();
}

function updateHover(clientX: number, clientY: number) {
  pointer.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const residentHovered = citizens.pick(raycaster) !== null;
  const absoluteHours = day * 24 + timeOfDay;
  const observableHovered = observeMode && raycaster.intersectObject(ambience.root, true)
    .some((intersection) => ambience.memoryFromObject(intersection.object, absoluteHours, catColonyFoundedAt, intersection.instanceId) !== null);
  renderer.domElement.classList.toggle('inspect-resident', residentHovered);
  renderer.domElement.classList.toggle('inspect-observable', observableHovered);
  if (residentHovered || observableHovered) {
    hover.visible = false;
    hoveredCell = null;
    return;
  }
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
  hover.position.set(x * size, cell ? .34 + cell.height * FLOOR_HEIGHT + previewHeight / 2 : .12, z * size);
  hoverMaterial.color.setHex(color);
  hoverOutlineMaterial.color.setHex(color);
}

function inspectCitizen(clientX: number, clientY: number) {
  pointer.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const citizenId = citizens.pick(raycaster);
  if (!citizenId) return false;
  hideMemoryCard();
  selectedCitizenId = citizenId;
  updateCitizenCard();
  hover.visible = false;
  return true;
}

function inspectTownMemory(clientX: number, clientY: number) {
  pointer.set(clientX / innerWidth * 2 - 1, -(clientY / innerHeight) * 2 + 1);
  raycaster.setFromCamera(pointer, camera);
  const absoluteHours = day * 24 + timeOfDay;
  const ambienceHit = raycaster.intersectObject(ambience.root, true)
    .find((intersection) => ambience.memoryFromObject(intersection.object, absoluteHours, catColonyFoundedAt, intersection.instanceId) !== null);
  const ambienceMemory = ambienceHit ? ambience.memoryFromObject(ambienceHit.object, absoluteHours, catColonyFoundedAt, ambienceHit.instanceId) : null;
  const cityPoint = ambienceMemory ? null : raycaster.intersectObject(city.root, true)
    .map((intersection) => city.cellFromObject(intersection.object))
    .find((point) => point !== null) ?? hoveredCell;
  const memory = ambienceMemory ?? (cityPoint ? cityObservationAt(cityPoint.x, cityPoint.z, absoluteHours) : null);
  if (!memory) {
    hideMemoryCard();
    showToast('Nothing here is ready to be observed yet.');
    return false;
  }
  selectedMemoryReader = ambienceMemory && ambienceHit
    ? () => ambience.memoryFromObject(ambienceHit.object, day * 24 + timeOfDay, catColonyFoundedAt, ambienceHit.instanceId)
    : cityPoint ? () => cityObservationAt(cityPoint.x, cityPoint.z, day * 24 + timeOfDay) : null;
  showMemoryCard(memory);
  return true;
}

function cityObservationAt(x: number, z: number, absoluteHours: number) {
  const memory = city.memoryAt(x, z, absoluteHours);
  if (!memory || memory.kind !== 'building') return memory;
  const business = businesses.all().find((candidate) => candidate.cellKey === `${x},${z}`);
  const status = business ? crafting.businessStatus(business.type) : null;
  return status ? { ...memory, detail: status, note: `${memory.detail} ${memory.note}` } : memory;
}

function showMemoryCard(memory: CityMemoryInspection | HarborMemoryInspection) {
  document.querySelector('#memory-kicker')!.textContent = memory.kind === 'cat' ? 'Harbor family' : memory.kind === 'wildlife' ? 'Harbor wildlife' : memory.kind === 'boat' ? 'Harbor vessel' : memory.kind === 'tree' ? 'Living landmark' : 'Town memory';
  document.querySelector('#memory-title')!.textContent = memory.title;
  document.querySelector('#memory-age')!.textContent = memory.ageLabel;
  document.querySelector('#memory-detail')!.textContent = memory.detail;
  document.querySelector('#memory-note')!.textContent = memory.note;
  document.querySelector('#memory-card')!.classList.add('show');
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

function hideMemoryCard() {
  selectedMemoryReader = null;
  document.querySelector('#memory-card')!.classList.remove('show');
}

function build(x: number, z: number) {
  if (!city.place(x, z, day * 24 + timeOfDay)) {
    showToast(city.get(x, z) ? 'That tower is tall enough.' : 'The water is too deep to build there.');
    softTone(150, .05);
    return;
  }
  citizens.rebuild(city.cells);
  ambience.scatterWildlife(x, z);
  refreshAmbience();
  applyBusinessUpdate(businesses.maintain(citizens.residents(), city.cells), false);
  performanceWarmup = 0;
  performanceCooldown = 0;
  overloadSeconds = 0;
  severeOverloadSeconds = 0;
  renderer.shadowMap.needsUpdate = true;
  ignoreNextPerformanceSample = true;
  popSound();
  persistSoon();
  document.querySelector('#hint')?.classList.add('hidden');
  evaluateDiscoveries();
}

function demolish(x: number, z: number) {
  if (!city.remove(x, z, day * 24 + timeOfDay)) return;
  hideMemoryCard();
  citizens.rebuild(city.cells);
  ambience.scatterWildlife(x, z);
  refreshAmbience();
  applyBusinessUpdate(businesses.maintain(citizens.residents(), city.cells), true);
  performanceWarmup = 0;
  performanceCooldown = 0;
  overloadSeconds = 0;
  severeOverloadSeconds = 0;
  renderer.shadowMap.needsUpdate = true;
  ignoreNextPerformanceSample = true;
  hideCitizenCard();
  softTone(190, .07);
  persistSoon();
  evaluateDiscoveries();
}

function persistSoon() {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(saveTown, 250);
}

function currentTownData(): SavedTown {
  return {
    version: 7,
    seed,
    cells: city.serialize(),
    timeOfDay,
    day,
    citizens: citizens.serialize(),
    businesses: businesses.serialize(),
    discoveries: grow.discoveredIds(),
    journal: grow.entries(),
    eventLastTriggeredAt: grow.recurringTriggerTimes(),
    followedDiscoveryId: followedThreadId ?? undefined,
    catColonyFoundedAt,
    crafting: crafting.serialize(),
  };
}

function saveTown() {
  const data = currentTownData();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadTown(): SavedTown | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedTown | null;
    return parsed?.version === 1 || parsed?.version === 2 || parsed?.version === 3 || parsed?.version === 4 || parsed?.version === 5 || parsed?.version === 6 || parsed?.version === 7 ? parsed : null;
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
  const absoluteHours = day * 24 + timeOfDay;
  const cityMemory = city.memoryStats(absoluteHours);
  const fauna = ambience.wildlifeStats();
  const weather = weatherAt(seed, absoluteHours);
  const memory: TownMemorySnapshot = {
    ...cityMemory,
    catPopulation: fauna.cats,
    catCapacity: fauna.catCapacity,
    kittenCount: fauna.kittens,
    migratingCats: fauna.migratingCats,
    rainIntensity: weather.intensity,
    raining: weather.raining,
  };
  return createWorldSnapshot({
    cells: city.cells.values(),
    citizens: citizens.residents(),
    businesses: businesses.serialize(),
    seed,
    day,
    timeOfDay,
    priorDiscoveries: grow.discoveredIds(),
    memory,
  });
}

function evaluateDiscoveries() {
  const snapshot = currentSnapshot();
  const triggered = grow.evaluate(snapshot);
  updateThreadStatus(snapshot);
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
    if (effect.animal === 'cats' && catColonyFoundedAt === undefined) catColonyFoundedAt = day * 24 + timeOfDay;
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
  // Replacing an open native select closes its popup before the user can make
  // a choice. The inspector refreshes on a timer, so leave its controls alone
  // while the event picker has focus and resume refreshing after it blurs.
  if (panel.querySelector('select') === document.activeElement) return;
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
  summary.textContent = `Day ${snapshot.day} ${snapshot.timeOfDay.toFixed(2)} · speed ${simulationSpeed}× · ${snapshot.cells.length} cells · ${snapshot.population} citizens · ${snapshot.businesses.length} shops · ${snapshot.relationshipCount} relationships · ${snapshot.water.dockCount} docks · ${snapshot.water.canalCount} canals · ${snapshot.water.shelteredCount} sheltered water · craft: ${crafting.completedCount()}/${crafting.recipeCount()} chains, ${crafting.summary() || 'waiting for materials'} · memory: ${snapshot.memory.patinaCells} weathered, ${snapshot.memory.growingTrees} growing/${snapshot.memory.matureTrees} mature trees, oldest ${Math.floor(snapshot.memory.oldestBuildingHours)}h, ${snapshot.memory.raining ? `rain ${snapshot.memory.rainIntensity.toFixed(2)}` : 'dry'} · fleet: ${fleet.join(', ') || 'none'} · fauna: ${fauna.birds} birds, ${fauna.gulls} gulls (${fauna.gullModes.flying} flying/${fauna.gullModes.feeding} feeding/${fauna.gullModes.perching} perched/${fauna.gullModes.scattering} scattering), ${fauna.fish} fish, ${fauna.crabs} crabs, ${fauna.turtles} turtles, ${fauna.cats}/${fauna.catCapacity} cats (${fauna.kittens} kittens, ${fauna.migratingCats} leaving), ${fauna.butterflies} butterflies · passing: ${fauna.whale} whale, ${fauna.dolphins} dolphins, ${fauna.squids} squids, ${fauna.tuna} tuna · nav: ${nav.nodes} nodes/${nav.links} links · selected: ${selected} · ${complete}/${oneShotEvents.length} discoveries · ${repeatableEvents.length} recurring moments`;
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
  controls.innerHTML = `<button data-grow-action="nav">${navDebugVisible ? 'Hide' : 'Show'} nav</button><button data-grow-action="spawn">Spawn citizen</button><button data-grow-action="fauna">Scatter fauna</button><button data-grow-action="hour">+1 hour</button><button data-grow-action="day">+1 day</button>`;
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
  const clues = grow.clues(currentSnapshot());
  document.querySelector('#journal-count')!.textContent = String(entries.length);
  list.replaceChildren();
  const clueSection = document.createElement('section');
  clueSection.className = 'journal-clues';
  const clueHeading = document.createElement('div');
  clueHeading.className = 'clue-heading';
  clueHeading.innerHTML = '<span>Whispers on the tide</span><small>Choose one thread to follow</small>';
  clueSection.append(clueHeading);
  if (clues.length) {
    for (const clue of clues) clueSection.append(createClueCard(clue));
  } else {
    const quiet = document.createElement('p');
    quiet.className = 'clue-quiet';
    quiet.textContent = 'For now, the harbor has told all the stories it knows.';
    clueSection.append(quiet);
  }
  list.append(clueSection);
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'journal-empty';
    empty.textContent = 'The pages are waiting for the town’s first small surprise.';
    list.append(empty);
    return;
  }
  for (const entry of entries) list.append(createJournalEntry(entry));
}

function createClueCard(clue: DiscoveryClue) {
  const button = document.createElement('button');
  const percent = Math.round(clue.progress * 100);
  button.className = 'clue-card';
  button.dataset.threadId = clue.eventId;
  button.classList.toggle('active', followedThreadId === clue.eventId);
  button.setAttribute('aria-pressed', String(followedThreadId === clue.eventId));
  button.innerHTML = `<span class="clue-mark" aria-hidden="true">◇</span><span class="clue-copy"><strong>${clue.title}</strong><small>${clue.hint}</small><span class="clue-progress"><i style="width:${percent}%"></i></span></span><span class="clue-action">${followedThreadId === clue.eventId ? 'Following' : 'Follow'}</span>`;
  return button;
}

function updateThreadStatus(snapshot = currentSnapshot()) {
  const panel = document.querySelector<HTMLElement>('#tide-thread')!;
  if (!followedThreadId || grow.discoveredIds().includes(followedThreadId)) {
    followedThreadId = null;
    panel.classList.remove('show');
    return;
  }
  const clue = grow.clues(snapshot, DISCOVERY_EVENTS.length).find((candidate) => candidate.eventId === followedThreadId);
  if (!clue) {
    panel.classList.remove('show');
    return;
  }
  const percent = Math.round(clue.progress * 100);
  document.querySelector('#thread-title')!.textContent = clue.title;
  document.querySelector('#thread-hint')!.textContent = clue.hint;
  document.querySelector<HTMLElement>('#thread-progress-fill')!.style.width = `${percent}%`;
  const progress = panel.querySelector<HTMLElement>('[role="progressbar"]')!;
  progress.setAttribute('aria-valuenow', String(percent));
  panel.classList.add('show');
}

function followThread(eventId: string) {
  followedThreadId = followedThreadId === eventId ? null : eventId;
  const snapshot = currentSnapshot();
  updateThreadStatus(snapshot);
  renderJournal();
  persistSoon();
  if (!followedThreadId) return;
  const clue = grow.clues(snapshot, DISCOVERY_EVENTS.length).find((candidate) => candidate.eventId === followedThreadId);
  if (clue?.focus) controls.target.lerp(city.worldPosition(clue.focus.x, clue.focus.z).setY(1), .4);
  setJournalOpen(false);
  showToast(`Following “${clue?.title ?? 'a new thread'}”.`);
}

function revisitDiscovery(eventId: string) {
  const event = DISCOVERY_EVENTS.find((candidate) => candidate.id === eventId);
  if (!event) return;
  const snapshot = currentSnapshot();
  const focus = resolveFocus(event.focus, snapshot);
  if (focus) {
    controls.target.lerp(city.worldPosition(focus.x, focus.z).setY(1), .55);
    city.celebrateAt(focus.x, focus.z);
    citizens.gatherAt(focus.x, focus.z, `remembering ${event.title.toLowerCase()}`);
  } else {
    citizens.noticeDiscovery(`remembering ${event.title.toLowerCase()}`);
  }
  for (const effect of event.effects) {
    if (effect.kind === 'wildlife') ambience.wildlifeEffect('gather', effect.animal, focus);
  }
  setJournalOpen(false);
  showToast(`The town remembers: ${event.title}.`);
  softTone(390, .16);
  softTone(590, .23, .08);
}

const JOURNAL_SKETCHES: Record<JournalIllustration, string> = {
  foundation: `
    <path class="wash" d="M27 55 Q52 48 79 55 L77 66 Q51 70 25 64Z"/>
    <path d="M22 58 Q52 52 84 58 M29 57 L31 43 L72 41 L76 56 M31 43 Q50 38 72 41 M39 43 L38 55 M52 41 L53 54 M64 42 L65 55"/>
    <path class="faint" d="M27 61 Q52 56 79 61 M33 46 Q52 41 70 44"/>`,
  rain: `
    <path class="wash water" d="M15 55 Q49 47 92 55 L94 69 L12 69Z"/>
    <path d="M19 57 Q52 50 91 57 M31 51 L35 34 L51 30 L55 50 M55 50 L59 28 L77 32 L81 53 M17 27 L13 35 M31 19 L26 28 M49 15 L44 24 M69 17 L64 26 M88 22 L83 31"/>
    <path class="faint" d="M14 63 Q48 55 94 62 M22 34 L18 42 M42 23 L37 32 M61 18 L56 27 M80 29 L75 38"/>`,
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
  const revisit = document.createElement('button');
  revisit.className = 'journal-revisit';
  revisit.dataset.revisitId = entry.eventId;
  revisit.textContent = 'Revisit in town';
  copy.append(time, title, note, revisit);
  article.append(illustration, copy);
  return article;
}

function setJournalOpen(open: boolean) {
  const scrim = document.querySelector('#journal-scrim')!;
  if (open) {
    renderJournal();
    document.querySelector<HTMLDivElement>('#journal-list')!.scrollTop = 0;
  }
  scrim.classList.toggle('show', open);
  scrim.setAttribute('aria-hidden', String(!open));
}

function setAboutOpen(open: boolean) {
  const scrim = document.querySelector<HTMLElement>('#about-scrim')!;
  const openButton = document.querySelector<HTMLButtonElement>('#about-open')!;
  scrim.classList.toggle('show', open);
  scrim.setAttribute('aria-hidden', String(!open));
  if (open) {
    setJournalOpen(false);
    setTouchGuideOpen(false);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('#about-close')!.focus(), 50);
  } else if (scrim.contains(document.activeElement)) {
    openButton.focus();
  }
}

function setPostcardOpen(open: boolean) {
  const scrim = document.querySelector<HTMLElement>('#postcard-scrim')!;
  const openButton = document.querySelector<HTMLButtonElement>('#postcard-open')!;
  scrim.classList.toggle('show', open);
  scrim.setAttribute('aria-hidden', String(!open));
  if (open) {
    setJournalOpen(false);
    setAboutOpen(false);
    setTouchGuideOpen(false);
    document.querySelector('#postcard-date-preview')!.textContent = `${postcardDate()} · Day ${day}`;
    document.querySelector('#postcard-note')!.textContent = 'Anyone can view the picture. Little Tides can also read the town tucked inside it.';
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('#postcard-save')!.focus(), 50);
  } else if (scrim.contains(document.activeElement)) {
    openButton.focus();
  }
}

function canvasPng(inscription: string) {
  return new Promise<Blob>((resolve, reject) => {
    const hoverWasVisible = hover.visible;
    hover.visible = false;
    renderer.render(scene, camera);
    void composePostcard(renderer.domElement, { inscription, date: postcardDate(), day }).then((blob) => {
      hover.visible = hoverWasVisible;
      resolve(blob);
    }, (error) => {
      hover.visible = hoverWasVisible;
      reject(error);
    });
  });
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function savePostcard() {
  const button = document.querySelector<HTMLButtonElement>('#postcard-save')!;
  const note = document.querySelector<HTMLParagraphElement>('#postcard-note')!;
  button.disabled = true;
  button.textContent = 'Painting postcard…';
  note.textContent = 'Holding the harbor still for just a moment.';
  try {
    saveTown();
    const inscription = document.querySelector<HTMLInputElement>('#postcard-message')!.value;
    const postcard = await makeTidePostcard(await canvasPng(inscription), currentTownData());
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(postcard, `little-tides-day-${day}-${date}.png`);
    note.textContent = 'Saved. This PNG can be shared as a picture or loaded back here later.';
    showToast('Your tide postcard is ready.');
  } catch (error) {
    note.textContent = error instanceof Error ? error.message : 'The postcard could not be saved.';
  } finally {
    button.disabled = false;
    button.textContent = 'Save tide postcard';
  }
}

async function saveTownModel() {
  const button = document.querySelector<HTMLButtonElement>('#postcard-stl')!;
  const note = document.querySelector<HTMLParagraphElement>('#postcard-note')!;
  button.disabled = true;
  button.textContent = 'Building 3D model…';
  note.textContent = 'Joining the harbor onto a small print base.';
  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const model = makeTownStl(city.root);
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(model, `little-tides-day-${day}-${date}.stl`);
    note.textContent = 'STL saved in millimeters. It includes the visible town on a shared base; colors are not part of STL files.';
    showToast('Your harbor model is ready.');
  } catch (error) {
    note.textContent = error instanceof Error ? error.message : 'The 3D model could not be exported.';
  } finally {
    button.disabled = false;
    button.textContent = 'Export 3D model (.stl)';
  }
}

async function loadPostcard(file: File) {
  const note = document.querySelector<HTMLParagraphElement>('#postcard-note')!;
  note.textContent = 'Reading the tide tucked inside this picture…';
  try {
    const town = await readTidePostcard(file);
    const townDay = town.day ?? 1;
    if (!confirm(`Let the current town drift away and return to the tide from Day ${townDay}?`)) {
      note.textContent = 'Nothing changed. Your current town is still here.';
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(town));
    location.reload();
  } catch (error) {
    note.textContent = error instanceof TidePostcardError ? error.message : 'That postcard could not be opened.';
  }
}

function applyBusinessUpdate(update: BusinessUpdate, announce: boolean) {
  if (!update.changed) return;
  const current = businesses.all();
  const visibleChange = update.opened.length > 0 || update.closed.length > 0 || update.hired.length > 0;
  // Visit-count buckets add worn approach stones without rebuilding a shop on
  // every single visit.
  city.setBusinesses(current);
  if (visibleChange) {
    citizens.setBusinesses(current);
    refreshAmbience();
    renderer.shadowMap.needsUpdate = true;
    ignoreNextPerformanceSample = true;
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

function playHarborAmbience(daylight: number, rainIntensity = 0) {
  if (!audioContext || audioContext.state !== 'running') return;
  playCue('water', daylight);
  if (citizens.walkingCount() > 0) playCue('footsteps');
  if (citizens.population() > 3 && daylight > .28) playCue('chatter');
  if (grow.discoveredIds().includes('gulls-return') && daylight > .4) playCue('gulls');
  if (daylight < .32) playCue('insects');
  if (rainIntensity > .12) playCue('rain');
  if (ambience.activeFleet().some((kind) => kind === 'ferry' || kind === 'merchant boat')) playCue('horn');
  if (grow.discoveredIds().includes('lantern-finale')) {
    softTone(760, .38, .5, .01, 'sine');
    softTone(910, .42, .78, .008, 'sine');
  }
}

type SoundCue = 'water' | 'gulls' | 'footsteps' | 'door' | 'chatter' | 'bell' | 'horn' | 'insects' | 'rain' | 'celebration';

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
  if (cue === 'rain') { softTone(185, .18, 0, .004, 'triangle'); softTone(240, .12, .22, .003, 'triangle'); }
  if (cue === 'celebration') {
    playCue('bell');
    [520, 660, 790, 1040].forEach((frequency, index) => softTone(frequency, .24, .18 + index * .11, .018, 'triangle'));
  }
}

function popSound() {
  softTone(260, .11);
  softTone(430, .13, .045);
}

function updateMusicButton() {
  const button = document.querySelector<HTMLButtonElement>('#music-toggle')!;
  button.classList.toggle('muted', musicMuted);
  button.setAttribute('aria-pressed', String(!musicMuted));
  button.setAttribute('aria-label', musicMuted ? 'Turn music on' : 'Turn music off');
  button.querySelector('span')!.textContent = musicMuted ? '♩' : '♫';
}

async function startBackgroundMusic() {
  if (musicMuted || !backgroundMusic.paused) return;
  try {
    await backgroundMusic.play();
  } catch {
    // Autoplay policies vary; the next explicit music-button press will retry.
  }
}

function toggleBackgroundMusic() {
  musicMuted = !musicMuted;
  localStorage.setItem(MUSIC_MUTED_KEY, String(musicMuted));
  if (musicMuted) backgroundMusic.pause();
  else void startBackgroundMusic();
  updateMusicButton();
}

updateMusicButton();
window.addEventListener('pointerdown', () => { void startBackgroundMusic(); }, { capture: true, once: true });
window.addEventListener('keydown', () => { void startBackgroundMusic(); }, { capture: true, once: true });

function centerView() {
  controls.target.set(0, 1.3, 0);
  camera.position.set(18, 19, 20);
  controls.update();
}

document.querySelector('#music-toggle')!.addEventListener('click', toggleBackgroundMusic);
document.querySelector('#touch-center')!.addEventListener('click', () => {
  centerView();
  showToast('The harbor drifts back into view.');
});

function setTouchMode(mode: 'build' | 'remove') {
  touchMode = mode;
  hover.visible = false;
  hoveredCell = null;
  renderer.domElement.classList.remove('inspect-resident');
  renderer.domElement.classList.remove('inspect-observable');
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

const mobileHeaderQuery = matchMedia('(max-width: 700px), (hover: none) and (pointer: coarse)');

function setTopActionsOpen(open: boolean) {
  const mobileMenu = mobileHeaderQuery.matches;
  const expanded = mobileMenu && open;
  const actions = document.querySelector<HTMLElement>('.top-actions')!;
  const menu = document.querySelector<HTMLElement>('#top-actions-menu')!;
  const toggle = document.querySelector<HTMLButtonElement>('#mobile-menu-toggle')!;
  actions.classList.toggle('open', expanded);
  toggle.setAttribute('aria-expanded', String(expanded));
  toggle.setAttribute('aria-label', expanded ? 'Close town controls' : 'Open town controls');
  menu.setAttribute('aria-hidden', String(mobileMenu && !expanded));
  if (mobileMenu && !expanded) menu.setAttribute('inert', '');
  else menu.removeAttribute('inert');
}

document.querySelector('#mobile-menu-toggle')!.addEventListener('click', () => {
  setTopActionsOpen(!document.querySelector('.top-actions')!.classList.contains('open'));
});
document.querySelector('#top-actions-menu')!.addEventListener('click', (event) => {
  if ((event.target as HTMLElement).closest('button')) setTopActionsOpen(false);
});
document.addEventListener('pointerdown', (event) => {
  if (!document.querySelector('.top-actions')!.contains(event.target as Node)) setTopActionsOpen(false);
});
mobileHeaderQuery.addEventListener('change', () => setTopActionsOpen(false));
setTopActionsOpen(false);

document.querySelector('#reset')!.addEventListener('click', () => {
  if (!confirm('Let this town drift away and begin with a new tide?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

document.querySelector('#card-close')!.addEventListener('click', hideCitizenCard);
document.querySelector('#memory-card-close')!.addEventListener('click', hideMemoryCard);
document.querySelector('#observe-toggle')!.addEventListener('click', () => {
  observeMode = !observeMode;
  const button = document.querySelector<HTMLButtonElement>('#observe-toggle')!;
  button.classList.toggle('active', observeMode);
  button.setAttribute('aria-pressed', String(observeMode));
  if (!observeMode) hideMemoryCard();
  showToast(observeMode ? 'Observe mode: choose a building, tree, animal, boat, or resident.' : 'Build mode restored.');
});
document.querySelector('#thread-close')!.addEventListener('click', () => {
  followedThreadId = null;
  updateThreadStatus();
  persistSoon();
});
document.querySelector('#journal-open')!.addEventListener('click', () => setJournalOpen(true));
document.querySelector('#journal-close')!.addEventListener('click', () => setJournalOpen(false));
document.querySelector('#journal-scrim')!.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) setJournalOpen(false);
});
document.querySelector('#journal-list')!.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const thread = target.closest<HTMLButtonElement>('[data-thread-id]');
  if (thread?.dataset.threadId) followThread(thread.dataset.threadId);
  const revisit = target.closest<HTMLButtonElement>('[data-revisit-id]');
  if (revisit?.dataset.revisitId) revisitDiscovery(revisit.dataset.revisitId);
});
document.querySelector('#about-open')!.addEventListener('click', () => setAboutOpen(true));
document.querySelector('#about-close')!.addEventListener('click', () => setAboutOpen(false));
document.querySelector('#about-scrim')!.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) setAboutOpen(false);
});
document.querySelector('#postcard-open')!.addEventListener('click', () => setPostcardOpen(true));
document.querySelector('#postcard-close')!.addEventListener('click', () => setPostcardOpen(false));
document.querySelector('#postcard-save')!.addEventListener('click', () => { void savePostcard(); });
document.querySelector('#postcard-stl')!.addEventListener('click', () => { void saveTownModel(); });
document.querySelector('#postcard-message')!.addEventListener('input', (event) => {
  const message = (event.currentTarget as HTMLInputElement).value.trim();
  document.querySelector('#postcard-message-preview')!.textContent = message || 'Wish you were here by the water.';
});
document.querySelector('#postcard-load')!.addEventListener('click', () => document.querySelector<HTMLInputElement>('#postcard-file')!.click());
document.querySelector('#postcard-file')!.addEventListener('change', (event) => {
  const input = event.currentTarget as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void loadPostcard(file);
});
document.querySelector('#postcard-scrim')!.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) setPostcardOpen(false);
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
  } else if (action === 'day') {
    day += 1;
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
  if (event.key.toLowerCase() === 'i') document.querySelector<HTMLButtonElement>('#observe-toggle')!.click();
  if (event.key.toLowerCase() === 'g') {
    document.querySelector('#grow-inspector')!.classList.toggle('show');
    updateGrowInspector();
  }
  if (event.key === 'Escape') {
    cancelCameraGesture();
    setTopActionsOpen(false);
    setJournalOpen(false);
    setTouchGuideOpen(false);
    setAboutOpen(false);
  }
});

const ambience = new HarborAmbience(seed, camera, city.cells.values());
ambience.setDiscoveryState(grow.discoveredIds());
ambience.setTown(city.cells.values(), businesses.all(), citizens.residents(), city.matureTreeAnchors(day * 24 + timeOfDay));
scene.add(ambience.root);
renderJournal();
updateThreadStatus();

function refreshAmbience() {
  const catsBefore = ambience.wildlifeStats();
  ambience.setTown(city.cells.values(), businesses.all(), citizens.residents(), city.matureTreeAnchors(day * 24 + timeOfDay));
  ambience.setDiscoveryState(grow.discoveredIds());
  citizens.setDiscoveries(grow.discoveredIds());
  const catsAfter = ambience.wildlifeStats();
  if (catsAfter.migratingCats > catsBefore.migratingCats) {
    showToast(`${catsAfter.migratingCats} ${catsAfter.migratingCats === 1 ? 'cat is' : 'cats are'} finding a new harbor home.`);
  }
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
let overloadSeconds = 0;
let severeOverloadSeconds = 0;
let recoverySeconds = 0;
let ignoreNextPerformanceSample = false;
let businessCheckElapsed = 0;
let discoveryCheckElapsed = 0;
let ambientSoundElapsed = 0;
let inspectorElapsed = 0;
let nightMode = false;
let shadowsActive = true;
let lastRaining = weatherAt(seed, day * 24 + timeOfDay).raining;
const performanceCosts = { city: 0, citizens: 0, business: 0, discovery: 0, background: 0, ambience: 0, render: 0 };

function recordPerformanceCost(name: keyof typeof performanceCosts, startedAt: number) {
  const duration = performance.now() - startedAt;
  performanceCosts[name] += (duration - performanceCosts[name]) * .08;
}

function daylightAt(hour: number) {
  const solar = Math.sin((hour - 6) / 12 * Math.PI);
  return THREE.MathUtils.clamp(solar * .9 + .1, .04, 1);
}

function updateTimeDisplay() {
  const hours = Math.floor(timeOfDay);
  const minutes = Math.floor((timeOfDay - hours) * 60);
  const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  document.querySelector('#clock-display')!.textContent = `Day ${day} · ${time} · ${citizens.population()} ${citizens.population() === 1 ? 'resident' : 'residents'}`;
  document.querySelector('#mobile-clock-display')!.textContent = `D${day} · ${time}`;
  updateCitizenCard();
  const memory = selectedMemoryReader?.();
  if (memory) showMemoryCard(memory);
}

function animate() {
  requestAnimationFrame(animate);
  const rawDelta = clock.getDelta();
  if (document.hidden) return;
  const performancePanel = document.querySelector<HTMLElement>('#perf-panel')!;
  const profileFrame = performancePanel.classList.contains('show');
  let profileStartedAt = profileFrame ? performance.now() : 0;
  const delta = Math.min(rawDelta, .1);
  const time = clock.elapsedTime;
  if (ignoreNextPerformanceSample) ignoreNextPerformanceSample = false;
  else frameTimeEma += (rawDelta * 1000 - frameTimeEma) * .035;
  const performanceDelta = Math.min(rawDelta, .1);
  overloadSeconds = frameTimeEma > 22 ? overloadSeconds + performanceDelta : Math.max(0, overloadSeconds - performanceDelta * 2);
  severeOverloadSeconds = frameTimeEma > 26 ? severeOverloadSeconds + performanceDelta : Math.max(0, severeOverloadSeconds - performanceDelta * 2);
  recoverySeconds = frameTimeEma < 17.5 ? recoverySeconds + performanceDelta : 0;
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
  const weather = weatherAt(seed, absoluteHours);
  if (weather.raining !== lastRaining) {
    lastRaining = weather.raining;
    showToast(weather.raining ? 'A passing shower crosses the harbor.' : 'The shower passes, leaving the stones shining.');
    if (weather.raining) playCue('rain');
  }
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
  sceneFog.color.copy(currentSky);
  const cameraDistance = camera.position.distanceTo(controls.target);
  const distantView = THREE.MathUtils.smoothstep(cameraDistance, 34, 64);
  sceneFog.density = THREE.MathUtils.lerp(.0135, .0012, distantView);
  hemi.intensity = .42 + daylight * 1.83;
  sun.intensity = .12 + daylight * 4.58;
  const sunAngle = (timeOfDay - 6) / 24 * Math.PI * 2;
  sun.position.set(Math.cos(sunAngle) * 18, 5 + daylight * 20, Math.sin(sunAngle) * 16);
  shadowElapsed += rawDelta;
  // The town is mostly static. Coarse solar steps keep the shadows alive
  // without periodically rerendering every caster during ordinary motion.
  if (shadowsActive && shadowElapsed > 12) {
    renderer.shadowMap.needsUpdate = true;
    // The next delta includes the deliberately scheduled shadow render. Do not
    // mistake that isolated maintenance frame for sustained GPU pressure.
    ignoreNextPerformanceSample = true;
    shadowElapsed = 0;
  }
  renderer.toneMappingExposure = .72 + daylight * .36;
  waterUniforms.uTime.value = time;
  waterUniforms.uDay.value = daylight;
  waterUniforms.uRain.value = weather.intensity;
  city.setWeather(weather.intensity);
  city.update(time, absoluteHours);
  city.setDaylight(daylight);
  if (profileFrame) {
    recordPerformanceCost('city', profileStartedAt);
    profileStartedAt = performance.now();
  }
  citizens.update(delta * simulationSpeed, timeOfDay, absoluteHours, time);
  if (profileFrame) {
    recordPerformanceCost('citizens', profileStartedAt);
    profileStartedAt = performance.now();
  }
  if (businessCheckElapsed > .5) {
    const residentState = citizens.residents();
    applyBusinessUpdate(businesses.recordVisits(citizens.drainBusinessVisits(), residentState), true);
    const businessUpdate = businesses.update(residentState, city.cells, absoluteHours);
    applyBusinessUpdate(businessUpdate, true);
    const craftingUpdate = crafting.update(businesses.all(), residentState, grow.discoveredIds(), absoluteHours);
    if (craftingUpdate.delivery) citizens.beginDelivery(craftingUpdate.delivery.fromCellKey, craftingUpdate.delivery.toCellKey, craftingUpdate.delivery.good);
    if (craftingUpdate.milestone) {
      showToast(craftingUpdate.milestone);
      playCue('door');
    }
    if (craftingUpdate.changed) persistSoon();
    businessCheckElapsed = 0;
  }
  if (profileFrame) {
    recordPerformanceCost('business', profileStartedAt);
    profileStartedAt = performance.now();
  }
  if (discoveryCheckElapsed > .5) {
    evaluateDiscoveries();
    discoveryCheckElapsed = 0;
  }
  if (profileFrame) {
    recordPerformanceCost('discovery', profileStartedAt);
    profileStartedAt = performance.now();
  }
  if (ambientSoundElapsed > 11) {
    playHarborAmbience(daylight, weather.intensity);
    ambientSoundElapsed = 0;
  }
  if (inspectorElapsed > .75) {
    updateGrowInspector();
    inspectorElapsed = 0;
  }
  if (profileFrame) {
    recordPerformanceCost('background', profileStartedAt);
    profileStartedAt = performance.now();
  }
  ambience.update(time, daylight, timeOfDay, absoluteHours, catColonyFoundedAt, weather.intensity);
  if (profileFrame) {
    recordPerformanceCost('ambience', profileStartedAt);
    profileStartedAt = performance.now();
  }
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
  if (performanceWarmup > 3 && performanceCooldown > 3 && overloadSeconds > 1.5 && renderPixelRatio > 1) {
    renderPixelRatio = Math.max(1, renderPixelRatio - (frameTimeEma > 30 ? .3 : .2));
    renderer.setPixelRatio(renderPixelRatio);
    performanceCooldown = 0;
    overloadSeconds = 0;
  } else if (performanceWarmup > 8 && performanceCooldown > 4 && severeOverloadSeconds > 2 && renderPixelRatio <= 1 && shadowsActive) {
    shadowsActive = false;
    renderer.shadowMap.enabled = false;
    city.setMaterialDetail(false);
    performanceCooldown = 0;
    severeOverloadSeconds = 0;
  } else if (performanceWarmup > 12 && performanceCooldown > 4 && severeOverloadSeconds > 2 && renderPixelRatio > .75) {
    renderPixelRatio = Math.max(.75, renderPixelRatio - .1);
    renderer.setPixelRatio(renderPixelRatio);
    performanceCooldown = 0;
    severeOverloadSeconds = 0;
  } else if (performanceWarmup > 20 && performanceCooldown > 15 && recoverySeconds > 8 && renderPixelRatio < maximumPixelRatio) {
    renderPixelRatio = Math.min(maximumPixelRatio, renderPixelRatio + .1);
    renderer.setPixelRatio(renderPixelRatio);
    performanceCooldown = 0;
    recoverySeconds = 0;
  }
  controls.update();
  renderer.render(scene, camera);
  if (profileFrame) recordPerformanceCost('render', profileStartedAt);
  if (performanceUpdate > .75) {
    const info = renderer.info.render;
    const cpu = Object.values(performanceCosts).reduce((sum, duration) => sum + duration, 0);
    performancePanel.textContent = `${Math.round(1000 / frameTimeEma)} fps · ${info.calls} draws · ${Math.round(info.triangles / 1000)}k tris · ${businesses.all().length} shops · ${renderPixelRatio.toFixed(1)}×${shadowsActive ? '' : ' · lite'} · ${cpu.toFixed(1)}ms CPU (city ${performanceCosts.city.toFixed(1)} · people ${performanceCosts.citizens.toFixed(1)} · shops ${performanceCosts.business.toFixed(1)} · GROW ${performanceCosts.discovery.toFixed(1)} · ui ${performanceCosts.background.toFixed(1)} · life ${performanceCosts.ambience.toFixed(1)} · render ${performanceCosts.render.toFixed(1)})`;
    performanceUpdate = 0;
  }
}
updateTimeDisplay();
animate();

window.addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(renderPixelRatio);
});
