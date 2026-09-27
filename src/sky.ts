import * as THREE from 'three';
import type { AtmosphereState } from './atmosphere';

/**
 * An inverted sphere that follows the camera and paints the sky gradient, a
 * sun disc with glow, a horizon haze band, and at night a moon and stars.
 */
export class SkyDome {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  readonly bow: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private readonly uniforms = {
    uZenith: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uHaze: { value: new THREE.Color() },
    uSunDirection: { value: new THREE.Vector3(0, 1, 0) },
    uSunColor: { value: new THREE.Color() },
    uSunVisible: { value: 1 },
    uGlow: { value: 0 },
    uMoonDirection: { value: new THREE.Vector3(0, 1, 0) },
    uMoonVisibility: { value: 0 },
    uMoonIllumination: { value: 0 },
    uNight: { value: 0 },
    uTime: { value: 0 },
    uRainbow: { value: 0 },
    uFlash: { value: 0 },
  };
  /** Sheet lightning behind the clouds, 0 to 1. Set by the town during heavy rain. */
  flash = 0;

  constructor(radius = 292) {
    const material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      side: THREE.BackSide,
      // The dome writes depth so no pixel is left at the far plane, which keeps
      // the depth-based occlusion pass out of undefined territory.
      depthWrite: true,
      depthTest: true,
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
        uniform float uMoonVisibility;
        uniform float uMoonIllumination;
        uniform float uNight;
        uniform float uTime;
        uniform float uRainbow;
        uniform float uFlash;
        varying vec3 vDirection;

        float hash13(vec3 p) {
          p = fract(p * vec3(443.897, 441.423, 437.195));
          p += dot(p, p.yzx + 19.19);
          return fract((p.x + p.y) * p.z);
        }

        // A meteor: one candidate every nine seconds, about a third of them fall.
        vec3 meteor(vec3 dir) {
          float slot = floor(uTime / 9.0);
          float within = fract(uTime / 9.0) * 9.0;
          if (hash13(vec3(slot, 3.7, 1.3)) < 0.62 || within > 1.2) return vec3(0.0);
          float progress = within / 1.2;
          vec2 sph = vec2(atan(dir.z, dir.x), asin(clamp(dir.y, -1.0, 1.0)));
          vec2 start = vec2((hash13(vec3(slot, 1.1, 2.2)) - 0.5) * 4.0, 0.4 + hash13(vec3(slot, 5.5, 0.7)) * 0.6);
          float side = hash13(vec3(slot, 6.6, 6.6)) > 0.5 ? 1.0 : -1.0;
          vec2 velocity = vec2(side * (0.4 + hash13(vec3(slot, 9.1, 4.4)) * 0.3), -0.2 - hash13(vec3(slot, 2.9, 8.8)) * 0.15);
          vec2 head = start + velocity * within;
          vec2 tail = head - velocity * 0.35;
          vec2 pa = sph - tail;
          vec2 ba = head - tail;
          float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
          vec2 d = pa - ba * h;
          d.x *= cos(sph.y);
          float dist = length(d);
          float streak = exp(-dist * dist / (0.004 * 0.004)) * h * h;
          float life = smoothstep(0.0, 0.15, progress) * (1.0 - smoothstep(0.6, 1.0, progress));
          return vec3(0.9, 0.95, 1.0) * streak * life * 2.5;
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
          // Slightly enlarged angular discs stay readable at the game's scale.
          // Screen derivatives keep their edges smooth even in small captures.
          float horizon = smoothstep(-0.001, 0.001, dir.y);
          float sunEdge = max(fwidth(sunDot), 0.000002);
          float disc = smoothstep(cos(0.012) - sunEdge, cos(0.012) + sunEdge, sunDot) * uSunVisible * horizon;
          float corona = pow(sunDot, 180.0) * uSunVisible * horizon;
          sky += uSunColor * (disc * 4.0 + corona * 0.9);
          float moonDot = max(dot(dir, uMoonDirection), 0.0);
          float moonEdge = max(fwidth(moonDot), 0.000002);
          float starPixelWidth = max(length(dFdx(dir)), length(dFdy(dir))) * 100.0;
          float moonDisc = smoothstep(cos(0.0115) - moonEdge, cos(0.0115) + moonEdge, moonDot) * horizon;
          float moonHalo = pow(moonDot, 400.0) * 0.18 * uMoonIllumination * horizon;
          if (moonDisc > 0.0) {
            vec3 tangent = (dir - uMoonDirection * moonDot) / sin(0.0115);
            vec3 normal = tangent - uMoonDirection * sqrt(max(0.0, 1.0 - dot(tangent, tangent)));
            // The bright limb always faces the actual sun, including in daylight.
            float lit = smoothstep(-0.025, 0.025, dot(normal, uSunDirection));
            vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDirection));
            vec3 top = cross(uMoonDirection, right);
            vec2 uv = vec2(dot(tangent, right), dot(tangent, top));
            float maria = sin(uv.x * 9.0 + sin(uv.y * 7.0)) * sin(uv.y * 11.0 - uv.x * 4.0);
            float surface = 0.84 + 0.16 * maria;
            vec3 lunarColor = vec3(0.86, 0.9, 1.0) * surface * (lit * 1.6 + 0.025 * uNight);
            sky = mix(sky, lunarColor, moonDisc * uMoonVisibility);
          }
          sky += vec3(0.86, 0.9, 1.0) * uMoonVisibility * moonHalo;
          sky += vec3(0.75, 0.82, 1.0) * uFlash * (0.5 + band * 1.5);
          if (uNight > 0.02 && dir.y > 0.02) {
            // A small radial glow inside each occupied cell, rather than
            // lighting the entire cell's polygonal intersection with the sky.
            vec3 starPosition = dir * 100.0;
            vec3 cell = floor(starPosition);
            float star = hash13(cell);
            vec3 center = cell + 0.3 + 0.4 * vec3(
              hash13(cell + 17.1), hash13(cell + 43.7), hash13(cell + 91.3));
            float distanceToStar = length(starPosition - center);
            float radius = mix(0.045, 0.075, hash13(cell + 7.9));
            float filteredRadius = min(0.14, sqrt(radius * radius + starPixelWidth * starPixelWidth * 0.25));
            float point = exp(-distanceToStar * distanceToStar / (filteredRadius * filteredRadius));
            // Keep the glow inside the cell and conserve brightness as the
            // pixel filter widens it, preventing square edges and harsh flicker.
            point *= 1.0 - smoothstep(0.2, 0.28, distanceToStar);
            point *= radius * radius / (filteredRadius * filteredRadius);
            float twinkle = 0.92 + 0.08 * sin(uTime * (0.7 + star) + star * 40.0);
            float brightness = smoothstep(0.94, 1.0, star) * point * twinkle;
            float starVisibility = smoothstep(0.3, 0.95, uNight) * smoothstep(0.02, 0.25, dir.y);
            sky += vec3(0.90, 0.94, 1.0) * brightness * starVisibility * 0.9 * (1.0 - moonDisc);
            sky += meteor(dir) * uNight * (1.0 - moonDisc);
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
    // The bow hangs in the rain curtain, in front of the clouds: it draws after
    // the cloud sprites, and only the buildings (which write depth) can hide it.
    const bowMaterial = new THREE.ShaderMaterial({
      uniforms: { uSunDirection: this.uniforms.uSunDirection, uRainbow: this.uniforms.uRainbow },
      side: THREE.BackSide,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      vertexShader: material.vertexShader,
      fragmentShader: /* glsl */`
        uniform vec3 uSunDirection;
        uniform float uRainbow;
        varying vec3 vDirection;

        // Spectral colour across a bow: 0 is the violet inner edge, 1 the red outer edge.
        vec3 bowColor(float t) {
          float hue = (1.0 - t) * 0.78;
          vec3 p = abs(fract(hue + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
          return clamp(p - 1.0, 0.0, 1.0);
        }

        // Primary bow at 40.6 to 42.4 degrees from the antisolar point, a faint
        // reversed secondary at 50.4 to 53.6, and the darker sky between them.
        vec3 rainbow(vec3 dir) {
          float angle = degrees(acos(clamp(dot(dir, -uSunDirection), -1.0, 1.0)));
          float horizonFade = smoothstep(0.0, 0.12, dir.y);
          float t = (angle - 40.6) / 1.8;
          float primary = smoothstep(0.0, 0.2, t) * (1.0 - smoothstep(0.8, 1.0, t));
          float t2 = (angle - 50.4) / 3.2;
          float secondary = smoothstep(0.0, 0.25, t2) * (1.0 - smoothstep(0.75, 1.0, t2));
          float alexander = smoothstep(41.5, 43.5, angle) * (1.0 - smoothstep(49.5, 51.5, angle));
          vec3 light = bowColor(clamp(t, 0.0, 1.0)) * primary * 0.4 + bowColor(1.0 - clamp(t2, 0.0, 1.0)) * secondary * 0.1;
          return (light - vec3(0.04) * alexander) * horizonFade * uRainbow;
        }

        void main() {
          gl_FragColor = vec4(max(rainbow(normalize(vDirection)), 0.0), 1.0);
        }
      `,
    });
    this.bow = new THREE.Mesh(new THREE.SphereGeometry(radius * .8, 40, 20), bowMaterial);
    this.bow.name = 'rainbow';
    this.bow.frustumCulled = false;
    this.bow.renderOrder = 50;
    this.bow.userData.nonPrintable = true;
  }

  /** Stars scatter into noise on the water, so the reflection pass hides them. */
  setStarsVisible(visible: boolean) {
    this.uniforms.uNight.value = visible ? this.nightForStars : 0;
  }

  private nightForStars = 0;

  update(atmosphere: AtmosphereState, cameraPosition: THREE.Vector3, time: number) {
    this.mesh.position.copy(cameraPosition);
    this.bow.position.copy(cameraPosition);
    this.bow.visible = atmosphere.rainbow > .001;
    const uniforms = this.uniforms;
    uniforms.uZenith.value.copy(atmosphere.skyZenith);
    uniforms.uHorizon.value.copy(atmosphere.skyHorizon);
    uniforms.uHaze.value.copy(atmosphere.fogColor);
    uniforms.uSunDirection.value.copy(atmosphere.sunDirection);
    uniforms.uSunColor.value.copy(atmosphere.sunColor).multiplyScalar(1 - atmosphere.wetness * .85);
    uniforms.uSunVisible.value = THREE.MathUtils.smoothstep(atmosphere.sunElevation, -.018, .015);
    uniforms.uGlow.value = atmosphere.horizonGlow;
    uniforms.uMoonDirection.value.copy(atmosphere.moonDirection);
    uniforms.uMoonVisibility.value = atmosphere.moonVisibility;
    uniforms.uMoonIllumination.value = atmosphere.moonIllumination;
    this.nightForStars = atmosphere.night * (1 - atmosphere.wetness);
    uniforms.uNight.value = this.nightForStars;
    uniforms.uTime.value = time;
    uniforms.uRainbow.value = atmosphere.rainbow;
    uniforms.uFlash.value = this.flash;
  }
}
