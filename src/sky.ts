import * as THREE from 'three';
import type { AtmosphereState } from './atmosphere';

/**
 * An inverted sphere that follows the camera and paints the sky gradient, a
 * sun disc with glow, a horizon haze band, and at night a moon and stars.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunVisible: { value: 1 },
    uGlow: { value: 0 },
    uMoonDirection: { value: new THREE.Vector3(0, 1, 0) },
    uMoonIntensity: { value: 0 },
    uNight: { value: 0 },
    uTime: { value: 0 },
  };

  constructor(radius = 250) {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          vec4 world = modelMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */`
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uHaze;
        uniform vec3 uSunDirection;
        uniform vec3 uSunColor;
        uniform float uSunVisible;
        uniform float uGlow;
        uniform vec3 uMoonDirection;
        uniform float uMoonIntensity;
        uniform float uNight;
        uniform float uTime;
        varying vec3 vDirection;

        float hash13(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }

        void main() {
          vec3 dir = normalize(vDirection);
          float up = clamp(dir.y, 0.0, 1.0);
          vec3 sky = mix(uHorizon, uZenith, pow(up, 0.58));
          float band = exp(-abs(dir.y) * 9.0);
          sky = mix(sky, uHaze, band * 0.55);
          float sunDot = max(dot(dir, uSunDirection), 0.0);
          float sunFacing = pow(sunDot, 6.0);
          sky += uSunColor * uGlow * sunFacing * (0.35 + band * 0.9);
          float disc = smoothstep(0.9993, 0.9997, sunDot) * uSunVisible;
          float corona = pow(sunDot, 180.0) * uSunVisible;
          sky += uSunColor * (disc * 4.0 + corona * 0.9);
          float moonDot = max(dot(dir, uMoonDirection), 0.0);
          float moonDisc = smoothstep(0.99955, 0.99975, moonDot);
          float moonHalo = pow(moonDot, 400.0) * 0.35;
          sky += vec3(0.86, 0.9, 1.0) * uMoonIntensity * (moonDisc * 1.6 + moonHalo);
          if (uNight > 0.02 && dir.y > 0.02) {
            vec3 cell = floor(dir * 140.0);
            float star = hash13(cell);
            float twinkle = 0.75 + 0.25 * sin(uTime * (1.5 + star * 3.0) + star * 40.0);
            float brightness = smoothstep(0.985, 1.0, star) * twinkle;
            sky += vec3(0.95, 0.96, 1.0) * brightness * uNight * smoothstep(0.02, 0.25, dir.y) * 1.4;
          }
          gl_FragColor = vec4(sky, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 40, 20), material);
    this.mesh.name = 'sky-dome';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -100;
    this.mesh.userData.nonPrintable = true;
  }

  update(atmosphere: AtmosphereState, cameraPosition: THREE.Vector3, time: number) {
    this.mesh.position.copy(cameraPosition);
    const uniforms = this.uniforms;
    uniforms.uZenith.value.copy(atmosphere.skyZenith);
    uniforms.uHorizon.value.copy(atmosphere.skyHorizon);
    uniforms.uHaze.value.copy(atmosphere.fogColor);
    uniforms.uSunDirection.value.copy(atmosphere.sunDirection);
    uniforms.uSunColor.value.copy(atmosphere.sunColor).multiplyScalar(Math.min(1, atmosphere.sunIntensity / 3.5) * (1 - atmosphere.wetness * .7));
    uniforms.uSunVisible.value = atmosphere.sunElevation > -.02 ? 1 : 0;
    uniforms.uGlow.value = atmosphere.horizonGlow;
    uniforms.uMoonDirection.value.copy(atmosphere.moonDirection);
    uniforms.uMoonIntensity.value = atmosphere.moonIntensity;
    uniforms.uNight.value = atmosphere.night * (1 - atmosphere.wetness);
    uniforms.uTime.value = time;
  }
}
