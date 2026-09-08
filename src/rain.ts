import * as THREE from 'three';

const RAIN_BOX = new THREE.Vector3(26, 16, 26);

/**
 * Rain streaks as one instanced draw. Each quad lives in a box that follows
 * the camera, falls on the GPU, wraps at the bottom, and faces the camera.
 */
export class RainSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly uniforms = {
    uTime: { value: 0 },
    uIntensity: { value: 0 },
    uWind: { value: new THREE.Vector2() },
    uCenter: { value: new THREE.Vector3() },
    uBox: { value: RAIN_BOX },
    uColor: { value: new THREE.Color(0xd8e6e8) },
  };

  constructor(count: number) {
    const geometry = new THREE.PlaneGeometry(.018, .42);
    const offsets = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let index = 0; index < count; index++) {
      offsets[index * 3] = Math.random();
      offsets[index * 3 + 1] = Math.random();
      offsets[index * 3 + 2] = Math.random();
      seeds[index] = Math.random();
    }
    geometry.setAttribute('aOffset', new THREE.InstancedBufferAttribute(offsets, 3));
    geometry.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */`
        attribute vec3 aOffset;
        attribute float aSeed;
        uniform float uTime;
        uniform float uIntensity;
        uniform vec2 uWind;
        uniform vec3 uCenter;
        uniform vec3 uBox;
        varying float vAlpha;
        void main() {
          float speed = 9.0 + aSeed * 4.0;
          float fall = fract(aOffset.y - uTime * speed / uBox.y);
          vec3 base = uCenter + (vec3(aOffset.x, fall, aOffset.z) - 0.5) * uBox;
          base.xz += uWind * (fall * 2.2);
          // A thin quad that always faces the camera and leans with the wind.
          vec3 right = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
          vec3 lean = normalize(vec3(uWind.x * 0.18, 1.0, uWind.y * 0.18));
          vec3 world = base + right * position.x + lean * position.y * (0.7 + aSeed * 0.6);
          vec4 mvPosition = viewMatrix * vec4(world, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          float near = smoothstep(1.5, 5.0, -mvPosition.z);
          float far = 1.0 - smoothstep(14.0, 26.0, -mvPosition.z);
          vAlpha = uIntensity * near * far * (0.35 + 0.35 * aSeed) * step(aSeed, uIntensity * 1.3);
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uColor;
        varying float vAlpha;
        void main() {
          gl_FragColor = vec4(uColor, vAlpha * 0.55);
        }
      `,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, count);
    this.mesh.name = 'rain-streaks';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.userData.nonPrintable = true;
    const identity = new THREE.Matrix4();
    for (let index = 0; index < count; index++) this.mesh.setMatrixAt(index, identity);
    this.mesh.visible = false;
  }

  update(time: number, intensity: number, wind: THREE.Vector2, cameraPosition: THREE.Vector3, forward: THREE.Vector3) {
    // Drops show once the overcast turns to rain.
    const drops = THREE.MathUtils.clamp((intensity - .3) / .7, 0, 1);
    this.mesh.visible = drops > .01;
    if (!this.mesh.visible) return;
    this.uniforms.uTime.value = time;
    this.uniforms.uIntensity.value = drops;
    this.uniforms.uWind.value.copy(wind);
    this.uniforms.uCenter.value.copy(cameraPosition).addScaledVector(forward, RAIN_BOX.z * .32);
    this.uniforms.uCenter.value.y = cameraPosition.y - RAIN_BOX.y * .15;
  }
}
