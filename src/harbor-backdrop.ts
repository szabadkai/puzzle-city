import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { AtmosphereState } from './atmosphere';
import { hash } from './random';
import { EMISSIVE_REFLECTION_LAYER, REFLECTION_LAYER } from './water-surface';

export type BackdropAtmosphere = Pick<AtmosphereState, 'fogColor' | 'night' | 'overcast'>;

type Range = {
  name: string;
  inner: number;
  outer: number;
  peak: number;
  /** How far the ridge sinks inside the shipping channel, 0 to 1. */
  channelDepth: number;
  low: THREE.Color;
  high: THREE.Color;
  crest: THREE.Color;
  salt: number;
};

type Channel = { angle: number; halfWidth: number; soft: number };

const TAU = Math.PI * 2;
const SEA_FLOOR = -6;
/** A low shelf at the water before the ridge climbs; the hillside city sits on it. */
const APRON_HEIGHT = 1.6;
const APRON_END = .3;
const ANGULAR_STEPS = 192;
const RADIAL_STEPS = 9;
/** The default camera looks from (18, 19, 20) toward the origin. The opposite shore is behind that view. */
const DEFAULT_VIEW_ANGLE = Math.atan2(-1, -1);

function angularDistance(angle: number, center: number) {
  const distance = Math.abs(((angle - center) % TAU + TAU) % TAU);
  return Math.min(distance, TAU - distance);
}

/** A seeded sum of a few sine harmonics around the horizon, 0 to 1. */
function ridgeProfile(seed: number, salt: number) {
  const harmonics = [2, 3, 5, 8, 13].map((frequency, index) => ({
    frequency,
    amplitude: 1 / (index + 1.5),
    phase: hash(seed, index, salt, 71) * TAU,
  }));
  const total = harmonics.reduce((sum, harmonic) => sum + harmonic.amplitude, 0);
  return (angle: number) => {
    let value = 0;
    for (const harmonic of harmonics) value += harmonic.amplitude * Math.sin(harmonic.frequency * angle + harmonic.phase);
    return .5 + .5 * value / total;
  };
}

/**
 * The opposite shore of the harbor: green hills close by, a mistier range
 * behind them, a dense hillside city at the water, its windows as dim glints
 * after dark, and dark rocks in the water. One arc stays open as the shipping
 * channel.
 */
export class HarborBackdrop {
  readonly root = new THREE.Group();
  private readonly glints: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
  private readonly nearMaterial: THREE.MeshStandardMaterial;
  private readonly farMaterial: THREE.MeshStandardMaterial;
  private readonly blockMaterial: THREE.MeshStandardMaterial;

  constructor(seed: number) {
    this.root.name = 'hong-kong-harbor-hills';
    const side = hash(seed, 0, 0, 9601) < .5 ? 1 : -1;
    const channel: Channel = {
      angle: DEFAULT_VIEW_ANGLE + side * (1.55 + hash(seed, 0, 0, 9602) * .45),
      halfWidth: .5,
      soft: .4,
    };
    this.root.userData.shippingChannel = { angle: channel.angle, halfWidth: channel.halfWidth + channel.soft };
    const open = (angle: number) => THREE.MathUtils.smoothstep(angularDistance(angle, channel.angle), channel.halfWidth, channel.halfWidth + channel.soft);

    const near: Range = {
      name: 'near-green-hills', inner: 126, outer: 154, peak: 30, channelDepth: 1,
      low: new THREE.Color(0x6d9a6a), high: new THREE.Color(0x527a5a), crest: new THREE.Color(0x86928a), salt: 11,
    };
    const far: Range = {
      name: 'misty-far-hills', inner: 158, outer: 180, peak: 40, channelDepth: .72,
      low: new THREE.Color(0x7d949a), high: new THREE.Color(0x66808a), crest: new THREE.Color(0x8b9ca2), salt: 23,
    };
    const nearHeight = this.heightFunction(seed, near, open);
    const farHeight = this.heightFunction(seed, far, open);

    this.nearMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .96 });
    this.farMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    this.blockMaterial = new THREE.MeshStandardMaterial({ roughness: .92 });

    const nearHills = new THREE.Mesh(this.createRange(seed, near, nearHeight), this.nearMaterial);
    nearHills.name = near.name;
    const farHills = new THREE.Mesh(this.createRange(seed, far, farHeight), this.farMaterial);
    farHills.name = far.name;

    const blocks = this.createHillsideBlocks(seed, near, nearHeight, open);
    const blockGlints = this.createGlints(seed, near, nearHeight, open, blocks.placements);
    this.glints = blockGlints;
    const rocks = this.createRocks(seed, open);

    this.root.add(nearHills, farHills, blocks.mesh, blockGlints, rocks);
    this.root.traverse((object) => {
      object.layers.enable(REFLECTION_LAYER);
      object.matrixAutoUpdate = false;
      object.updateMatrix();
    });
    blockGlints.layers.enable(EMISSIVE_REFLECTION_LAYER);
    this.update({ fogColor: new THREE.Color(0x91c7c1), night: 0, overcast: 0 });
  }

  /** Hills fade toward the haze, and the city across the water lights up after dark. */
  update(atmosphere: BackdropAtmosphere) {
    this.nearMaterial.emissive.copy(atmosphere.fogColor).multiplyScalar(.34);
    this.farMaterial.emissive.copy(atmosphere.fogColor).multiplyScalar(.45);
    this.blockMaterial.emissive.copy(atmosphere.fogColor).multiplyScalar(.1);
    const lit = THREE.MathUtils.smoothstep(atmosphere.night, .15, .7);
    this.glints.visible = lit > .001;
    this.glints.material.opacity = .38 * lit * (1 - atmosphere.overcast * .3);
  }

  private heightFunction(seed: number, range: Range, open: (angle: number) => number) {
    const ridge = ridgeProfile(seed, range.salt);
    return (angle: number, radius: number) => {
      const across = THREE.MathUtils.clamp((radius - range.inner) / (range.outer - range.inner), 0, 1);
      const apron = THREE.MathUtils.smoothstep(across, 0, APRON_END);
      const ridgeShape = Math.sin(Math.PI * THREE.MathUtils.clamp((across - APRON_END) / (1 - APRON_END), 0, 1)) ** 1.4;
      const openness = 1 - range.channelDepth * (1 - open(angle));
      const crest = APRON_HEIGHT + range.peak * (.35 + .65 * ridge(angle));
      return SEA_FLOOR + openness * ((APRON_HEIGHT - SEA_FLOOR) * apron + (crest - APRON_HEIGHT) * ridgeShape);
    };
  }

  private createRange(seed: number, range: Range, heightAt: (angle: number, radius: number) => number) {
    const rows = RADIAL_STEPS + 1;
    const positions = new Float32Array(rows * ANGULAR_STEPS * 3);
    const colors = new Float32Array(rows * ANGULAR_STEPS * 3);
    const color = new THREE.Color();
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < ANGULAR_STEPS; column++) {
        const angle = column / ANGULAR_STEPS * TAU;
        const across = row / RADIAL_STEPS;
        const jitterAngle = (hash(seed, column, row, range.salt + 1) - .5) * (TAU / ANGULAR_STEPS) * .6;
        const radius = range.inner + across * (range.outer - range.inner) + (hash(seed, column, row, range.salt + 2) - .5) * 1.6;
        const relief = Math.sin(Math.PI * THREE.MathUtils.clamp((across - APRON_END) / (1 - APRON_END), 0, 1));
        const y = heightAt(angle + jitterAngle, radius) + (hash(seed, column, row, range.salt + 3) - .5) * range.peak * .1 * relief;
        const index = (row * ANGULAR_STEPS + column) * 3;
        positions[index] = Math.cos(angle + jitterAngle) * radius;
        positions[index + 1] = y;
        positions[index + 2] = Math.sin(angle + jitterAngle) * radius;
        const altitude = THREE.MathUtils.clamp(y / (range.peak + APRON_HEIGHT), 0, 1);
        const variation = hash(seed, column, row, range.salt + 4);
        color.copy(range.low).lerp(range.high, THREE.MathUtils.smoothstep(altitude, .05, .55));
        color.lerp(range.crest, THREE.MathUtils.smoothstep(altitude, .6, .95) * (.55 + variation * .45));
        color.offsetHSL(0, 0, (variation - .5) * .05);
        colors[index] = color.r;
        colors[index + 1] = color.g;
        colors[index + 2] = color.b;
      }
    }
    const indices: number[] = [];
    for (let row = 0; row < RADIAL_STEPS; row++) {
      for (let column = 0; column < ANGULAR_STEPS; column++) {
        const next = (column + 1) % ANGULAR_STEPS;
        const a = row * ANGULAR_STEPS + column;
        const b = row * ANGULAR_STEPS + next;
        const c = (row + 1) * ANGULAR_STEPS + column;
        const d = (row + 1) * ANGULAR_STEPS + next;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    return geometry;
  }

  /** Low rows of concrete blocks gathered into a few shore districts; the hills reach the water between them. */
  private createHillsideBlocks(seed: number, range: Range, heightAt: (angle: number, radius: number) => number, open: (angle: number) => number) {
    const placements: THREE.Object3D[] = [];
    const tints = [0xa39f94, 0x9a978d, 0xaba49a, 0x969a92, 0xa89e96, 0x8e918b].map((tint) => new THREE.Color(tint));
    const district = ridgeProfile(seed, 37);
    const density = (angle: number) => THREE.MathUtils.smoothstep(district(angle), .5, .72);
    const shoreRadius = (angle: number) => {
      let low = range.inner;
      let high = range.inner + (range.outer - range.inner) * APRON_END;
      for (let step = 0; step < 16; step++) {
        const middle = (low + high) / 2;
        if (heightAt(angle, middle) < 0) low = middle; else high = middle;
      }
      return high;
    };
    const rows = [.8, 2.2, 3.6];
    const columns = Math.round(TAU * range.inner / 2);
    rows.forEach((offset, row) => {
      for (let column = 0; column < columns; column++) {
        const angle = (column + .5 + (hash(seed, column, row, 9701) - .5) * .4) / columns * TAU;
        if (open(angle) < .8 || hash(seed, column, row, 9700) > density(angle)) continue;
        const radius = shoreRadius(angle) + offset + (hash(seed, column, row, 9702) - .5) * .6;
        const depth = 1.4 + hash(seed, column, row, 9705) * .9;
        const footGround = heightAt(angle, radius - depth / 2) - .5;
        const buried = heightAt(angle, radius + depth / 2) - footGround;
        const block = new THREE.Object3D();
        block.position.set(Math.cos(angle) * radius, footGround, Math.sin(angle) * radius);
        block.lookAt(0, footGround, 0);
        const tall = hash(seed, column, row, 9703);
        const height = tall > .94 ? 3 + (tall - .94) * 25 : .7 + tall * 1.9;
        block.scale.set(1.8 + hash(seed, column, row, 9704) * 1.6, buried + height, depth);
        block.userData.buried = buried;
        block.updateMatrix();
        block.userData.tint = tints[Math.floor(hash(seed, column, row, 9706) * tints.length)].clone()
          .offsetHSL(0, 0, (hash(seed, column, row, 9707) - .5) * .06);
        placements.push(block);
      }
    });
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0), this.blockMaterial, placements.length);
    mesh.name = 'distant-hillside-blocks';
    placements.forEach((block, index) => {
      mesh.setMatrixAt(index, block.matrix);
      mesh.setColorAt(index, block.userData.tint);
    });
    return { mesh, placements };
  }

  private createGlints(seed: number, range: Range, heightAt: (angle: number, radius: number) => number, open: (angle: number) => number, blocks: THREE.Object3D[]) {
    const quad = new THREE.PlaneGeometry(.36, .24);
    const pieces: THREE.BufferGeometry[] = [];
    const matrix = new THREE.Matrix4();
    const rotation = new THREE.Quaternion();
    const unit = new THREE.Vector3(1, 1, 1);
    const position = new THREE.Vector3();
    const right = new THREE.Vector3();
    const toward = new THREE.Vector3();
    const placeGlint = (source: THREE.Object3D, lateral: number, height: number, forward: number) => {
      source.getWorldQuaternion(rotation);
      right.set(1, 0, 0).applyQuaternion(rotation);
      toward.set(0, 0, 1).applyQuaternion(rotation);
      position.copy(source.position).addScaledVector(right, lateral).addScaledVector(toward, forward);
      position.y += height;
      matrix.compose(position, rotation, unit);
      pieces.push(quad.clone().applyMatrix4(matrix));
    };
    blocks.forEach((block, blockIndex) => {
      const windows = 1 + Math.floor(hash(seed, blockIndex, 0, 9801) * 4);
      for (let window = 0; window < windows; window++) {
        const lateral = (hash(seed, blockIndex, window + 1, 9801) - .5) * (block.scale.x - .5);
        const buried: number = block.userData.buried;
        const height = buried + (block.scale.y - buried) * (.2 + hash(seed, blockIndex, window + 20, 9801) * .72);
        placeGlint(block, lateral, height, block.scale.z * .5 + .03);
      }
    });
    const house = new THREE.Object3D();
    for (let index = 0; index < 90; index++) {
      const angle = hash(seed, index, 0, 9802) * TAU;
      if (open(angle) < .8) continue;
      const radius = range.inner + 2 + hash(seed, index, 1, 9802) * (range.outer - range.inner) * .42;
      const ground = heightAt(angle, radius);
      if (ground < .5) continue;
      house.position.set(Math.cos(angle) * radius, ground, Math.sin(angle) * radius);
      house.lookAt(0, ground, 0);
      placeGlint(house, 0, .3 + hash(seed, index, 2, 9802) * .6, 0);
    }
    const material = new THREE.MeshBasicMaterial({ color: 0xffd08c, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(mergeGeometries(pieces), material);
    mesh.name = 'distant-city-window-glints';
    quad.dispose();
    return mesh;
  }

  private createRocks(seed: number, open: (angle: number) => number) {
    const rock = new THREE.Object3D();
    const matrices: THREE.Matrix4[] = [];
    for (let index = 0; index < 26; index++) {
      const angle = hash(seed, index, 0, 9901) * TAU;
      if (open(angle) < .9) continue;
      const radius = 52 + hash(seed, index, 1, 9901) * 68;
      rock.position.set(Math.cos(angle) * radius, -.7 + hash(seed, index, 2, 9901) * .3, Math.sin(angle) * radius);
      rock.rotation.set(hash(seed, index, 3, 9901) * .6, hash(seed, index, 4, 9901) * TAU, hash(seed, index, 5, 9901) * .6);
      const spread = 1 + hash(seed, index, 6, 9901) * 1.8;
      rock.scale.set(spread, .6 + hash(seed, index, 7, 9901) * 1, spread * (.6 + hash(seed, index, 8, 9901) * .6));
      rock.updateMatrix();
      matrices.push(rock.matrix.clone());
    }
    const material = new THREE.MeshStandardMaterial({ color: 0x272c2d, roughness: .96, flatShading: true });
    const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), material, matrices.length);
    mesh.name = 'harbor-background-rocks';
    matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    return mesh;
  }
}
