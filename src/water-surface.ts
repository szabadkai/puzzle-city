import * as THREE from 'three';
import type { AtmosphereState } from './atmosphere';
import type { QualitySettings } from './quality';
import { presentationUniforms } from './shading';
import { CELL_SIZE } from './spatial';
import type { Cell } from './types';

export const WATER_LEVEL = -.31;
/** Objects on this layer appear in planar reflections. */
export const REFLECTION_LAYER = 1;
/** Emissive objects that low tier still reflects: lit windows and lanterns. */
export const EMISSIVE_REFLECTION_LAYER = 2;

const FIELD_SIZE = 384;
const FIELD_EXTENT = 26;
const FIELD_MAX_DISTANCE = 6;
const FOOTPRINT_HALF = CELL_SIZE * .51 + .12;

const WATER_FLAT_RADIUS = 165;
const WATER_CURVE_RADIUS = 320;
const WATER_MESH_RADIUS = 520;

/** 1D squared Euclidean distance transform (Felzenszwalb and Huttenlocher). */
function distanceTransform1d(f: Float32Array, n: number, d: Float32Array, v: Int32Array, z: Float32Array) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k -= 1;
      s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k += 1;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k += 1;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/**
 * Distance from any water texel to the nearest building footprint, stored in a
 * texture the water shader reads for foam lines, the shallow colour ramp, and
 * caustics. It updates whenever the town changes.
 */
export class ShorelineField {
  readonly texture: THREE.DataTexture;
  private readonly data = new Float32Array(FIELD_SIZE * FIELD_SIZE);
  private readonly grid = new Float32Array(FIELD_SIZE * FIELD_SIZE);
  private readonly column = new Float32Array(FIELD_SIZE);
  private readonly rowOut = new Float32Array(FIELD_SIZE);
  private readonly parabolas = new Int32Array(FIELD_SIZE);
  private readonly boundaries = new Float32Array(FIELD_SIZE + 1);

  constructor() {
    this.texture = new THREE.DataTexture(this.data, FIELD_SIZE, FIELD_SIZE, THREE.RedFormat, THREE.FloatType);
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;
    this.texture.generateMipmaps = false;
    this.data.fill(1);
    this.texture.needsUpdate = true;
  }

  /** World units per texel and the world-space origin of texel (0, 0). */
  get bounds() {
    return new THREE.Vector4(-FIELD_EXTENT, -FIELD_EXTENT, FIELD_EXTENT * 2, FIELD_MAX_DISTANCE);
  }

  update(cells: Iterable<Cell>) {
    const texel = FIELD_EXTENT * 2 / FIELD_SIZE;
    const grid = this.grid;
    grid.fill(Infinity);
    for (const cell of cells) {
      const minX = Math.max(0, Math.floor((cell.x * CELL_SIZE - FOOTPRINT_HALF + FIELD_EXTENT) / texel));
      const maxX = Math.min(FIELD_SIZE - 1, Math.ceil((cell.x * CELL_SIZE + FOOTPRINT_HALF + FIELD_EXTENT) / texel));
      const minZ = Math.max(0, Math.floor((cell.z * CELL_SIZE - FOOTPRINT_HALF + FIELD_EXTENT) / texel));
      const maxZ = Math.min(FIELD_SIZE - 1, Math.ceil((cell.z * CELL_SIZE + FOOTPRINT_HALF + FIELD_EXTENT) / texel));
      for (let z = minZ; z <= maxZ; z++) for (let x = minX; x <= maxX; x++) grid[z * FIELD_SIZE + x] = 0;
    }
    // Columns, then rows: the squared distances compose.
    for (let x = 0; x < FIELD_SIZE; x++) {
      for (let z = 0; z < FIELD_SIZE; z++) this.column[z] = grid[z * FIELD_SIZE + x];
      distanceTransform1d(this.column, FIELD_SIZE, this.rowOut, this.parabolas, this.boundaries);
      for (let z = 0; z < FIELD_SIZE; z++) grid[z * FIELD_SIZE + x] = this.rowOut[z];
    }
    for (let z = 0; z < FIELD_SIZE; z++) {
      const offset = z * FIELD_SIZE;
      distanceTransform1d(grid.subarray(offset, offset + FIELD_SIZE), FIELD_SIZE, this.rowOut, this.parabolas, this.boundaries);
      for (let x = 0; x < FIELD_SIZE; x++) this.data[offset + x] = Math.min(1, Math.sqrt(this.rowOut[x]) * texel / FIELD_MAX_DISTANCE);
    }
    this.texture.needsUpdate = true;
  }
}

/** Tileable value-noise heights in R with the height gradient in G and B. */
function createWaveNoiseTexture(size = 256) {
  const lattice = 16;
  const values = new Float32Array(lattice * lattice);
  let seed = 90217;
  for (let index = 0; index < values.length; index++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    values[index] = seed / 4294967296;
  }
  const sample = (x: number, y: number) => values[((y % lattice + lattice) % lattice) * lattice + ((x % lattice + lattice) % lattice)];
  const smooth = (t: number) => t * t * (3 - 2 * t);
  const height = (u: number, v: number) => {
    let total = 0;
    let amplitude = .55;
    let frequency = 1;
    for (let octave = 0; octave < 3; octave++) {
      const fx = u * lattice * frequency;
      const fy = v * lattice * frequency;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = smooth(fx - x0);
      const ty = smooth(fy - y0);
      const a = sample(x0, y0);
      const b = sample(x0 + 1, y0);
      const c = sample(x0, y0 + 1);
      const d = sample(x0 + 1, y0 + 1);
      total += amplitude * THREE.MathUtils.lerp(THREE.MathUtils.lerp(a, b, tx), THREE.MathUtils.lerp(c, d, tx), ty);
      amplitude *= .5;
      frequency *= 2;
    }
    return total;
  };
  const data = new Float32Array(size * size * 4);
  const step = 1 / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size;
    const v = y / size;
    const h = height(u, v);
    const dx = (height(u + step, v) - height(u - step, v)) / (2 * step);
    const dy = (height(u, v + step) - height(u, v - step)) / (2 * step);
    const index = (y * size + x) * 4;
    data[index] = h;
    data[index + 1] = dx;
    data[index + 2] = dy;
    data[index + 3] = 1;
  }
  const texture = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.FloatType);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function createCurvedWaterGeometry() {
  // The playable harbor stays level; the distant sea rolls below the sightline
  // so only its smooth tangent forms the horizon.
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

const VERTEX_SHADER = /* glsl */`
  uniform mat4 uReflectionMatrix;
  varying vec3 vWorld;
  varying vec4 vReflectCoord;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorld = world.xyz;
    vReflectCoord = uReflectionMatrix * world;
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

const FRAGMENT_SHADER = /* glsl */`
  precision highp float;
  uniform sampler2D uNoise;
  uniform sampler2D uField;
  uniform sampler2D uReflection;
  uniform vec4 uFieldBounds;
  uniform float uReflectionStrength;
  uniform vec3 uWaterColor;
  uniform vec3 uHorizonColor;
  uniform vec3 uZenithColor;
  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;
  uniform vec3 uMoonDirection;
  uniform float uMoonIntensity;
  uniform vec3 uFogColor;
  uniform float uFogDensity;
  uniform vec3 uCameraPosition;
  uniform vec2 uHorizonCenter;
  uniform vec2 uWindOffset;
  uniform vec2 uCloudOffset;
  uniform float uCloudCover;
  uniform float uCloudShadow;
  uniform float uTime;
  uniform float uRain;
  uniform float uNight;
  varying vec3 vWorld;
  varying vec4 vReflectCoord;

  vec3 waveLayer(vec2 uv, float scale, vec2 drift, float amplitude) {
    vec3 noise = texture2D(uNoise, uv * scale + drift).rgb;
    return vec3(noise.gb * amplitude * scale, noise.r);
  }

  float hash21(vec2 p) {
    p = fract(p * vec2(233.34, 851.73));
    p += dot(p, p + 23.45);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y);
  }

  // The same cloud field the buildings read, so shadows cross from quay to water.
  float cloudLight(vec2 world) {
    vec2 p = world * 0.05 + uCloudOffset;
    float n = valueNoise(p) * 0.62 + valueNoise(p * 2.3 + 7.0) * 0.38;
    float threshold = mix(0.78, 0.42, uCloudCover);
    return 1.0 - smoothstep(threshold, threshold + 0.24, n) * uCloudShadow;
  }

  // Expanding rings from raindrops, one per grid cell.
  vec2 rainRipple(vec2 p, float time) {
    vec2 cell = floor(p);
    vec2 local = fract(p) - 0.5;
    float phase = hash21(cell);
    float t = fract(time * 0.9 + phase);
    float radius = t * 0.45;
    float d = length(local + (vec2(hash21(cell + 7.1), hash21(cell + 3.3)) - 0.5) * 0.4);
    float ring = sin(clamp((radius - d) * 40.0, -3.1416, 3.1416)) * (1.0 - t);
    return normalize(local + 1e-4) * ring;
  }

  void main() {
    vec2 uv = vWorld.xz;
    vec2 wind = uWindOffset;
    vec3 a = waveLayer(uv, 0.036, wind * 0.04 + vec2(uTime * 0.006, 0.0), 0.3);
    vec3 b = waveLayer(uv, 0.09, wind * 0.08 + vec2(-uTime * 0.011, uTime * 0.008), 0.16);
    vec2 rotated = vec2(uv.x * 0.7986 - uv.y * 0.6018, uv.x * 0.6018 + uv.y * 0.7986);
    vec3 c = waveLayer(rotated, 0.21, wind * 0.14 + vec2(uTime * 0.02, -uTime * 0.014), 0.05);
    vec2 slope = a.xy + b.xy + c.xy;
    slope += rainRipple(uv * 1.6, uTime) * uRain * 0.35 + rainRipple(uv * 2.9 + 11.0, uTime * 1.3) * uRain * 0.2;
    float waveHeight = a.z * 0.5 + b.z * 0.32 + c.z * 0.18;
    vec3 normal = normalize(vec3(-slope.x, 1.0, -slope.y));

    vec2 fieldUv = (uv - uFieldBounds.xy) / uFieldBounds.z;
    float inField = step(0.0, fieldUv.x) * step(fieldUv.x, 1.0) * step(0.0, fieldUv.y) * step(fieldUv.y, 1.0);
    float shoreDistance = mix(uFieldBounds.w, texture2D(uField, fieldUv).r * uFieldBounds.w, inField);

    float shallow = 1.0 - smoothstep(0.0, 2.4, shoreDistance);
    vec3 deep = uWaterColor * 0.5;
    vec3 shallowColor = uWaterColor * 1.25 + vec3(0.02, 0.07, 0.03);
    vec3 base = mix(deep, shallowColor, shallow * 0.75 + waveHeight * 0.2);

    float daylight = clamp(uSunIntensity / 3.5, 0.0, 1.0);
    float cloud = mix(1.0, cloudLight(uv), step(0.0, uSunDirection.y));
    base *= 1.0 - (1.0 - cloud) * 0.22 * daylight;
    float causticA = texture2D(uNoise, uv * 0.21 + vec2(uTime * 0.03, uTime * 0.017)).r;
    float causticB = texture2D(uNoise, rotated * 0.24 - vec2(uTime * 0.022, uTime * 0.031)).r;
    float caustic = pow(clamp(causticA * causticB * 2.6, 0.0, 1.0), 2.2);
    base += uSunColor * caustic * shallow * daylight * 0.32 * cloud;

    vec3 viewDir = normalize(uCameraPosition - vWorld);
    float fresnel = pow(1.0 - max(dot(viewDir, normal), 0.0), 4.0);
    vec3 skyReflection = mix(uZenithColor, uHorizonColor, fresnel * 0.55);
    vec4 reflectCoord = vReflectCoord;
    reflectCoord.xy += normal.xz * reflectCoord.w * 0.055;
    vec4 reflected = texture2DProj(uReflection, reflectCoord);
    vec3 reflection = mix(skyReflection, reflected.rgb, reflected.a * uReflectionStrength);
    float reflectAmount = mix(0.08, 0.62, fresnel);
    reflectAmount = mix(reflectAmount, reflectAmount * 1.3 + 0.12, uNight);
    vec3 color = mix(base, reflection, clamp(reflectAmount, 0.0, 1.0));

    vec3 halfSun = normalize(uSunDirection + viewDir);
    float sunSpec = pow(max(dot(normal, halfSun), 0.0), 260.0);
    color += uSunColor * sunSpec * uSunIntensity * 0.6 * step(0.0, uSunDirection.y) * cloud;
    // The moon path: a mask from the smooth swell keeps the sparkle in a lane toward the moon.
    vec3 halfMoon = normalize(uMoonDirection + viewDir);
    vec3 swellNormal = normalize(vec3(-a.x * 0.35, 1.0, -a.y * 0.35));
    float moonLane = pow(max(dot(swellNormal, halfMoon), 0.0), 60.0);
    float moonSpec = pow(max(dot(normal, halfMoon), 0.0), 300.0) * moonLane;
    color += vec3(0.75, 0.82, 1.0) * moonSpec * uMoonIntensity * 0.5;

    float foamNoise = texture2D(uNoise, uv * 0.8 + vec2(uTime * 0.05, -uTime * 0.04)).r;
    float wavePhase = sin(uTime * 1.4 + foamNoise * 6.2832 + shoreDistance * 4.0) * 0.5 + 0.5;
    float edge = 1.0 - smoothstep(0.0, 0.22 + wavePhase * 0.16, shoreDistance);
    float foam = edge * smoothstep(0.42, 0.78, foamNoise + edge * 0.4) * inField;
    float foamGlow = mix(0.7, 0.3, uNight);
    color = mix(color, vec3(0.96, 0.97, 0.94) * foamGlow, foam * 0.65);

    float cameraDistance = distance(vWorld, uCameraPosition);
    float fog = 1.0 - exp(-uFogDensity * uFogDensity * cameraDistance * cameraDistance);
    color = mix(color, uFogColor, fog);
    // Keep the opposite shore in visible water; reserve the pale sky blend
    // for the open sea beyond the hills.
    float horizonHaze = smoothstep(180.0, 320.0, distance(vWorld.xz, uHorizonCenter));
    color = mix(color, uHorizonColor, horizonHaze);
    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * The harbour water: layered wave normals, a shoreline-driven colour ramp with
 * foam and caustic shimmer, sun and moon glitter, rain ripples, and a planar
 * reflection of buildings, lights, and sky.
 */
export class WaterSurface {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  readonly field = new ShorelineField();
  readonly wind = new THREE.Vector2(.6, .25);
  private readonly windOffset = new THREE.Vector2();
  private lastTime = 0;
  private readonly reflectionTarget: THREE.WebGLRenderTarget;
  private readonly reflectionScale: number;
  private readonly reflectionCamera = new THREE.PerspectiveCamera();
  private readonly reflectionMatrix = new THREE.Matrix4();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -WATER_LEVEL);
  private readonly uniforms = {
    uNoise: { value: createWaveNoiseTexture() },
    uField: { value: this.field.texture },
    uFieldBounds: { value: this.field.bounds },
    uReflection: { value: null as THREE.Texture | null },
    uReflectionMatrix: { value: this.reflectionMatrix },
    uReflectionStrength: { value: 1 },
    uWaterColor: { value: new THREE.Color(0x2f8a86) },
    uHorizonColor: { value: new THREE.Color() },
    uZenithColor: { value: new THREE.Color() },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunIntensity: { value: 0 },
    uMoonDirection: { value: new THREE.Vector3(0, 1, 0) },
    uMoonIntensity: { value: 0 },
    uFogColor: { value: new THREE.Color() },
    uFogDensity: { value: .01 },
    uCameraPosition: { value: new THREE.Vector3() },
    uHorizonCenter: { value: new THREE.Vector2() },
    uWindOffset: { value: this.windOffset },
    uCloudOffset: presentationUniforms.uCloudOffset,
    uCloudCover: presentationUniforms.uCloudCover,
    uCloudShadow: presentationUniforms.uCloudShadow,
    uTime: { value: 0 },
    uRain: { value: 0 },
    uNight: { value: 0 },
  };

  constructor(quality: QualitySettings) {
    this.reflectionScale = quality.reflection === 'full' ? 1 : quality.reflection === 'half' ? .5 : .25;
    this.reflectionTarget = new THREE.WebGLRenderTarget(256, 256, {
      type: quality.reflection === 'sky' ? THREE.UnsignedByteType : THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    this.reflectionTarget.texture.minFilter = THREE.LinearFilter;
    this.reflectionTarget.texture.magFilter = THREE.LinearFilter;
    this.uniforms.uReflection.value = this.reflectionTarget.texture;
    this.reflectionCamera.layers.set(quality.reflection === 'sky' ? EMISSIVE_REFLECTION_LAYER : REFLECTION_LAYER);
    const material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERTEX_SHADER, fragmentShader: FRAGMENT_SHADER, fog: false });
    this.mesh = new THREE.Mesh(createCurvedWaterGeometry(), material);
    this.mesh.name = 'harbor-water';
    this.mesh.position.y = WATER_LEVEL;
    this.mesh.frustumCulled = false;
  }

  setCells(cells: Iterable<Cell>) {
    this.field.update(cells);
  }

  setSize(drawingBufferWidth: number, drawingBufferHeight: number) {
    this.reflectionTarget.setSize(Math.max(64, Math.round(drawingBufferWidth * this.reflectionScale)), Math.max(64, Math.round(drawingBufferHeight * this.reflectionScale)));
  }

  update(time: number, atmosphere: AtmosphereState, camera: THREE.Camera, waterColor: THREE.Color, fogColor: THREE.Color, fogDensity: number) {
    const uniforms = this.uniforms;
    uniforms.uTime.value = time;
    // Waves travel the distance the wind has pushed them so far. Scaling the
    // current wind by absolute time would slide the whole pattern on every gust.
    this.windOffset.addScaledVector(this.wind, THREE.MathUtils.clamp(time - this.lastTime, 0, .1));
    this.lastTime = time;
    uniforms.uRain.value = atmosphere.wetness;
    uniforms.uNight.value = atmosphere.night;
    uniforms.uWaterColor.value.copy(waterColor);
    uniforms.uHorizonColor.value.copy(atmosphere.skyHorizon);
    uniforms.uZenithColor.value.copy(atmosphere.skyZenith);
    uniforms.uSunDirection.value.copy(atmosphere.sunDirection);
    uniforms.uSunColor.value.copy(atmosphere.sunColor);
    uniforms.uSunIntensity.value = atmosphere.sunElevation > 0 ? atmosphere.sunIntensity : 0;
    uniforms.uMoonDirection.value.copy(atmosphere.moonDirection);
    uniforms.uMoonIntensity.value = atmosphere.moonIntensity;
    uniforms.uFogColor.value.copy(fogColor);
    uniforms.uFogDensity.value = fogDensity;
    uniforms.uCameraPosition.value.copy(camera.position);
    // Centre the finite mesh under the camera so its rim never enters the view.
    this.mesh.position.x = camera.position.x;
    this.mesh.position.z = camera.position.z;
    uniforms.uHorizonCenter.value.set(camera.position.x, camera.position.z);
  }

  /** Renders the mirrored view into the reflection target. Call before the main render. */
  renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    const reflectionCamera = this.reflectionCamera;
    const normal = this.plane.normal;
    const view = new THREE.Vector3().copy(camera.position);
    view.y = 2 * WATER_LEVEL - view.y;
    reflectionCamera.position.copy(view);
    const forward = camera.getWorldDirection(new THREE.Vector3());
    forward.reflect(normal);
    reflectionCamera.up.set(0, 1, 0).reflect(normal).negate();
    reflectionCamera.lookAt(view.clone().add(forward));
    reflectionCamera.near = camera.near;
    reflectionCamera.far = camera.far;
    reflectionCamera.aspect = camera.aspect;
    reflectionCamera.fov = camera.fov;
    reflectionCamera.updateProjectionMatrix();
    reflectionCamera.updateMatrixWorld();

    // Oblique near plane: clip everything under the water so it cannot leak into the mirror.
    const clipPlane = new THREE.Plane().copy(this.plane).applyMatrix4(reflectionCamera.matrixWorldInverse);
    const clip = new THREE.Vector4(clipPlane.normal.x, clipPlane.normal.y, clipPlane.normal.z, clipPlane.constant);
    const projection = reflectionCamera.projectionMatrix;
    const q = new THREE.Vector4(
      (Math.sign(clip.x) + projection.elements[8]) / projection.elements[0],
      (Math.sign(clip.y) + projection.elements[9]) / projection.elements[5],
      -1,
      (1 + projection.elements[10]) / projection.elements[14],
    );
    clip.multiplyScalar(2 / clip.dot(q));
    projection.elements[2] = clip.x;
    projection.elements[6] = clip.y;
    projection.elements[10] = clip.z + 1;
    projection.elements[14] = clip.w;

    this.reflectionMatrix.set(.5, 0, 0, .5, 0, .5, 0, .5, 0, 0, .5, .5, 0, 0, 0, 1);
    this.reflectionMatrix.multiply(reflectionCamera.projectionMatrix);
    this.reflectionMatrix.multiply(reflectionCamera.matrixWorldInverse);

    const previousTarget = renderer.getRenderTarget();
    const previousClearAlpha = renderer.getClearAlpha();
    renderer.setRenderTarget(this.reflectionTarget);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    this.mesh.visible = false;
    renderer.render(scene, reflectionCamera);
    this.mesh.visible = true;
    renderer.setClearAlpha(previousClearAlpha);
    renderer.setRenderTarget(previousTarget);
  }

  dispose() {
    this.reflectionTarget.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
