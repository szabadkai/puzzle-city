import * as THREE from 'three';
import { PALETTE_TEXTURE_WIDTH } from './palette';

/**
 * Uniforms shared by every standard material in the scene. Update the `value`
 * fields in place; each compiled program references these same objects.
 */
export const presentationUniforms = {
  uPalette: { value: null as THREE.Texture | null },
};

/** Marks a material whose vertex colour red channel is a palette slot index. */
export function usePaletteLookup<T extends THREE.Material>(material: T) {
  material.userData.paletteLookup = true;
  return material;
}

/** Encodes a palette slot as the vertex colour a palette-lookup material expects. */
export function paletteSlotColor(slot: number, target = new THREE.Color()) {
  return target.setRGB(slot / (PALETTE_TEXTURE_WIDTH - 1), 0, 0);
}

const PALETTE_LOOKUP = /* glsl */`
  diffuseColor.rgb *= texture2D( uPalette, vec2( ( vColor.r * ${(PALETTE_TEXTURE_WIDTH - 1).toFixed(1)} + 0.5 ) / ${PALETTE_TEXTURE_WIDTH.toFixed(1)}, 0.5 ) ).rgb;
`;

type Shader = Parameters<THREE.Material['onBeforeCompile']>[0];

function injectPresentation(this: THREE.Material, shader: Shader) {
  Object.assign(shader.uniforms, presentationUniforms);
  if (this.userData.paletteLookup) {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_pars_fragment>', '#include <color_pars_fragment>\nuniform sampler2D uPalette;')
      .replace('#include <color_fragment>', PALETTE_LOOKUP);
  }
}

function presentationCacheKey(this: THREE.Material) {
  return `little-tides:${this.userData.paletteLookup ? 'palette' : 'plain'}`;
}

/**
 * Installs the shared shader additions on every standard material. Materials are
 * created in many modules, so the hook lives on the prototype instead of at
 * each creation site.
 */
export function installPresentationShading() {
  THREE.MeshStandardMaterial.prototype.onBeforeCompile = injectPresentation;
  THREE.MeshStandardMaterial.prototype.customProgramCacheKey = presentationCacheKey;
}
