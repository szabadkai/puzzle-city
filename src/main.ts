import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { CityRenderer, type CityMemoryInspection } from './city';
import { CitizenSystem } from './citizens';
import { BusinessSystem, businessProsperityTier, townProsperityLevel, type BusinessUpdate } from './businesses';
import { createWorldSnapshot, DISCOVERY_EVENTS, GrowSystem, resolveFocus, type DiscoveryClue, type DiscoveryEffect, type TriggeredDiscovery } from './grow';
import { HarborAmbience, type HarborMemoryInspection } from './harbor';
import { weatherAt, type TownMemorySnapshot } from './memory';
import { CraftingSystem } from './crafting';
import { CARDINALS, keyOf, type ConfluenceId, type FormationId, type HarborLanternId, type JournalEntry, type JournalIllustration, type PlaceIdentityId, type SavedTown } from './types';
import { FLOOR_HEIGHT } from './spatial';
import { makeTidePostcard, readTidePostcard, TidePostcardError } from './tide-postcard';
import { makeTownStl } from './town-stl';
import { composePostcard, postcardDate } from './postcard-image';
import { FORMATION_SKETCHES } from './atlas-illustrations';
import {
  detectFormations,
  FORMATION_BY_ID,
  FORMATION_BATCH_BONUS,
  FORMATION_CATALOG,
  FORMATION_OPENING_ADVANCE,
  formationInfluenceDetails,
  formationInfluenceSummary,
  formationLineage,
  hasAdjacentHomes,
  type FormationOccurrence,
} from './formations';
import {
  detectPlaceIdentities,
  PLACE_IDENTITY_BY_ID,
  PLACE_IDENTITY_CATALOG,
  placeBusinessAffinity,
  placeIdentityProgress,
  placeLandmarkSocket,
  livingPlaceIntroductionReady,
  type PlaceIdentityOccurrence,
} from './place-identities';
import {
  CONFLUENCE_BY_ID,
  CONFLUENCE_CATALOG,
  confluenceLandmarkSocket,
  confluenceProgress,
  confluenceSupersedesPlace,
  detectConfluences,
  type ConfluenceOccurrence,
} from './confluences';
import { HARBOR_LANTERNS, harborLanternStates, harborLanternsCompletedByEdit } from './lanterns';
import './style.css';

const STORAGE_KEY = 'little-tides-town-v1';
const MUSIC_MUTED_KEY = 'little-tides-music-muted';

document.querySelector<HTMLDivElement>('#app')!.innerHTML = `
  <div class="hud">
    <div class="brand"><h1>Little Tides</h1></div>
    <div class="header-controls">
      <div class="time-widget" aria-label="Time and simulation speed">
        <span id="clock-display" class="desktop-clock">Day 1 · 07:30</span>
        <span id="mobile-clock-display" class="mobile-clock" aria-hidden="true">D1 · 07:30</span>
        <div class="speed-controls">
          <button data-speed="0" aria-label="Pause simulation">Ⅱ</button>
          <button data-speed="1" class="active" aria-label="Normal simulation speed">1×</button>
          <button data-speed="3" aria-label="Triple simulation speed">3×</button>
        </div>
      </div>
      <button id="journal-open" class="journal-quick" aria-label="Open observation journal"><span class="desktop-journal-label">Journal</span><span class="mobile-journal-label" aria-hidden="true">▤</span><span id="journal-count">0</span></button>
      <div class="top-actions">
        <button id="mobile-menu-toggle" class="mobile-menu-toggle" aria-label="Open town controls" aria-controls="top-actions-menu" aria-expanded="false"><span aria-hidden="true">☰</span></button>
        <div class="top-actions-menu" id="top-actions-menu">
          <button id="observe-toggle" title="Observe town history" aria-label="Observe town history" aria-pressed="false"><span class="desktop-observe-label">Observe</span><span class="mobile-observe-label" aria-hidden="true">◉</span></button>
          <button id="music-toggle" aria-label="Turn music off" aria-pressed="true"><span>Music</span><span class="music-state" aria-hidden="true">♫</span></button>
          <button id="postcard-open" aria-label="Save or load a tide postcard"><span class="desktop-postcard-label">Postcard</span><span class="mobile-postcard-label" aria-hidden="true">⇧</span></button>
          <button id="about-open" aria-label="About Little Tides"><span class="desktop-about-label">About</span><span class="mobile-about-label" aria-hidden="true">i</span></button>
          <button id="reset" aria-label="Start a new town"><span class="desktop-reset-label">New tide</span><span class="mobile-reset-label" aria-hidden="true">↻</span></button>
        </div>
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
      <span id="thread-kicker">Following a thread</span>
      <strong id="thread-title"></strong>
      <p id="thread-hint"></p>
      <div class="thread-progress" role="progressbar" aria-label="Discovery progress" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i id="thread-progress-fill"></i></div>
    </aside>
    <aside class="first-tide" id="first-tide" aria-live="polite">
      <button class="first-tide-close" id="first-tide-close" aria-label="Skip the first-tide guide">×</button>
      <span id="first-tide-progress">First tide · 1/4</span>
      <strong id="first-tide-title">Raise the first home</strong>
      <p id="first-tide-hint">Click anywhere in the nearby water.</p>
      <button class="first-tide-atlas" id="first-tide-atlas">Open Formation Atlas</button>
    </aside>
    <aside class="second-tide" id="second-tide" aria-live="polite">
      <button class="second-tide-close" id="second-tide-close" aria-label="Dismiss the living-places introduction">×</button>
      <span>Second tide</span>
      <strong>When shapes meet</strong>
      <p id="second-tide-hint">New place clues are waiting in the Atlas.</p>
      <button class="second-tide-atlas" id="second-tide-atlas">Explore living places</button>
    </aside>
    <aside class="lantern-finale-card" id="lantern-finale-card" aria-live="polite">
      <span>Five lights, one harbor</span>
      <strong>All the Lanterns</strong>
      <p>All five lanterns are lit. The town will keep living while you keep building.</p>
      <div>
        <button id="finale-continue">Keep building</button>
        <button id="finale-journal">See the lanterns</button>
        <button id="finale-postcard">Save postcard</button>
      </div>
    </aside>
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
        <h2 id="touch-guide-title">Touch controls</h2>
        <div class="gesture-list">
          <div><span class="gesture-icon" aria-hidden="true">☝</span><p><strong>Tap</strong> water to build or a resident to meet them.</p></div>
          <div><span class="gesture-icon" aria-hidden="true">↔</span><p><strong>One-finger drag</strong> turns the view.</p></div>
          <div><span class="gesture-icon" aria-hidden="true">⌁</span><p><strong>Two-finger drag</strong> moves the view. Pinch to zoom.</p></div>
          <div><span class="gesture-icon" aria-hidden="true">−</span><p><strong>Remove</strong> takes down one floor.</p></div>
          <div><span class="gesture-icon" aria-hidden="true">◉</span><p><strong>Observe</strong> shows a person or place's history.</p></div>
        </div>
        <button class="guide-done" id="touch-guide-done">Got it</button>
      </section>
    </div>
    <div class="journal-scrim" id="journal-scrim" aria-hidden="true" inert>
      <aside class="journal" role="dialog" aria-modal="true" aria-labelledby="journal-title">
        <header>
          <div><span class="journal-kicker">Town records</span><h2 id="journal-title">Harbor Journal</h2></div>
          <button id="journal-close" aria-label="Close observation journal">×</button>
        </header>
        <div class="journal-tabs" role="tablist" aria-label="Harbor records">
          <button id="journal-tab-stories" role="tab" data-journal-view="stories" aria-selected="true">Stories <span id="story-count">0</span></button>
          <button id="journal-tab-atlas" role="tab" data-journal-view="atlas" aria-selected="false">Formations <span id="formation-count">0/18</span></button>
        </div>
        <p class="journal-intro" id="journal-intro">Build freely. The journal saves what happens.</p>
        <div class="journal-list" id="journal-list" tabindex="0" aria-label="Journal entries"></div>
      </aside>
    </div>
    <div class="about-scrim" id="about-scrim" aria-hidden="true">
      <section class="about-panel" role="dialog" aria-modal="true" aria-labelledby="about-title">
        <button class="about-close" id="about-close" aria-label="Close About">×</button>
        <span class="about-kicker">A town from the sea</span>
        <h2 id="about-title">Little Tides</h2>
        <p>Build homes on the water. Residents move in, open shops, and leave stories.</p>
        <section class="about-controls" aria-labelledby="about-controls-title">
          <h3 id="about-controls-title">How to play</h3>
          <dl>
            <div><dt>Build</dt><dd>Click or tap empty water.</dd></div>
            <div><dt>Remove</dt><dd>Right-click a building, or choose Remove on touch.</dd></div>
            <div><dt>Look around</dt><dd>Drag to move. Right-drag to turn. Scroll or pinch to zoom.</dd></div>
            <div><dt>History</dt><dd>Choose Observe, then select a person or place.</dd></div>
          </dl>
        </section>
        <p class="creator-credit">Made by <a href="https://szabadkai.com" target="_blank" rel="noreferrer">Levente Szabadkai</a> · <a href="https://github.com/szabadkai/puzzle-city" target="_blank" rel="noreferrer">GitHub</a>.</p>
        <a class="feedback-link" href="https://github.com/szabadkai/puzzle-city/issues/new" target="_blank" rel="noreferrer">Send feedback on GitHub</a>
        <details class="music-credit">
          <summary>Music credits</summary>
          <p><a href="https://opengameart.org/content/caketown-cuteplayful" target="_blank" rel="noreferrer">&quot;Caketown - Cute/playful&quot;</a> by Matthew Pablo, licensed <a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noreferrer">CC BY-SA 3.0</a>.<br><a href="https://opengameart.org/content/free-contemplative-fantasy-music-pack" target="_blank" rel="noreferrer">&quot;Déjà Vus&quot;</a> by <a href="https://yannz41.itch.io" target="_blank" rel="noreferrer">YannZ</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">CC BY 4.0</a>. <a href="https://open.spotify.com/intl-it/artist/76CUcHd0t0XViSm9YBbHBw" target="_blank" rel="noreferrer">Spotify</a> · <a href="mailto:yziango@gmail.com">Contact</a>.</p>
        </details>
      </section>
    </div>
    <div class="postcard-scrim" id="postcard-scrim" aria-hidden="true">
      <section class="postcard-panel" role="dialog" aria-modal="true" aria-labelledby="postcard-title">
        <button class="postcard-close" id="postcard-close" aria-label="Close tide postcard">×</button>
        <span class="postcard-kicker">Keep this little harbor</span>
        <h2 id="postcard-title">Tide postcard</h2>
        <p>Save, share, or reload your town as a PNG. You can also export it for 3D printing.</p>
        <div class="postcard-preview" aria-hidden="true"><span class="postcard-stamp">潮</span><strong id="postcard-message-preview">Wish you were here by the water.</strong><i id="postcard-date-preview">Day 1</i></div>
        <label class="postcard-inscription" for="postcard-message">Inscription<input id="postcard-message" maxlength="60" value="Wish you were here by the water."></label>
        <button class="postcard-save" id="postcard-save">Save tide postcard</button>
        <button class="postcard-stl" id="postcard-stl">Export 3D model (.stl)</button>
        <button class="postcard-load" id="postcard-load">Load a postcard</button>
        <input id="postcard-file" type="file" accept="image/png,.png" hidden>
        <p class="postcard-note" id="postcard-note" aria-live="polite">The PNG stores your town so Little Tides can reload it.</p>
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
let lanternFinaleSequenceActive = false;
let lanternFinaleTimers: number[] = [];
const litHarborLanternIds = new Set<HarborLanternId>(
  saved?.harborLanternMode === 'confluence-mastery' ? saved.harborLanterns ?? [] : [],
);
let festivalInvitationPending = false;

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
// Allow a near-horizontal orbit for looking directly at building facades while
// keeping the camera just above the harbor plane.
controls.maxPolarAngle = Math.PI / 2 - .08;
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
const moon = new THREE.DirectionalLight(0xa9ccf2, 0);
moon.position.set(14, 18, -12);
scene.add(moon);

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

const WATER_FLAT_RADIUS = 165;
const WATER_CURVE_RADIUS = 320;
const WATER_MESH_RADIUS = 520;

function createCurvedWaterGeometry() {
  // Keep the playable harbor level, then roll the distant sea below the sightline.
  // The outer rim sits beyond the camera's far plane, so only the smooth tangent
  // of the curved surface can form the horizon.
  const geometry = new THREE.RingGeometry(0, WATER_MESH_RADIUS, 160, 72);
  const positions = geometry.getAttribute('position');
  for (let index = 0; index < positions.count; index++) {
    const radius = Math.hypot(positions.getX(index), positions.getY(index));
    const curvedDistance = Math.max(0, radius - WATER_FLAT_RADIUS);
    positions.setZ(index, -(curvedDistance * curvedDistance) / (2 * WATER_CURVE_RADIUS));
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.rotateX(-Math.PI / 2);
  geometry.computeBoundingSphere();
  return geometry;
}

const waterUniforms = {
  uTime: { value: 0 },
  uDay: { value: 1 },
  uRain: { value: 0 },
  uNoise: { value: createWaterNoiseTexture() },
  uSky: { value: new THREE.Color(0x91c7c1) },
  uHorizonCenter: { value: new THREE.Vector2() },
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
    uniform vec3 uSky;
    uniform vec2 uHorizonCenter;
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
      float horizonHaze = smoothstep(95.0, 170.0, distance(vWorld.xz, uHorizonCenter));
      color = mix(color, uSky, horizonHaze);
      gl_FragColor = vec4(color, 1.0);
    }
  `,
});
const water = new THREE.Mesh(createCurvedWaterGeometry(), waterMaterial);
water.position.y = -.31;
scene.add(water);

const city = new CityRenderer(seed);
scene.add(city.root);
if (saved) city.load(saved.cells, day * 24 + timeOfDay);
let formationOccurrences: readonly FormationOccurrence[] = detectFormations(city.cells);
const knownFormations = new Set<FormationId>(saved?.formations ?? []);
for (const id of formationLineage(formationOccurrences.map((formation) => formation.id))) knownFormations.add(id);
let placeIdentityOccurrences: readonly PlaceIdentityOccurrence[] = detectPlaceIdentities(formationOccurrences);
const knownPlaceIdentities = new Set<PlaceIdentityId>(saved?.placeIdentities ?? []);
for (const occurrence of placeIdentityOccurrences) knownPlaceIdentities.add(occurrence.id);
let confluenceOccurrences: readonly ConfluenceOccurrence[] = detectConfluences(formationOccurrences);
const knownConfluences = new Set<ConfluenceId>(saved?.confluences ?? []);
for (const occurrence of confluenceOccurrences) knownConfluences.add(occurrence.id);
city.setPlaceIdentities(placeIdentityOccurrences.filter((place) => !confluenceOccurrences.some((confluence) => confluenceSupersedesPlace(confluence, place))));
city.setConfluences(confluenceOccurrences);
let onboardingDismissed = saved?.onboardingDismissed ?? Boolean(saved?.cells.length);
let placeIntroductionSeen = saved?.placeIntroductionSeen ?? Boolean(saved?.placeIdentities?.length);
let journalView: 'stories' | 'atlas' = 'stories';
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
city.setHarborLanterns(litHarborLanternIds);
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

const onboardingMarkerGeometry = new THREE.TorusGeometry(.54, .045, 8, 40);
const onboardingMarkerMaterial = new THREE.MeshBasicMaterial({
  color: 0xffd477,
  transparent: true,
  opacity: .78,
  depthWrite: false,
  depthTest: false,
});
const onboardingMarkers = new THREE.Group();
onboardingMarkers.userData.nonPrintable = true;
scene.add(onboardingMarkers);

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
let secondTideTimer = 0;
let secondTideEligibleSince: number | null = null;
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
let followedPlaceIdentityId: PlaceIdentityId | null = saved?.followedPlaceIdentityId ?? null;
let followedConfluenceId: ConfluenceId | null = saved?.followedConfluenceId ?? null;
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
  const cityHits = ambienceMemory ? [] : raycaster.intersectObject(city.root, true);
  const lanternHit = cityHits.find((intersection) => city.memoryFromObject(intersection.object) !== null);
  const lanternMemory = lanternHit ? city.memoryFromObject(lanternHit.object) : null;
  const cityPoint = ambienceMemory || lanternMemory ? null : (
    cityHits.map((intersection) => city.cellFromObject(intersection.object))
      .find((point) => point !== null) ?? hoveredCell
  );
  const memory = ambienceMemory ?? lanternMemory ?? (cityPoint ? cityObservationAt(cityPoint.x, cityPoint.z, absoluteHours) : null);
  if (!memory) {
    hideMemoryCard();
    showToast('Nothing here is ready to be observed yet.');
    return false;
  }
  selectedMemoryReader = ambienceMemory && ambienceHit
    ? () => ambience.memoryFromObject(ambienceHit.object, day * 24 + timeOfDay, catColonyFoundedAt, ambienceHit.instanceId)
    : lanternHit ? () => city.memoryFromObject(lanternHit.object)
    : cityPoint ? () => cityObservationAt(cityPoint.x, cityPoint.z, day * 24 + timeOfDay) : null;
  showMemoryCard(memory);
  return true;
}

function cityObservationAt(x: number, z: number, absoluteHours: number) {
  const memory = city.memoryAt(x, z, absoluteHours);
  if (!memory || memory.kind !== 'building') return memory;
  const business = businesses.all().find((candidate) => candidate.cellKey === `${x},${z}`);
  const status = business ? crafting.businessStatus(business.type, business.cellKey, formationOccurrences) : null;
  return status ? { ...memory, detail: status, note: `${memory.detail} ${memory.note}` } : memory;
}

function showMemoryCard(memory: CityMemoryInspection | HarborMemoryInspection) {
  document.querySelector('#memory-kicker')!.textContent = memory.kind === 'cat' ? 'Harbor family' : memory.kind === 'wildlife' ? 'Harbor wildlife' : memory.kind === 'boat' ? 'Harbor vessel' : memory.kind === 'harbor-feature' ? 'Harbor trade' : memory.kind === 'tree' ? 'Living landmark' : memory.kind === 'landmark' ? 'Place landmark' : 'Town memory';
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
  refreshFormations(true);
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
  evaluateDiscoveries();
}

function demolish(x: number, z: number) {
  if (!city.remove(x, z, day * 24 + timeOfDay)) return;
  hideMemoryCard();
  citizens.rebuild(city.cells);
  refreshFormations(true);
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
    version: 10,
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
    followedPlaceIdentityId: followedPlaceIdentityId ?? undefined,
    followedConfluenceId: followedConfluenceId ?? undefined,
    catColonyFoundedAt,
    crafting: crafting.serialize(),
    formations: [...knownFormations],
    placeIdentities: [...knownPlaceIdentities],
    confluences: [...knownConfluences],
    harborLanterns: [...litHarborLanternIds],
    harborLanternMode: 'confluence-mastery',
    onboardingDismissed,
    placeIntroductionSeen,
  };
}

function saveTown() {
  const data = currentTownData();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function loadTown(): SavedTown | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as SavedTown | null;
    return parsed?.version === 10 ? parsed : null;
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

function refreshFormations(announce: boolean) {
  const previousPlaces = placeIdentityOccurrences;
  const previousConfluences = confluenceOccurrences;
  formationOccurrences = detectFormations(city.cells);
  placeIdentityOccurrences = detectPlaceIdentities(formationOccurrences);
  confluenceOccurrences = detectConfluences(formationOccurrences);
  const settledPlaces = placeIdentityOccurrences.filter((occurrence) => !previousPlaces.some((previous) =>
    previous.id === occurrence.id && Math.abs(previous.x - occurrence.x) + Math.abs(previous.z - occurrence.z) <= 2));
  const settledConfluences = confluenceOccurrences.filter((occurrence) => !previousConfluences.some((previous) =>
    previous.id === occurrence.id && Math.abs(previous.x - occurrence.x) + Math.abs(previous.z - occurrence.z) <= 2));
  city.setPlaceIdentities(placeIdentityOccurrences.filter((place) =>
    !confluenceOccurrences.some((confluence) => confluenceSupersedesPlace(confluence, place))), announce && !settledConfluences.length);
  city.setConfluences(confluenceOccurrences, announce);
  const expanded = formationLineage(formationOccurrences.map((formation) => formation.id));
  const revealed = [...expanded].filter((id) => !knownFormations.has(id));
  for (const id of expanded) knownFormations.add(id);
  const revealedPlaces = placeIdentityOccurrences.filter((occurrence) => !knownPlaceIdentities.has(occurrence.id));
  for (const occurrence of placeIdentityOccurrences) knownPlaceIdentities.add(occurrence.id);
  const revealedConfluences = confluenceOccurrences.filter((occurrence) => !knownConfluences.has(occurrence.id));
  for (const occurrence of confluenceOccurrences) knownConfluences.add(occurrence.id);
  const completedLanterns = announce ? harborLanternsCompletedByEdit(
    previousConfluences.map((occurrence) => occurrence.id),
    confluenceOccurrences.map((occurrence) => occurrence.id),
    litHarborLanternIds,
  ) : [];
  for (const lantern of completedLanterns) litHarborLanternIds.add(lantern.id);
  if (completedLanterns.length) city.setHarborLanterns(litHarborLanternIds);
  if (announce && settledConfluences.length) {
    const occurrence = settledConfluences.at(-1)!;
    const definition = CONFLUENCE_BY_ID.get(occurrence.id);
    const landmark = confluenceLandmarkSocket(occurrence);
    const firstDiscovery = revealedConfluences.some((revealed) => revealed.id === occurrence.id);
    const lanternNotice = completedLanterns.length === 1
      ? ` ${completedLanterns[0].title} lit.`
      : completedLanterns.length > 1
        ? ` ${completedLanterns.map((lantern) => lantern.title).join(' and ')} lit together.`
        : '';
    if (definition) showToast(firstDiscovery
      ? `${definition.title} formed here. Three formations raised its ${definition.landmark.title.toLowerCase()}.${lanternNotice}`
      : `${definition.landmark.title} has returned.${lanternNotice}`);
    controls.target.lerp(city.worldPosition(landmark.x, landmark.z).setY(1), .22);
    city.celebrateAt(landmark.x, landmark.z);
    citizens.gatherAt(landmark.x, landmark.z, `welcoming the new ${landmark.title.toLowerCase()}`);
    softTone(360, .16);
    window.setTimeout(() => softTone(540, .2), 80);
    window.setTimeout(() => softTone(760, .22), 160);
    if (settledConfluences.some((confluence) => confluence.id === followedConfluenceId)) followedConfluenceId = null;
  } else if (announce && settledPlaces.length) {
    const occurrence = settledPlaces.at(-1)!;
    const identity = PLACE_IDENTITY_BY_ID.get(occurrence.id);
    const landmark = placeLandmarkSocket(occurrence);
    const firstDiscovery = revealedPlaces.some((revealed) => revealed.id === occurrence.id);
    if (firstDiscovery) placeIntroductionSeen = true;
    if (identity) showToast(firstDiscovery
      ? `${identity.title} formed here. Its ${identity.landmark.title.toLowerCase()} marks the spot.`
      : `${identity.landmark.title} has returned.`);
    controls.target.lerp(city.worldPosition(landmark.x, landmark.z).setY(1), .22);
    city.celebrateAt(landmark.x, landmark.z);
    citizens.gatherAt(landmark.x, landmark.z, `welcoming the new ${landmark.title.toLowerCase()}`);
    softTone(430, .16);
    window.setTimeout(() => softTone(650, .2), 90);
    if (settledPlaces.some((place) => place.id === followedPlaceIdentityId)) followedPlaceIdentityId = null;
  } else if (announce && revealed.length) {
    const formation = FORMATION_BY_ID.get(revealed.at(-1)!);
    if (formation) showToast(`New formation: ${formation.title}. Recorded in the Atlas.`);
  }
  updateFirstTideGuide();
  updateSecondTideIntroduction();
  updateThreadStatus();
  if (document.querySelector('#journal-scrim')?.classList.contains('show')) renderJournal();
}

function onboardingStep() {
  if (!city.cells.size) return 0;
  if (!knownFormations.has('narrow-canal')) return 1;
  if (!knownFormations.has('sea-arch')) return 2;
  if (!hasAdjacentHomes(city.cells)) return 3;
  return 4;
}

function crossingBanks(occurrence: FormationOccurrence) {
  for (const [[ax, az], [bx, bz]] of [
    [[-1, 0], [1, 0]],
    [[0, -1], [0, 1]],
  ] as const) {
    const first = city.get(occurrence.x + ax, occurrence.z + az);
    const second = city.get(occurrence.x + bx, occurrence.z + bz);
    if (first && second) return [first, second] as const;
  }
  return [];
}

function updateOnboardingMarkers(step: number) {
  onboardingMarkers.clear();
  onboardingMarkers.visible = !onboardingDismissed && step < 4;
  if (!onboardingMarkers.visible) return;

  const targets: { x: number; z: number; height?: number }[] = [];
  if (step === 0) {
    targets.push({ x: 0, z: 0 });
  } else if (step === 1) {
    for (const home of city.cells.values()) {
      for (const [dx, dz] of CARDINALS) {
        const x = home.x + dx * 2;
        const z = home.z + dz * 2;
        if (!city.get(home.x + dx, home.z + dz) && !city.get(x, z) && city.isBuildable(x, z)) targets.push({ x, z });
      }
    }
  } else if (step === 2) {
    const canal = formationOccurrences.find((formation) => formation.id === 'narrow-canal');
    if (canal) {
      for (const bank of crossingBanks(canal)) {
        if (bank.height < 2) targets.push({ x: bank.x, z: bank.z, height: bank.height });
      }
    }
  } else if (step === 3) {
    const crossing = formationOccurrences.find((formation) => ['sea-arch', 'high-bridge', 'covered-skybridge', 'lantern-gate'].includes(formation.id));
    if (crossing) {
      const candidates = new Map<string, { x: number; z: number }>();
      for (const bank of crossingBanks(crossing)) {
        for (const [dx, dz] of CARDINALS) {
          const x = bank.x + dx;
          const z = bank.z + dz;
          if ((x !== crossing.x || z !== crossing.z) && !city.get(x, z) && city.isBuildable(x, z)) candidates.set(keyOf(x, z), { x, z });
        }
      }
      targets.push(...[...candidates.values()]
        .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z) || a.z - b.z || a.x - b.x)
        .slice(0, 3));
    }
  }

  const size = CityRenderer.cellSize();
  for (const target of targets) {
    const marker = new THREE.Mesh(onboardingMarkerGeometry, onboardingMarkerMaterial);
    marker.rotation.x = Math.PI / 2;
    marker.position.set(target.x * size, target.height === undefined ? -.22 : .5 + target.height * FLOOR_HEIGHT, target.z * size);
    marker.renderOrder = 4;
    marker.userData.nonPrintable = true;
    onboardingMarkers.add(marker);
  }
}

function updateFirstTideGuide() {
  const panel = document.querySelector<HTMLElement>('#first-tide')!;
  if (onboardingDismissed) {
    panel.classList.remove('show');
    onboardingMarkers.visible = false;
    return;
  }
  const step = onboardingStep();
  const copy = [
    ['Raise the first home', 'Build on a gold ripple or anywhere nearby.'],
    ['Leave room for water', 'Build on one of the four ripples. Keep one water tile between homes.'],
    ['Lift both banks', 'Add one floor to both marked roofs to form a sea arch.'],
    ['Let buildings meet', 'Build on a nearby ripple. The shared wall reshapes both homes.'],
    ['The harbor has begun', 'Your journal saves new shapes, people, and stories.'],
  ] as const;
  document.querySelector('#first-tide-progress')!.textContent = step === 4 ? 'First tide complete' : `First tide · ${step + 1}/4`;
  document.querySelector('#first-tide-title')!.textContent = copy[step][0];
  document.querySelector('#first-tide-hint')!.textContent = copy[step][1];
  document.querySelector('#first-tide-atlas')!.textContent = step === 4 ? 'Open Harbor Journal' : 'Open Formation Atlas';
  panel.classList.toggle('complete', step === 4);
  panel.classList.add('show');
  updateOnboardingMarkers(step);
}

function dismissFirstTide() {
  onboardingDismissed = true;
  document.querySelector('#first-tide')!.classList.remove('show');
  onboardingMarkers.visible = false;
  updateSecondTideIntroduction();
  persistSoon();
}

function updateSecondTideIntroduction() {
  const panel = document.querySelector<HTMLElement>('#second-tide')!;
  const journalOpen = document.querySelector('#journal-scrim')?.classList.contains('show');
  const residents = citizens.residents().filter((resident) => resident.residentKind !== 'visitor').length;
  const eligible = onboardingDismissed
    && livingPlaceIntroductionReady(knownFormations, formationOccurrences, residents)
    && !placeIntroductionSeen
    && !followedPlaceIdentityId
    && !followedConfluenceId;
  if (!eligible) {
    secondTideEligibleSince = null;
    window.clearTimeout(secondTideTimer);
    panel.classList.remove('show');
    return;
  }
  if (secondTideEligibleSince === null) {
    secondTideEligibleSince = performance.now();
    window.clearTimeout(secondTideTimer);
    secondTideTimer = window.setTimeout(updateSecondTideIntroduction, 4200);
  }
  const surfaced = PLACE_IDENTITY_CATALOG.filter((identity) =>
    knownPlaceIdentities.has(identity.id) || placeIdentityProgress(identity.id, formationOccurrences).state !== 'missing').length;
  document.querySelector('#second-tide-hint')!.textContent = surfaced === 1
    ? 'One new place clue is waiting in the Atlas.'
    : `${surfaced} new place clues are waiting in the Atlas.`;
  const delayPassed = performance.now() - secondTideEligibleSince >= 4000;
  panel.classList.toggle('show', delayPassed && !journalOpen);
}

function dismissSecondTide() {
  placeIntroductionSeen = true;
  secondTideEligibleSince = null;
  window.clearTimeout(secondTideTimer);
  document.querySelector('#second-tide')!.classList.remove('show');
  persistSoon();
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
  const placeVisitorCounts = citizens.identityUseCounts();
  const confluenceVisitorCounts = citizens.confluenceUseCounts();
  for (const confluence of confluenceOccurrences) {
    const visitors = confluenceVisitorCounts.get(confluence.id) ?? 0;
    if (!visitors) continue;
    for (const place of placeIdentityOccurrences) {
      if (!confluenceSupersedesPlace(confluence, place)) continue;
      placeVisitorCounts.set(place.id, (placeVisitorCounts.get(place.id) ?? 0) + visitors);
    }
  }
  return createWorldSnapshot({
    cells: city.cells.values(),
    citizens: citizens.residents(),
    businesses: businesses.serialize(),
    seed,
    day,
    timeOfDay,
    priorDiscoveries: grow.discoveredIds(),
    memory,
    placeIdentities: placeIdentityOccurrences,
    placeVisitorCounts,
    confluences: confluenceOccurrences,
    confluenceVisitorCounts,
    litLanternCount: litHarborLanternIds.size,
    festivalInvited: festivalInvitationPending,
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
      if (discovery.event.id === 'lantern-finale') city.setLanternFinaleRevealed(false);
      city.setDiscoveryState(grow.discoveredIds());
      citizens.setDiscoveries(grow.discoveredIds());
      if (discovery.event.id === 'lantern-finale') startLanternFinaleSequence(discovery);
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
    else if (focus && discovery.event.id !== 'lantern-finale') citizens.gatherAt(focus.x, focus.z, effect.activity);
    return;
  }
  if (effect.kind === 'wildlife') {
    if (effect.animal === 'cats' && catColonyFoundedAt === undefined) catColonyFoundedAt = day * 24 + timeOfDay;
    ambience.wildlifeEffect(effect.action, effect.animal, focus);
    return;
  }
  if (effect.kind === 'ambience') {
    refreshAmbience();
    if (effect.action === 'celebrate' && discovery.event.id !== 'lantern-finale') playCue('celebration');
    return;
  }
  if (discovery.event.id === 'lantern-finale') return;
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

function startLanternFinaleSequence(discovery: TriggeredDiscovery) {
  for (const timer of lanternFinaleTimers) window.clearTimeout(timer);
  lanternFinaleTimers = [];
  lanternFinaleSequenceActive = true;
  ambience.startLanternFinale();
  document.querySelector('#lantern-finale-card')!.classList.remove('show');
  const lanterns = city.harborLanternGatherPoints();
  const festival = confluenceOccurrences.find((candidate) => candidate.id === 'festival-crown');
  const destination = festival ? confluenceLandmarkSocket(festival) : resolveFocus(discovery.event.focus, discovery.snapshot);
  const lanternNames = ['Blossom', 'Table', 'Chorus', 'Clock', 'Welcome'];

  lanterns.forEach((lantern, index) => {
    lanternFinaleTimers.push(window.setTimeout(() => {
      city.celebrateAt(lantern.x, lantern.z);
      citizens.gatherAt(lantern.x, lantern.z, 'carrying a harbor lantern toward the square');
      controls.target.lerp(city.worldPosition(lantern.x, lantern.z).setY(1), .12);
      showToast(`${lanternNames[index] ?? 'A harbor'} Lantern answers.`);
      softTone(480 + index * 82, .34, 0, .025, 'sine');
    }, 500 + index * 850));
  });

  lanternFinaleTimers.push(window.setTimeout(() => {
    ambience.setLanternFinaleStage('gathering');
    if (destination) {
      citizens.gatherAt(destination.x, destination.z, 'gathering for all the lanterns');
      controls.target.lerp(city.worldPosition(destination.x, destination.z).setY(1), .2);
    }
    showToast('The five lights meet at the Festival Pavilion.');
    playCue('bell');
  }, 5100));

  lanternFinaleTimers.push(window.setTimeout(() => {
    city.setLanternFinaleRevealed(true);
    showToast('Every window answers.');
    playCue('celebration');
  }, 7900));

  lanternFinaleTimers.push(window.setTimeout(() => {
    ambience.setLanternFinaleStage('water');
    showToast('The harbor carries the light out to sea.');
  }, 10300));

  lanternFinaleTimers.push(window.setTimeout(() => {
    ambience.setLanternFinaleStage('fireworks');
    document.querySelector('#lantern-finale-card')!.classList.add('show');
    playCue('celebration');
  }, 13200));

  lanternFinaleTimers.push(window.setTimeout(() => {
    ambience.setLanternFinaleStage('complete');
    lanternFinaleSequenceActive = false;
    lanternFinaleTimers = [];
  }, 18100));
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
  const prosperityLabel = ['quiet', 'comfortable', 'flourishing'][townProsperityLevel(snapshot.businesses)];
  summary.textContent = `Day ${snapshot.day} ${snapshot.timeOfDay.toFixed(2)} · speed ${simulationSpeed}× · ${snapshot.cells.length} cells · ${snapshot.population} citizens · ${snapshot.businesses.length} shops · prosperity ${prosperityLabel} · ${snapshot.relationshipCount} relationships · ${snapshot.water.dockCount} docks · ${snapshot.water.canalCount} canals · ${snapshot.water.shelteredCount} sheltered water · craft: ${crafting.completedCount()}/${crafting.recipeCount()} chains, ${crafting.summary() || 'waiting for materials'} · memory: ${snapshot.memory.growingTrees} growing/${snapshot.memory.matureTrees} mature trees, oldest ${Math.floor(snapshot.memory.oldestBuildingHours)}h, ${snapshot.memory.raining ? `rain ${snapshot.memory.rainIntensity.toFixed(2)}` : 'dry'} · fleet: ${fleet.join(', ') || 'none'} · fauna: ${fauna.birds} birds, ${fauna.gulls} gulls (${fauna.gullModes.flying} flying/${fauna.gullModes.feeding} feeding/${fauna.gullModes.perching} perched/${fauna.gullModes.scattering} scattering), ${fauna.fish} fish, ${fauna.crabs} crabs, ${fauna.turtles} turtles, ${fauna.cats}/${fauna.catCapacity} cats (${fauna.kittens} kittens, ${fauna.migratingCats} leaving), ${fauna.butterflies} butterflies · passing: ${fauna.whale} whale, ${fauna.dolphins} dolphins, ${fauna.squids} squids, ${fauna.tuna} tuna · nav: ${nav.nodes} nodes/${nav.links} links · selected: ${selected} · ${complete}/${oneShotEvents.length} discoveries · ${repeatableEvents.length} recurring moments`;
  const eligibleTitle = document.createElement('span');
  eligibleTitle.textContent = 'Eligible next';
  const eligibleList = document.createElement('p');
  eligibleList.textContent = eligible.length ? eligible.map((event) => event.id).join('\n') : 'none';
  const citizensTitle = document.createElement('span');
  citizensTitle.textContent = 'Citizens';
  const citizenList = document.createElement('p');
  citizenList.textContent = snapshot.citizens.map((citizen) => {
    const card = citizens.card(citizen.id);
    return `${citizen.name} · ${citizen.ageGroup ?? 'adult'} · ${citizen.occupation}${citizen.residentKind === 'visitor' ? ' · visitor' : ''}${card ? ` · ${card.activity} → ${card.destination}` : ''}`;
  }).join('\n') || 'none';
  const businessesTitle = document.createElement('span');
  businessesTitle.textContent = 'Businesses';
  const businessList = document.createElement('p');
  businessList.textContent = snapshot.businesses.map((business) => {
    const prosperity = ['quiet', 'comfortable', 'flourishing'][businessProsperityTier(business)];
    return `${business.name} · ${business.visitCount ?? 0} visits · ${(business.employeeIds ?? []).length} helpers · ${prosperity}`;
  }).join('\n') || 'none';
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
  const snapshot = currentSnapshot();
  document.querySelector('#journal-count')!.textContent = String(entries.length);
  document.querySelector('#story-count')!.textContent = String(entries.length);
  document.querySelector('#formation-count')!.textContent = `${knownFormations.size}/${FORMATION_CATALOG.length}`;
  document.querySelector('#journal-title')!.textContent = journalView === 'stories' ? 'Harbor Journal' : 'Formation Atlas';
  document.querySelector('.journal-kicker')!.textContent = journalView === 'stories' ? 'Town records' : 'Known town shapes';
  const confluencesUnlocked = knownPlaceIdentities.size >= 4 || knownConfluences.size > 0;
  document.querySelector('#journal-intro')!.textContent = journalView === 'stories'
    ? confluencesUnlocked
      ? 'Master confluences to light all five lanterns.'
      : 'Build freely. The journal saves what happens.'
    : 'Water, open space, and roof height shape each form.';
  document.querySelectorAll<HTMLButtonElement>('[data-journal-view]').forEach((button) => {
    const selected = button.dataset.journalView === journalView;
    button.classList.toggle('active', selected);
    button.setAttribute('aria-selected', String(selected));
  });
  list.replaceChildren();
  if (journalView === 'atlas') {
    renderFormationAtlas(list);
    return;
  }
  if (confluencesUnlocked) renderLanternMap(list);
  const clues = grow.clues(snapshot);
  const clueSection = document.createElement('section');
  clueSection.className = 'journal-clues';
  const clueHeading = document.createElement('div');
  clueHeading.className = 'clue-heading';
  clueHeading.innerHTML = '<span>Clues</span><small>Follow one</small>';
  clueSection.append(clueHeading);
  if (clues.length) {
    for (const clue of clues) clueSection.append(createClueCard(clue));
  } else {
    const quiet = document.createElement('p');
    quiet.className = 'clue-quiet';
    quiet.textContent = 'No new clues yet.';
    clueSection.append(quiet);
  }
  list.append(clueSection);
  if (!entries.length) {
    const empty = document.createElement('p');
    empty.className = 'journal-empty';
    empty.textContent = 'Your first town event will appear here.';
    list.append(empty);
    return;
  }
  for (const entry of entries) list.append(createJournalEntry(entry));
}

function renderLanternMap(list: HTMLDivElement) {
  const activeConfluenceIds = new Set(confluenceOccurrences.map((confluence) => confluence.id));
  const lanterns = harborLanternStates({
    knownConfluences,
    activeConfluences: activeConfluenceIds,
    litLanterns: litHarborLanternIds,
  });
  const lit = lanterns.filter((lantern) => lantern.state === 'lit').length;
  const section = document.createElement('section');
  section.className = 'lantern-map';
  const heading = document.createElement('div');
  heading.className = 'lantern-map-heading';
  const headingCopy = document.createElement('span');
  headingCopy.innerHTML = `<strong>Harbor Lanterns</strong><small>${lit}/${lanterns.length} lit</small>`;
  const constellation = document.createElement('span');
  constellation.className = 'lantern-constellation';
  constellation.setAttribute('aria-hidden', 'true');
  for (const lantern of lanterns) {
    const light = document.createElement('i');
    light.className = lantern.state;
    constellation.append(light);
  }
  heading.append(headingCopy, constellation);
  section.append(heading);

  const grid = document.createElement('div');
  grid.className = 'lantern-grid';
  for (const lantern of lanterns) {
    const missingConfluences = lantern.confluenceIds.filter((id) => !activeConfluenceIds.has(id));
    const following = Boolean(followedConfluenceId && lantern.confluenceIds.includes(followedConfluenceId));
    const card = document.createElement('button');
    card.className = `lantern-card ${lantern.state} ${following ? 'following' : ''}`;
    if (lantern.state === 'lit') card.dataset.revisitLanternId = lantern.id;
    else if (lantern.state === 'ready') card.dataset.claimLanternId = lantern.id;
    else if (missingConfluences.length) card.dataset.followConfluenceId = missingConfluences[0];
    card.setAttribute('aria-pressed', String(following));
    const mark = document.createElement('span');
    mark.className = 'lantern-mark';
    mark.textContent = lantern.mark;
    const copy = document.createElement('span');
    copy.className = 'lantern-copy';
    const title = document.createElement('strong');
    title.textContent = lantern.title;
    const hint = document.createElement('small');
    if (lantern.state === 'lit') hint.textContent = 'Lit · revisit in town';
    else if (lantern.state === 'ready') hint.textContent = 'Achievement complete · claim lantern';
    else if (missingConfluences.length) {
      const missingNames = missingConfluences.map((id) => CONFLUENCE_BY_ID.get(id)?.title ?? id).join(' and ');
      const verb = missingConfluences.every((id) => knownConfluences.has(id)) ? 'Bring back' : 'Shape';
      hint.textContent = `${verb} ${missingNames}.`;
    } else hint.textContent = lantern.achievement;
    card.setAttribute('aria-label', `${lantern.title}. ${hint.textContent}`);
    copy.append(title, hint);
    card.append(mark, copy);
    grid.append(card);
  }
  section.append(grid);

  const crown = confluenceOccurrences.find((confluence) => confluence.id === 'festival-crown');
  const readyToBegin = Boolean(crown) && lit === lanterns.length;
  const destination = document.createElement('button');
  destination.className = `lantern-destination ${readyToBegin ? 'ready' : ''}`;
  if (readyToBegin) destination.dataset.beginLanternFinale = 'true';
  else if (crown) destination.dataset.confluenceId = crown.id;
  else destination.dataset.followConfluenceId = 'festival-crown';
  const destinationTitle = crown ? 'Festival Pavilion' : 'Festival Crown';
  const destinationHint = !crown
    ? 'Shape a lantern stair, harbor plaza, and rooftop pavilion close together.'
    : lit < lanterns.length
      ? `The pavilion waits for ${lanterns.length - lit} more ${lanterns.length - lit === 1 ? 'light' : 'lights'}.`
      : 'Begin the gathering when you are ready.';
  const destinationAction = readyToBegin ? 'Begin' : crown ? 'Visit' : 'Follow';
  destination.innerHTML = `<span aria-hidden="true">${crown ? '✦' : '◇'}</span><span><strong>${destinationTitle}</strong><small>${destinationHint}</small></span><em>${destinationAction}</em>`;
  destination.setAttribute('aria-label', `${destinationTitle}. ${destinationHint} ${destinationAction}.`);
  section.append(destination);
  list.append(section);
}

function renderFormationAtlas(list: HTMLDivElement) {
  const activeCounts = new Map<FormationId, number>();
  for (const occurrence of formationOccurrences) activeCounts.set(occurrence.id, (activeCounts.get(occurrence.id) ?? 0) + 1);
  const formationUseCounts = citizens.formationUseCounts();

  const summary = document.createElement('div');
  summary.className = 'atlas-summary';
  const confluencesUnlocked = knownPlaceIdentities.size >= 4 || knownConfluences.size > 0;
  summary.innerHTML = `<strong>${knownFormations.size}/${FORMATION_CATALOG.length}</strong><span>forms · ${knownPlaceIdentities.size}/${PLACE_IDENTITY_CATALOG.length} places${confluencesUnlocked ? ` · ${knownConfluences.size}/${CONFLUENCE_CATALOG.length} confluences` : ''}</span>`;
  list.append(summary);

  const formationHeading = document.createElement('div');
  formationHeading.className = 'atlas-section-heading';
  formationHeading.innerHTML = '<strong>Building forms</strong><span>Nearby buildings shape one another.</span>';
  const grid = document.createElement('div');
  grid.className = 'atlas-grid';
  for (const formation of FORMATION_CATALOG) {
    const learned = knownFormations.has(formation.id);
    const active = activeCounts.get(formation.id) ?? 0;
    const gathering = formationUseCounts.get(formation.id) ?? 0;
    const effectSummary = learned ? formationInfluenceSummary(formation) : '';
    const card = document.createElement('button');
    card.className = `atlas-card ${learned ? 'learned' : 'unknown'} ${active ? 'active-place' : ''}`;
    card.disabled = !active;
    if (active) card.dataset.formationId = formation.id;
    card.setAttribute('aria-label', learned
      ? `${formation.title}. ${formation.description} ${effectSummary} ${active ? `${active} currently in town${gathering ? ` with ${gathering} visiting` : ''}; focus formation.` : 'Not currently in town.'}`
      : `Undiscovered formation. ${formation.hint}`);
    const illustration = document.createElement('span');
    illustration.className = 'atlas-illustration';
    illustration.setAttribute('aria-hidden', 'true');
    illustration.append(createFormationSketch(formation.id));
    const mark = document.createElement('span');
    mark.className = 'atlas-mark';
    mark.textContent = learned ? formation.mark : '?';
    const copy = document.createElement('span');
    copy.className = 'atlas-copy';
    const family = document.createElement('small');
    family.textContent = `${formation.family} · ${formation.tier > 1 ? `form ${formation.tier}` : 'first form'}`;
    const title = document.createElement('strong');
    title.textContent = learned ? formation.title : 'Uncharted form';
    const description = document.createElement('span');
    description.textContent = learned ? formation.description : formation.hint;
    const influence = document.createElement('span');
    influence.className = 'atlas-influence';
    if (learned) {
      const effect = formationInfluenceDetails(formation);
      const socialLine = document.createElement('span');
      socialLine.textContent = effect.socialEffect;

      const tradeLine = document.createElement('span');
      const openingBenefit = document.createElement('strong');
      openingBenefit.textContent = `${FORMATION_OPENING_ADVANCE} residents earlier`;
      const batchBenefit = document.createElement('strong');
      batchBenefit.textContent = `+${FORMATION_BATCH_BONUS} item per batch`;
      tradeLine.append(
        `Nearby ${effect.businesses} can open `,
        openingBenefit,
        ' and produce ',
        batchBenefit,
        '.',
      );
      influence.append(socialLine, tradeLine);
    }
    const status = document.createElement('em');
    status.textContent = active
      ? `${active} in town${gathering ? ` · ${gathering} visiting` : ''} · View`
      : learned ? 'Known' : 'Not found';
    copy.append(family, title, description);
    if (learned) copy.append(influence);
    copy.append(status);
    card.append(illustration, mark, copy);
    grid.append(card);
  }
  list.append(formationHeading, grid);
  renderPlaceIdentityAtlas(list);
  if (confluencesUnlocked) renderConfluenceAtlas(list);
}

function renderPlaceIdentityAtlas(list: HTMLDivElement) {
  const activeCounts = new Map<PlaceIdentityId, number>();
  for (const occurrence of placeIdentityOccurrences) activeCounts.set(occurrence.id, (activeCounts.get(occurrence.id) ?? 0) + 1);
  const useCounts = citizens.identityUseCounts();
  const heading = document.createElement('div');
  heading.className = 'atlas-section-heading identity-heading';
  heading.innerHTML = '<strong>Living places</strong><span>Combine forms to create places and attract shops.</span>';
  const grid = document.createElement('div');
  grid.className = 'identity-grid';
  for (const identity of PLACE_IDENTITY_CATALOG) {
    const learned = knownPlaceIdentities.has(identity.id);
    const active = activeCounts.get(identity.id) ?? 0;
    const gathering = useCounts.get(identity.id) ?? 0;
    const identityOccurrences = placeIdentityOccurrences.filter((occurrence) => occurrence.id === identity.id);
    const influencedHomes = [...city.cells.values()].filter((cell) => identityOccurrences.some((occurrence) => {
      const socket = placeLandmarkSocket(occurrence);
      return Math.abs(cell.x - socket.x) + Math.abs(cell.z - socket.z) <= identity.influenceRadius;
    })).length;
    const legacyTrades = businesses.all().filter((business) => business.placeIdentityId === identity.id).length;
    const progress = placeIdentityProgress(identity.id, formationOccurrences);
    const following = followedPlaceIdentityId === identity.id;
    const surfaced = learned || progress.state !== 'missing';
    const canFollow = !active && (learned || progress.state === 'one-form' || progress.state === 'distant');
    const card = document.createElement('button');
    card.className = `identity-card ${learned ? 'learned' : surfaced ? 'surfaced' : 'unknown'} ${active ? 'active-place' : ''} ${following ? 'following' : ''}`;
    if (active) card.dataset.placeIdentityId = identity.id;
    else if (canFollow) card.dataset.followPlaceId = identity.id;
    card.disabled = !active && !canFollow;
    card.setAttribute('aria-pressed', String(following));
    const visibleTitle = learned || surfaced ? identity.title : identity.mysteryTitle;
    const visibleDescription = following
      ? progress.hint
      : learned ? identity.description
      : surfaced ? progress.hint
      : identity.rumor;
    card.setAttribute('aria-label', `${visibleTitle}. ${visibleDescription} ${active
      ? `${active} currently in town, reaching ${influencedHomes} homes${gathering ? ` with ${gathering} visiting` : ''}; visit landmark.`
      : following ? 'Currently following this clue.'
      : canFollow ? 'Follow this clue.'
      : 'Its formation recipe is still hidden.'}`);
    const mark = document.createElement('span');
    mark.className = 'identity-mark';
    mark.textContent = learned ? identity.mark : surfaced ? '◌' : '◇';
    const copy = document.createElement('span');
    copy.className = 'identity-copy';
    const kicker = document.createElement('small');
    kicker.textContent = learned ? `place · ${identity.influenceRadius}-tile reach` : surfaced ? 'clue ready' : 'rumor';
    const title = document.createElement('strong');
    title.textContent = visibleTitle;
    const description = document.createElement('span');
    description.textContent = visibleDescription;
    const influence = document.createElement('span');
    influence.className = 'atlas-influence';
    influence.textContent = learned ? `${identity.landmark.title}. ${identity.landmark.effect} ${identity.trace} ${identity.influence}` : '';
    const status = document.createElement('em');
    status.textContent = active
      ? `${influencedHomes} ${influencedHomes === 1 ? 'home' : 'homes'}${gathering ? ` · ${gathering} visiting` : ''}${legacyTrades ? ` · ${legacyTrades} ${legacyTrades === 1 ? 'trade' : 'trades'}` : ''} · View`
      : following ? `Following · ${Math.round(progress.value * 100)}%`
      : learned ? `Known${legacyTrades ? ` · ${legacyTrades} ${legacyTrades === 1 ? 'trade' : 'trades'}` : ''} · Follow to rebuild`
      : surfaced ? 'Follow clue'
      : 'Find one of its forms';
    copy.append(kicker, title, description);
    if (learned) copy.append(influence);
    copy.append(status);
    card.append(mark, copy);
    grid.append(card);
  }
  list.append(heading, grid);
}

function renderConfluenceAtlas(list: HTMLDivElement) {
  const activeCounts = new Map<ConfluenceId, number>();
  for (const occurrence of confluenceOccurrences) activeCounts.set(occurrence.id, (activeCounts.get(occurrence.id) ?? 0) + 1);
  const useCounts = citizens.confluenceUseCounts();
  const heading = document.createElement('div');
  heading.className = 'atlas-section-heading identity-heading confluence-heading';
  heading.innerHTML = '<strong>Confluences</strong><span>Bring three forms together. Their trade bonuses remain.</span>';
  const grid = document.createElement('div');
  grid.className = 'identity-grid confluence-grid';
  for (const definition of CONFLUENCE_CATALOG) {
    const learned = knownConfluences.has(definition.id);
    const active = activeCounts.get(definition.id) ?? 0;
    const gathering = useCounts.get(definition.id) ?? 0;
    const progress = confluenceProgress(definition.id, formationOccurrences);
    const following = followedConfluenceId === definition.id;
    const surfaced = learned || progress.state !== 'missing';
    const canFollow = !active && surfaced;
    const card = document.createElement('button');
    card.className = `identity-card confluence-card ${learned ? 'learned' : surfaced ? 'surfaced' : 'unknown'} ${active ? 'active-place' : ''} ${following ? 'following' : ''}`;
    if (active) card.dataset.confluenceId = definition.id;
    else if (canFollow) card.dataset.followConfluenceId = definition.id;
    card.disabled = !active && !canFollow;
    card.setAttribute('aria-pressed', String(following));
    const visibleTitle = surfaced ? definition.title : definition.mysteryTitle;
    const visibleDescription = following ? progress.hint : learned ? definition.description : surfaced ? progress.hint : definition.rumor;
    card.setAttribute('aria-label', `${visibleTitle}. ${visibleDescription} ${active
      ? `${active} currently in town${gathering ? ` with ${gathering} visiting` : ''}; visit grand landmark.`
      : following ? 'Currently following this three-formation clue.'
      : canFollow ? 'Follow this three-formation clue.'
      : 'Its recipe is still hidden.'}`);
    const mark = document.createElement('span');
    mark.className = 'identity-mark confluence-mark';
    mark.textContent = learned ? definition.mark : surfaced ? '△' : '◇';
    const copy = document.createElement('span');
    copy.className = 'identity-copy';
    const kicker = document.createElement('small');
    kicker.textContent = learned ? 'three-form place' : surfaced ? 'clue ready' : 'rumor';
    const title = document.createElement('strong');
    title.textContent = visibleTitle;
    const description = document.createElement('span');
    description.textContent = visibleDescription;
    const influence = document.createElement('span');
    influence.className = 'atlas-influence';
    influence.textContent = learned ? `${definition.landmark.title}. ${definition.landmark.effect}` : '';
    const status = document.createElement('em');
    status.textContent = active
      ? `${gathering} visiting · View`
      : following ? `Following · ${Math.round(progress.value * 100)}%`
      : learned ? 'Known · Follow to rebuild'
      : surfaced ? 'Follow clue'
      : 'Find its first form';
    copy.append(kicker, title, description);
    if (learned) copy.append(influence);
    copy.append(status);
    card.append(mark, copy);
    grid.append(card);
  }
  list.append(heading, grid);
}

function createFormationSketch(id: FormationId) {
  const template = document.createElement('template');
  template.innerHTML = `<svg viewBox="0 0 108 72" focusable="false" aria-hidden="true">
    <g class="journal-sketch-lines">${FORMATION_SKETCHES[id]}</g>
  </svg>`;
  return template.content.firstElementChild!;
}

function setJournalView(view: 'stories' | 'atlas') {
  journalView = view;
  renderJournal();
}

function revisitFormation(id: FormationId) {
  const occurrence = formationOccurrences.find((formation) => formation.id === id);
  const definition = FORMATION_BY_ID.get(id);
  if (!occurrence || !definition) return;
  controls.target.lerp(city.worldPosition(occurrence.x, occurrence.z).setY(1), .55);
  city.celebrateAt(occurrence.x, occurrence.z);
  setJournalOpen(false);
  showToast(`${definition.title}: shaped by the buildings around it.`);
}

function revisitPlaceIdentity(id: PlaceIdentityId) {
  const occurrence = placeIdentityOccurrences.find((identity) => identity.id === id);
  const definition = PLACE_IDENTITY_BY_ID.get(id);
  if (!occurrence || !definition) return;
  const landmark = placeLandmarkSocket(occurrence);
  controls.target.lerp(city.worldPosition(landmark.x, landmark.z).setY(1), .55);
  city.celebrateAt(landmark.x, landmark.z);
  setJournalOpen(false);
  showToast(`${definition.title}: visit its ${definition.landmark.title.toLowerCase()}, formed by neighboring shapes.`);
}

function revisitConfluence(id: ConfluenceId) {
  const occurrence = confluenceOccurrences.find((confluence) => confluence.id === id);
  const definition = CONFLUENCE_BY_ID.get(id);
  if (!occurrence || !definition) return;
  const landmark = confluenceLandmarkSocket(occurrence);
  controls.target.lerp(city.worldPosition(landmark.x, landmark.z).setY(1), .55);
  city.celebrateAt(landmark.x, landmark.z);
  setJournalOpen(false);
  showToast(`${definition.title}: three formations converge at its ${definition.landmark.title.toLowerCase()}.`);
}

function revisitHarborLantern(id: HarborLanternId) {
  const lantern = HARBOR_LANTERNS.find((candidate) => candidate.id === id);
  const anchor = city.harborLanternGatherPoints().find((candidate) => candidate.id === id);
  if (!lantern || !anchor) return;
  controls.target.lerp(city.worldPosition(anchor.x, anchor.z).setY(1), .55);
  city.celebrateAt(anchor.x, anchor.z);
  setJournalOpen(false);
  showToast(`${lantern.title}: ${lantern.achievement}`);
}

function lanternState(id: HarborLanternId) {
  return harborLanternStates({
    knownConfluences,
    activeConfluences: confluenceOccurrences.map((confluence) => confluence.id),
    litLanterns: litHarborLanternIds,
  }).find((lantern) => lantern.id === id);
}

function claimCompletedLantern(id: HarborLanternId) {
  const lantern = lanternState(id);
  if (!lantern || lantern.state !== 'ready') {
    showToast('That lantern still needs its Confluence achievement active in town.');
    renderJournal();
    return;
  }
  const kindlingConfluenceId = lantern.confluenceIds.at(-1)!;
  const occurrence = confluenceOccurrences.find((confluence) => confluence.id === kindlingConfluenceId);
  if (!occurrence) return;
  const landmark = confluenceLandmarkSocket(occurrence);
  litHarborLanternIds.add(id);
  city.setHarborLanterns(litHarborLanternIds);
  followedThreadId = null;
  followedConfluenceId = null;
  controls.target.lerp(city.worldPosition(landmark.x, landmark.z).setY(1), .55);
  city.celebrateAt(landmark.x, landmark.z);
  showToast(`${lantern.title} lit. The Confluence was already complete.`);
  softTone(480 + litHarborLanternIds.size * 68, .28, 0, .02, 'sine');
  renderJournal();
  updateThreadStatus();
  persistSoon();
}

function prepareLanternFinale() {
  const crown = confluenceOccurrences.find((confluence) => confluence.id === 'festival-crown');
  if (!crown || litHarborLanternIds.size !== HARBOR_LANTERNS.length) {
    renderJournal();
    return;
  }
  setJournalOpen(false);
  festivalInvitationPending = true;
  const discovery = grow.triggerEligible('lantern-finale', currentSnapshot());
  festivalInvitationPending = false;
  if (!discovery) return;
  city.setDiscoveryState(grow.discoveredIds());
  citizens.setDiscoveries(grow.discoveredIds());
  refreshAmbience();
  renderJournal();
  persistSoon();
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
  document.querySelector('#thread-kicker')!.textContent = 'Following a thread';
  if (followedConfluenceId) {
    const definition = CONFLUENCE_BY_ID.get(followedConfluenceId);
    const progress = confluenceProgress(followedConfluenceId, formationOccurrences);
    if (!definition || progress.state === 'active') {
      followedConfluenceId = null;
      panel.classList.remove('show');
      return;
    }
    const checks = progress.requirements.map((requirement, index) => `${progress.found[index] ? '✓' : '○'} ${requirement}`).join(' · ');
    const percent = Math.round(progress.value * 100);
    document.querySelector('#thread-title')!.textContent = `${definition.title} → ${definition.landmark.title}`;
    document.querySelector('#thread-hint')!.textContent = `${checks}. ${progress.hint}`;
    document.querySelector<HTMLElement>('#thread-progress-fill')!.style.width = `${percent}%`;
    panel.querySelector<HTMLElement>('[role="progressbar"]')!.setAttribute('aria-valuenow', String(percent));
    panel.classList.add('show');
    return;
  }
  if (followedPlaceIdentityId) {
    const definition = PLACE_IDENTITY_BY_ID.get(followedPlaceIdentityId);
    const placeProgress = placeIdentityProgress(followedPlaceIdentityId, formationOccurrences);
    if (!definition || placeProgress.state === 'active') {
      followedPlaceIdentityId = null;
      panel.classList.remove('show');
      return;
    }
    const checks = placeProgress.requirements.map((requirement, index) => `${placeProgress.found[index] ? '✓' : '○'} ${requirement}`).join(' · ');
    const percent = Math.round(placeProgress.value * 100);
    document.querySelector('#thread-title')!.textContent = `${definition.title} → ${definition.landmark.title}`;
    document.querySelector('#thread-hint')!.textContent = `${checks}. ${placeProgress.hint}`;
    document.querySelector<HTMLElement>('#thread-progress-fill')!.style.width = `${percent}%`;
    panel.querySelector<HTMLElement>('[role="progressbar"]')!.setAttribute('aria-valuenow', String(percent));
    panel.classList.add('show');
    return;
  }
  if (!followedThreadId || grow.discoveredIds().includes(followedThreadId)) {
    followedThreadId = null;
    panel.classList.remove('show');
    return;
  }
  const clue = grow.progressFor(followedThreadId, snapshot);
  if (!clue) {
    panel.classList.remove('show');
    return;
  }
  const percent = Math.round(clue.progress * 100);
  document.querySelector('#thread-kicker')!.textContent = 'Following a thread';
  document.querySelector('#thread-title')!.textContent = clue.title;
  document.querySelector('#thread-hint')!.textContent = clue.hint;
  document.querySelector<HTMLElement>('#thread-progress-fill')!.style.width = `${percent}%`;
  const progress = panel.querySelector<HTMLElement>('[role="progressbar"]')!;
  progress.setAttribute('aria-valuenow', String(percent));
  panel.classList.add('show');
}

function followThread(eventId: string) {
  followedThreadId = followedThreadId === eventId ? null : eventId;
  if (followedThreadId) {
    followedPlaceIdentityId = null;
    followedConfluenceId = null;
  }
  const snapshot = currentSnapshot();
  updateThreadStatus(snapshot);
  renderJournal();
  persistSoon();
  if (!followedThreadId) return;
  const clue = followedThreadId ? grow.progressFor(followedThreadId, snapshot) : null;
  if (clue?.focus) controls.target.lerp(city.worldPosition(clue.focus.x, clue.focus.z).setY(1), .4);
  setJournalOpen(false);
  showToast(`Following "${clue?.title ?? 'a new thread'}".`);
}

function followPlaceIdentity(id: PlaceIdentityId) {
  followedPlaceIdentityId = followedPlaceIdentityId === id ? null : id;
  if (followedPlaceIdentityId) {
    followedThreadId = null;
    followedConfluenceId = null;
  }
  placeIntroductionSeen = true;
  updateSecondTideIntroduction();
  updateThreadStatus();
  renderJournal();
  persistSoon();
  if (!followedPlaceIdentityId) return;
  const definition = PLACE_IDENTITY_BY_ID.get(id);
  const progress = placeIdentityProgress(id, formationOccurrences);
  if (progress.focus) controls.target.lerp(city.worldPosition(progress.focus.x, progress.focus.z).setY(1), .4);
  setJournalOpen(false);
  showToast(`Following ${definition?.title ?? 'a living place'}. Shape its formations, then bring them close.`);
}

function followConfluence(id: ConfluenceId) {
  followedConfluenceId = followedConfluenceId === id ? null : id;
  if (followedConfluenceId) {
    followedThreadId = null;
    followedPlaceIdentityId = null;
  }
  updateThreadStatus();
  renderJournal();
  persistSoon();
  if (!followedConfluenceId) return;
  const definition = CONFLUENCE_BY_ID.get(id);
  const progress = confluenceProgress(id, formationOccurrences);
  if (progress.focus) controls.target.lerp(city.worldPosition(progress.focus.x, progress.focus.z).setY(1), .4);
  setJournalOpen(false);
  showToast(`Following ${definition?.title ?? 'a confluence'}. Shape all three forms and keep every pair close.`);
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
  const scrim = document.querySelector<HTMLElement>('#journal-scrim')!;
  const openButton = document.querySelector<HTMLButtonElement>('#journal-open')!;
  const hadFocus = scrim.contains(document.activeElement);
  if (open) {
    setTopActionsOpen(false);
    setAboutOpen(false);
    setPostcardOpen(false);
    setTouchGuideOpen(false);
    renderJournal();
    document.querySelector<HTMLDivElement>('#journal-list')!.scrollTop = 0;
  }
  scrim.classList.toggle('show', open);
  scrim.setAttribute('aria-hidden', String(!open));
  document.querySelectorAll<HTMLElement>('.hud > :not(#journal-scrim)').forEach((element) => {
    if (open) element.setAttribute('inert', '');
    else element.removeAttribute('inert');
  });
  renderer.domElement.toggleAttribute('inert', open);
  if (open) {
    scrim.removeAttribute('inert');
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('#journal-close')!.focus(), 50);
  } else {
    scrim.setAttribute('inert', '');
    if (hadFocus) openButton.focus();
    updateSecondTideIntroduction();
  }
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
    document.querySelector('#postcard-note')!.textContent = 'The PNG stores your town so Little Tides can reload it.';
    window.setTimeout(() => document.querySelector<HTMLButtonElement>('#postcard-save')!.focus(), 50);
  } else if (scrim.contains(document.activeElement)) {
    openButton.focus();
  }
}

function canvasPng(inscription: string) {
  return new Promise<Blob>((resolve, reject) => {
    const hoverWasVisible = hover.visible;
    const markersWereVisible = onboardingMarkers.visible;
    hover.visible = false;
    onboardingMarkers.visible = false;
    renderer.render(scene, camera);
    void composePostcard(renderer.domElement, { inscription, date: postcardDate(), day }).then((blob) => {
      hover.visible = hoverWasVisible;
      onboardingMarkers.visible = markersWereVisible;
      resolve(blob);
    }, (error) => {
      hover.visible = hoverWasVisible;
      onboardingMarkers.visible = markersWereVisible;
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
  button.textContent = 'Painting postcard...';
  note.textContent = 'Saving the picture and town data.';
  try {
    saveTown();
    const inscription = document.querySelector<HTMLInputElement>('#postcard-message')!.value;
    const postcard = await makeTidePostcard(await canvasPng(inscription), currentTownData());
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(postcard, `little-tides-day-${day}-${date}.png`);
    note.textContent = 'Saved. Share the PNG or load it here later.';
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
  button.textContent = 'Building 3D model...';
  note.textContent = 'Preparing the town for 3D printing.';
  try {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const model = makeTownStl(city.root);
    const date = new Date().toISOString().slice(0, 10);
    downloadBlob(model, `little-tides-day-${day}-${date}.stl`);
    note.textContent = 'STL saved in millimeters. It includes the town and a shared base, without colors.';
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
  note.textContent = 'Reading the town inside this picture...';
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
  const visibleChange = update.opened.length > 0 || update.closed.length > 0 || update.hired.length > 0 || update.prosperityChanged === true;
  city.setBusinesses(current);
  if (visibleChange) {
    citizens.setBusinesses(current);
    refreshAmbience();
    renderer.shadowMap.needsUpdate = true;
    ignoreNextPerformanceSample = true;
  }
  if (announce && update.closed[0]) {
    showToast(`${update.closed[0].name} has closed its shutters.`);
  }
  if (announce && update.hired[0]) {
    const hire = update.hired[0];
    const citizen = citizens.card(hire.citizenId);
    showToast(`${citizen?.name ?? 'A neighbor'} now helps at ${hire.business.name}.`);
    playCue('door');
  }
  if (announce && update.opened[0]) {
    const opened = update.opened[0];
    const [x, z] = opened.cellKey.split(',').map(Number);
    const affinity = placeBusinessAffinity(opened.type, { x, z }, formationOccurrences);
    const foundingPlace = opened.placeIdentityId ? PLACE_IDENTITY_BY_ID.get(opened.placeIdentityId) : affinity.identity;
    if (foundingPlace) showToast(`${foundingPlace.title} helped ${opened.name} open here. The shop will keep that origin in its history.`);
    else if (affinity.formation) showToast(`${opened.name} opens near the ${affinity.formation.title.toLowerCase()}. The place suits the trade.`);
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
  if (lanternFinaleSequenceActive) {
    softTone(760, .38, .5, .01, 'sine');
    softTone(910, .42, .78, .008, 'sine');
  }
}

type SoundCue = 'water' | 'gulls' | 'footsteps' | 'door' | 'chatter' | 'bell' | 'horn' | 'insects' | 'rain' | 'celebration' | 'firework';

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
  if (cue === 'firework') {
    const strength = THREE.MathUtils.clamp(daylight, .45, .8);
    softTone(78, .46, 0, .009 * strength, 'sine');
    softTone(126, .24, .018, .006 * strength, 'triangle');
    softTone(720, .065, .012, .0035 * strength, 'triangle');
  }
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
  button.querySelector('.music-state')!.textContent = musicMuted ? '♩' : '♫';
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
window.addEventListener('pointerdown', () => {
  void startBackgroundMusic();
  void getAudio().resume();
}, { capture: true, once: true });
window.addEventListener('keydown', () => {
  void startBackgroundMusic();
  void getAudio().resume();
}, { capture: true, once: true });

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

function setTopActionsOpen(open: boolean) {
  const actions = document.querySelector<HTMLElement>('.top-actions')!;
  const menu = document.querySelector<HTMLElement>('#top-actions-menu')!;
  const toggle = document.querySelector<HTMLButtonElement>('#mobile-menu-toggle')!;
  actions.classList.toggle('open', open);
  toggle.setAttribute('aria-expanded', String(open));
  toggle.setAttribute('aria-label', open ? 'Close town controls' : 'Open town controls');
  menu.setAttribute('aria-hidden', String(!open));
  if (!open) menu.setAttribute('inert', '');
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
setTopActionsOpen(false);

document.querySelector('#reset')!.addEventListener('click', () => {
  if (!confirm('Let this town drift away and begin with a new tide?')) return;
  localStorage.removeItem(STORAGE_KEY);
  location.reload();
});

function setObserveMode(enabled: boolean, announce = true) {
  observeMode = enabled;
  const button = document.querySelector<HTMLButtonElement>('#observe-toggle')!;
  button.classList.toggle('active', observeMode);
  button.setAttribute('aria-pressed', String(observeMode));
  if (!observeMode) {
    hideMemoryCard();
  }
  if (announce) showToast(observeMode ? 'Observe mode: choose a building, tree, animal, boat, or resident.' : 'Build mode restored.');
}

document.querySelector('#card-close')!.addEventListener('click', hideCitizenCard);
document.querySelector('#memory-card-close')!.addEventListener('click', hideMemoryCard);
document.querySelector('#observe-toggle')!.addEventListener('click', () => {
  setObserveMode(!observeMode);
});
document.querySelector('#thread-close')!.addEventListener('click', () => {
  followedThreadId = null;
  followedPlaceIdentityId = null;
  followedConfluenceId = null;
  updateThreadStatus();
  persistSoon();
});
document.querySelector('#first-tide-close')!.addEventListener('click', dismissFirstTide);
document.querySelector('#first-tide-atlas')!.addEventListener('click', () => {
  const complete = onboardingStep() === 4;
  setJournalView(complete ? 'stories' : 'atlas');
  setJournalOpen(true);
  if (complete) dismissFirstTide();
});
document.querySelector('#second-tide-close')!.addEventListener('click', dismissSecondTide);
document.querySelector('#second-tide-atlas')!.addEventListener('click', () => {
  dismissSecondTide();
  setJournalView('atlas');
  setJournalOpen(true);
});
document.querySelector('#journal-open')!.addEventListener('click', () => setJournalOpen(true));
document.querySelector('#journal-close')!.addEventListener('click', () => setJournalOpen(false));
document.querySelectorAll<HTMLButtonElement>('[data-journal-view]').forEach((button) => {
  button.addEventListener('click', () => setJournalView(button.dataset.journalView === 'atlas' ? 'atlas' : 'stories'));
});
document.querySelector('#journal-scrim')!.addEventListener('click', (event) => {
  if (event.target === event.currentTarget) setJournalOpen(false);
});
document.querySelector('#journal-list')!.addEventListener('click', (event) => {
  const target = event.target as HTMLElement;
  const claim = target.closest<HTMLButtonElement>('[data-claim-lantern-id]');
  if (claim?.dataset.claimLanternId) claimCompletedLantern(claim.dataset.claimLanternId as HarborLanternId);
  const harborLantern = target.closest<HTMLButtonElement>('[data-revisit-lantern-id]');
  if (harborLantern?.dataset.revisitLanternId) revisitHarborLantern(harborLantern.dataset.revisitLanternId as HarborLanternId);
  const beginFinale = target.closest<HTMLButtonElement>('[data-begin-lantern-finale]');
  if (beginFinale) prepareLanternFinale();
  const thread = target.closest<HTMLButtonElement>('[data-thread-id]');
  if (thread?.dataset.threadId) followThread(thread.dataset.threadId);
  const revisit = target.closest<HTMLButtonElement>('[data-revisit-id]');
  if (revisit?.dataset.revisitId) revisitDiscovery(revisit.dataset.revisitId);
  const formation = target.closest<HTMLButtonElement>('[data-formation-id]');
  if (formation?.dataset.formationId) revisitFormation(formation.dataset.formationId as FormationId);
  const identity = target.closest<HTMLButtonElement>('[data-place-identity-id]');
  if (identity?.dataset.placeIdentityId) revisitPlaceIdentity(identity.dataset.placeIdentityId as PlaceIdentityId);
  const followPlace = target.closest<HTMLButtonElement>('[data-follow-place-id]');
  if (followPlace?.dataset.followPlaceId) followPlaceIdentity(followPlace.dataset.followPlaceId as PlaceIdentityId);
  const confluence = target.closest<HTMLButtonElement>('[data-confluence-id]');
  if (confluence?.dataset.confluenceId) revisitConfluence(confluence.dataset.confluenceId as ConfluenceId);
  const followConfluenceCard = target.closest<HTMLButtonElement>('[data-follow-confluence-id]');
  if (followConfluenceCard?.dataset.followConfluenceId) followConfluence(followConfluenceCard.dataset.followConfluenceId as ConfluenceId);
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
document.querySelector('#finale-continue')!.addEventListener('click', () => {
  document.querySelector('#lantern-finale-card')!.classList.remove('show');
});
document.querySelector('#finale-journal')!.addEventListener('click', () => {
  document.querySelector('#lantern-finale-card')!.classList.remove('show');
  journalView = 'stories';
  setJournalOpen(true);
});
document.querySelector('#finale-postcard')!.addEventListener('click', () => {
  document.querySelector('#lantern-finale-card')!.classList.remove('show');
  setPostcardOpen(true);
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
    document.querySelector('#lantern-finale-card')!.classList.remove('show');
  }
});

const ambience = new HarborAmbience(seed, camera, city.cells.values());
ambience.setDiscoveryState(grow.discoveredIds());
ambience.setPlaceIdentities(placeIdentityOccurrences);
ambience.setTown(city.cells.values(), businesses.all(), citizens.residents(), city.matureTreeAnchors(day * 24 + timeOfDay));
ambience.setCargoState(crafting.goodsSnapshot());
scene.add(ambience.root);
renderJournal();
updateThreadStatus();
updateFirstTideGuide();
updateSecondTideIntroduction();

function refreshAmbience() {
  const catsBefore = ambience.wildlifeStats();
  ambience.setTown(city.cells.values(), businesses.all(), citizens.residents(), city.matureTreeAnchors(day * 24 + timeOfDay));
  ambience.setPlaceIdentities(placeIdentityOccurrences);
  ambience.setDiscoveryState(grow.discoveredIds());
  ambience.setCargoState(crafting.goodsSnapshot());
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
const dayHemiSky = new THREE.Color(0xffe8bd);
const nightHemiSky = new THREE.Color(0x9bc5e8);
const dayHemiGround = new THREE.Color(0x315f63);
const nightHemiGround = new THREE.Color(0x23475e);
const currentSky = new THREE.Color();
const daylightStartHour = 4;
const daylightEndHour = 20;
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
  if (hour <= daylightStartHour || hour >= daylightEndHour) return .04;
  const solar = Math.sin((hour - daylightStartHour) / (daylightEndHour - daylightStartHour) * Math.PI);
  return THREE.MathUtils.clamp(solar * .9 + .1, .04, 1);
}

function updateTimeDisplay() {
  const hours = Math.floor(timeOfDay);
  const minutes = Math.floor((timeOfDay - hours) * 60);
  const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const population = citizens.population();
  const desktopClock = document.querySelector<HTMLElement>('#clock-display')!;
  desktopClock.textContent = `Day ${day} · ${time}`;
  desktopClock.setAttribute('aria-label', `Day ${day}, ${time}, ${population} ${population === 1 ? 'resident' : 'residents'}`);
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
  // Keep two thirds of each cycle in the light. Day runs from 04:00 to 20:00,
  // leaving an eight-hour night without losing the dawn and dusk transitions.
  const nextNightMode = timeOfDay < daylightStartHour || timeOfDay >= daylightEndHour;
  if (nextNightMode !== nightMode) {
    nightMode = nextNightMode;
    document.body.classList.toggle('night', nightMode);
  }
  const twilight = Math.max(0, 1 - Math.abs(timeOfDay - 19.2) / 2.4, 1 - Math.abs(timeOfDay - 4.8) / 2.1);
  currentSky.copy(nightSky).lerp(daySky, daylight).lerp(dawnSky, twilight * .28);
  scene.background = currentSky;
  sceneFog.color.copy(currentSky);
  waterUniforms.uSky.value.copy(currentSky);
  const cameraDistance = camera.position.distanceTo(controls.target);
  const distantView = THREE.MathUtils.smoothstep(cameraDistance, 34, 64);
  sceneFog.density = THREE.MathUtils.lerp(.0135, .0012, distantView);
  const moonlight = Math.pow(1 - daylight, 1.5);
  hemi.color.copy(nightHemiSky).lerp(dayHemiSky, daylight);
  hemi.groundColor.copy(nightHemiGround).lerp(dayHemiGround, daylight);
  hemi.intensity = .72 + daylight * 1.53;
  sun.intensity = .12 + daylight * 4.58;
  const sunAngle = (timeOfDay - 6) / 24 * Math.PI * 2;
  sun.position.set(Math.cos(sunAngle) * 18, 5 + daylight * 20, Math.sin(sunAngle) * 16);
  const moonAngle = sunAngle + Math.PI;
  moon.intensity = moonlight * 1.3;
  moon.position.set(Math.cos(moonAngle) * 20, 14 + moonlight * 8, Math.sin(moonAngle) * 18);
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
  renderer.toneMappingExposure = .88 + daylight * .2;
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
    applyBusinessUpdate(businesses.recordVisits(citizens.drainBusinessVisits(), residentState, absoluteHours), true);
    const businessUpdate = businesses.update(residentState, city.cells, absoluteHours);
    applyBusinessUpdate(businessUpdate, true);
    const craftingUpdate = crafting.update(
      businesses.all(), residentState, grow.discoveredIds(), absoluteHours, formationOccurrences,
      ambience.activeImportSourceCellKey(),
    );
    if (craftingUpdate.producerBusinessId) {
      applyBusinessUpdate(businesses.recordProduction(craftingUpdate.producerBusinessId, absoluteHours), false);
    }
    if (craftingUpdate.arrival) ambience.beginImport(craftingUpdate.arrival.good);
    if (craftingUpdate.delivery) citizens.beginDelivery(craftingUpdate.delivery.fromCellKey, craftingUpdate.delivery.toCellKey, craftingUpdate.delivery.good);
    if (craftingUpdate.milestone) {
      showToast(craftingUpdate.milestone);
      playCue('door');
    }
    if (craftingUpdate.changed) {
      ambience.setCargoState(crafting.goodsSnapshot());
      persistSoon();
    }
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
  const harborUpdate = ambience.update(time, daylight, timeOfDay, absoluteHours, catColonyFoundedAt, weather.intensity);
  if (harborUpdate.fireworkBurst && audioContext?.state === 'running') playCue('firework', harborUpdate.fireworkBurst);
  if (harborUpdate.prosperityMarketOpened) {
    citizens.gatherAt(
      harborUpdate.prosperityMarketOpened.x,
      harborUpdate.prosperityMarketOpened.z,
      'browsing the market-day stalls',
    );
    showToast('The town has set out its surplus for market day.');
    playCue('chatter');
  }
  if (harborUpdate.exportDeparture) {
    const shipped = crafting.shipHarborGoods(harborUpdate.exportDeparture.capacity);
    if (shipped > 0) {
      ambience.setCargoState(crafting.goodsSnapshot());
      showToast(`The merchant boat carries ${shipped} ${shipped === 1 ? 'crate' : 'crates'} of harbor goods out to sea.`);
      playCue('horn');
      persistSoon();
    }
  }
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
  // Center the finite mesh beneath the camera so its hidden rim can never enter
  // the view when panning or orbiting far away from the town.
  water.position.x = camera.position.x;
  water.position.z = camera.position.z;
  waterUniforms.uHorizonCenter.value.set(camera.position.x, camera.position.z);
  // WebGL's drawing buffer is not preserved by default. Keep presenting the
  // scene while a journal view is open so overlay recompositing cannot reveal
  // the page background in place of the town.
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
