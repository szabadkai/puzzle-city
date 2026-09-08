import * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';

/** Frame-rate independent exponential approach. `rate` is roughly 1 / seconds to settle. */
export function damp(current: number, target: number, rate: number, deltaSeconds: number) {
  return THREE.MathUtils.lerp(current, target, 1 - Math.exp(-rate * deltaSeconds));
}

const DRIFT_ORBIT_RATE = .055;
const DRIFT_BOB_PERIOD = 15;
const DRIFT_BOB_AMOUNT = .035;
const DRIFT_ZOOM_PERIOD = 23;
const DRIFT_ZOOM_AMOUNT = .045;

/**
 * Moves the camera when the player does not: a slow orbit with a gentle bob
 * and zoom breathing after a few idle seconds, and a smoothed follow of one
 * resident. Any input blends the drift out over 0.3 s.
 */
export class CameraDirector {
  driftEnabled = true;
  driftDelaySeconds = 6;
  private idleSeconds = 0;
  private driftWeight = 0;
  private driftTime = 0;
  private followPosition: (() => THREE.Vector3 | null) | null = null;
  private readonly spherical = new THREE.Spherical();
  private readonly offset = new THREE.Vector3();
  private readonly desiredTarget = new THREE.Vector3();
  private readonly previousTarget = new THREE.Vector3();
  private readonly interactionEnded = () => { this.idleSeconds = 0; };
  private readonly interactionStarted = () => { this.idleSeconds = 0; this.driftWeight = Math.min(this.driftWeight, .999); this.interacting = true; };
  private readonly interactionFinished = () => { this.interacting = false; this.idleSeconds = 0; };
  private interacting = false;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly controls: OrbitControls,
    domElement: HTMLElement,
  ) {
    controls.addEventListener('start', this.interactionStarted);
    controls.addEventListener('end', this.interactionFinished);
    domElement.addEventListener('wheel', this.interactionEnded, { passive: true });
    domElement.addEventListener('pointerdown', this.interactionEnded);
    window.addEventListener('keydown', this.interactionEnded);
    // A backgrounded tab on a phone comes back with the camera already moving.
    window.addEventListener('blur', () => { this.idleSeconds = this.driftDelaySeconds; });
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.idleSeconds = this.driftDelaySeconds; });
  }

  get drifting() { return this.driftWeight > .01; }

  get following() { return this.followPosition !== null; }

  /** Restart the idle timer, for example after a scripted camera move. */
  noteInput() {
    this.idleSeconds = 0;
  }

  follow(position: (() => THREE.Vector3 | null) | null) {
    this.followPosition = position;
    if (position) this.previousTarget.copy(this.controls.target);
  }

  /** Start drifting now instead of after the idle delay. */
  beginDrift() {
    this.idleSeconds = this.driftDelaySeconds;
  }

  update(deltaSeconds: number) {
    const dt = Math.min(deltaSeconds, .1);
    if (!this.interacting) this.idleSeconds += dt;
    this.updateFollow(dt);
    const wantsDrift = this.driftEnabled && !this.interacting && this.idleSeconds >= this.driftDelaySeconds;
    // Ease in over about two seconds, blend out in 0.3 s.
    this.driftWeight = wantsDrift ? damp(this.driftWeight, 1, .9, dt) : damp(this.driftWeight, 0, 12, dt);
    if (this.driftWeight > .001) this.applyDrift(dt);
  }

  private updateFollow(dt: number) {
    if (!this.followPosition) return;
    const position = this.followPosition();
    if (!position) {
      this.followPosition = null;
      return;
    }
    this.desiredTarget.copy(position).y += .55;
    const before = this.previousTarget.copy(this.controls.target);
    this.controls.target.x = damp(before.x, this.desiredTarget.x, 5, dt);
    this.controls.target.y = damp(before.y, this.desiredTarget.y, 5, dt);
    this.controls.target.z = damp(before.z, this.desiredTarget.z, 5, dt);
    // Carry the camera with the target so the player's orbit offset survives.
    this.camera.position.add(this.controls.target).sub(before);
  }

  private applyDrift(dt: number) {
    const weight = this.driftWeight;
    this.driftTime += dt * weight;
    this.offset.copy(this.camera.position).sub(this.controls.target);
    this.spherical.setFromVector3(this.offset);
    this.spherical.theta += DRIFT_ORBIT_RATE * dt * weight;
    const bob = Math.cos(this.driftTime / DRIFT_BOB_PERIOD * Math.PI * 2) * DRIFT_BOB_AMOUNT * dt * weight * (Math.PI * 2 / DRIFT_BOB_PERIOD);
    this.spherical.phi = THREE.MathUtils.clamp(this.spherical.phi + bob, this.controls.minPolarAngle + .02, this.controls.maxPolarAngle - .02);
    const breathe = 1 + Math.cos(this.driftTime / DRIFT_ZOOM_PERIOD * Math.PI * 2) * DRIFT_ZOOM_AMOUNT * dt * weight * (Math.PI * 2 / DRIFT_ZOOM_PERIOD);
    this.spherical.radius = THREE.MathUtils.clamp(this.spherical.radius * breathe, this.controls.minDistance, this.controls.maxDistance);
    this.offset.setFromSpherical(this.spherical);
    this.camera.position.copy(this.controls.target).add(this.offset);
    this.camera.lookAt(this.controls.target);
  }
}
