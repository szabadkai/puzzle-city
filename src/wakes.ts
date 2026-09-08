import * as THREE from 'three';
import { WATER_LEVEL } from './water-surface';

const SEGMENTS_PER_TRAIL = 14;
const SAMPLE_SPACING = .32;
const SEGMENT_LIFE_SECONDS = 3.2;

type Trail = {
  samples: { position: THREE.Vector3; heading: number; age: number }[];
  last: THREE.Vector3 | null;
};

/**
 * Short foam ribbons behind moving boats: one additive quad per recent stern
 * position, widening and fading with age.
 */
export class WakeSystem {
  readonly mesh: THREE.InstancedMesh;
  private readonly trails = new Map<string, Trail>();
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly hidden = new THREE.Matrix4().makeScale(0, 0, 0);

  constructor(maxBoats: number, scale = 1) {
    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: .55 * scale,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, maxBoats * SEGMENTS_PER_TRAIL);
    this.mesh.name = 'boat-wakes';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.userData.nonPrintable = true;
    for (let index = 0; index < this.mesh.count; index++) {
      this.mesh.setMatrixAt(index, this.hidden);
      this.mesh.setColorAt(index, this.color.setScalar(0));
    }
  }

  /** Report a boat position each frame. Hidden boats should call `release`. */
  trail(id: string, position: THREE.Vector3, deltaSeconds: number) {
    let trail = this.trails.get(id);
    if (!trail) {
      trail = { samples: [], last: null };
      this.trails.set(id, trail);
    }
    for (const sample of trail.samples) sample.age += deltaSeconds;
    trail.samples = trail.samples.filter((sample) => sample.age < SEGMENT_LIFE_SECONDS);
    if (!trail.last) {
      trail.last = position.clone();
      return;
    }
    const moved = position.distanceTo(trail.last);
    if (moved >= SAMPLE_SPACING) {
      const heading = Math.atan2(position.x - trail.last.x, position.z - trail.last.z);
      trail.samples.unshift({ position: position.clone(), heading, age: 0 });
      trail.samples.length = Math.min(trail.samples.length, SEGMENTS_PER_TRAIL);
      trail.last.copy(position);
    }
  }

  release(id: string) {
    this.trails.delete(id);
  }

  update() {
    let slot = 0;
    for (const trail of this.trails.values()) {
      for (const sample of trail.samples) {
        if (slot >= this.mesh.count) break;
        const life = 1 - sample.age / SEGMENT_LIFE_SECONDS;
        this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), sample.heading);
        this.scale.set(.32 + (1 - life) * .9, 1, .5);
        this.matrix.compose(sample.position.clone().setY(WATER_LEVEL + .015), this.quaternion, this.scale);
        this.mesh.setMatrixAt(slot, this.matrix);
        this.mesh.setColorAt(slot, this.color.setScalar(life * life));
        slot += 1;
      }
    }
    for (let index = slot; index < this.mesh.count; index++) this.mesh.setMatrixAt(index, this.hidden);
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
