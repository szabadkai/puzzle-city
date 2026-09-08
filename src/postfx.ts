import * as THREE from 'three';
import {
  BlendFunction,
  BloomEffect,
  DepthOfFieldEffect,
  Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  ToneMappingEffect,
  ToneMappingMode,
  type Pass,
} from 'postprocessing';
import { N8AOPostPass } from 'n8ao';
import type { GpuTimer } from './quality';
import type { QualitySettings } from './quality';

export type DepthOfFieldPreset = 'off' | 'tilt-shift' | 'cinematic';

/** Scene exposure applied before bloom and tone mapping. */
class ExposureEffect extends Effect {
  constructor() {
    super('ExposureEffect', /* glsl */`
      uniform float exposure;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        outputColor = vec4(inputColor.rgb * exposure, inputColor.a);
      }
    `, { blendFunction: BlendFunction.SET, uniforms: new Map([['exposure', new THREE.Uniform(1)]]) });
  }

  set exposure(value: number) { this.uniforms.get('exposure')!.value = value; }
}

/** Lifts blacks after tone mapping so shadows never reach pure black, and grades saturation. */
class LiftEffect extends Effect {
  constructor() {
    super('LiftEffect', /* glsl */`
      uniform float lift;
      uniform vec3 liftTint;
      uniform float saturation;
      void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
        vec3 lifted = liftTint * lift + inputColor.rgb * (1.0 - lift);
        float luma = dot(lifted, vec3(0.2126, 0.7152, 0.0722));
        outputColor = vec4(mix(vec3(luma), lifted, saturation), inputColor.a);
      }
    `, {
      blendFunction: BlendFunction.SET,
      uniforms: new Map<string, THREE.Uniform>([
        ['lift', new THREE.Uniform(.035)],
        ['liftTint', new THREE.Uniform(new THREE.Color(.5, .45, .6))],
        ['saturation', new THREE.Uniform(1)],
      ]),
    });
  }

  setLift(amount: number, tint: THREE.Color) {
    this.uniforms.get('lift')!.value = amount;
    (this.uniforms.get('liftTint')!.value as THREE.Color).copy(tint);
  }

  set saturation(value: number) { this.uniforms.get('saturation')!.value = value; }
}

/**
 * Shadow maps → scene → ambient occlusion → bloom → depth of field →
 * tone mapping → lift, merged into as few passes as postprocessing allows.
 */
export class PostPipeline {
  readonly composer: EffectComposer;
  readonly ao: N8AOPostPass | null;
  private readonly renderPass: RenderPass;
  private readonly exposure = new ExposureEffect();
  private readonly lift = new LiftEffect();
  private readonly bloom: BloomEffect;
  private readonly depthOfField: DepthOfFieldEffect | null;
  private readonly effectPass: EffectPass;
  /** Same chain with depth of field merged in. Only one of the two passes is enabled. */
  private readonly effectPassWithDepthOfField: EffectPass | null;
  private readonly antialiasPass: EffectPass | null;
  private depthOfFieldPreset: DepthOfFieldPreset = 'off';
  /** Draw calls issued by shadow maps plus the main scene in the last frame. */
  sceneDrawCalls = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    private readonly camera: THREE.PerspectiveCamera,
    quality: QualitySettings,
    timer: GpuTimer,
  ) {
    const multisampling = quality.tier === 'low' ? 0 : 4;
    this.composer = new EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType, multisampling });
    // The enabled effect pass presents the frame; a disabled pass must never own the screen.
    this.composer.autoRenderToScreen = false;
    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    if (quality.aoScale > 0) {
      const size = renderer.getDrawingBufferSize(new THREE.Vector2());
      this.ao = new N8AOPostPass(scene, camera, size.x, size.y);
      this.ao.configuration.aoRadius = 1.6;
      this.ao.configuration.distanceFalloff = 1.2;
      this.ao.configuration.intensity = 3.2;
      this.ao.configuration.halfRes = quality.aoScale < 1;
      this.ao.configuration.screenSpaceRadius = false;
      this.ao.setQualityMode(quality.tier === 'high' ? 'Medium' : quality.tier === 'mid' ? 'Low' : 'Performance');
      this.composer.addPass(this.ao);
    } else {
      this.ao = null;
    }

    this.bloom = new BloomEffect({
      luminanceThreshold: 1.25,
      luminanceSmoothing: .35,
      mipmapBlur: true,
      intensity: .55,
      radius: .62,
      levels: quality.tier === 'low' ? 5 : 7,
    });
    this.depthOfField = quality.depthOfField
      ? new DepthOfFieldEffect(camera, { focusDistance: 24, focusRange: 14, bokehScale: 2.2, resolutionScale: .5 })
      : null;
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });
    this.effectPass = new EffectPass(camera, this.exposure, this.bloom, toneMapping, this.lift);
    this.composer.addPass(this.effectPass);
    this.effectPassWithDepthOfField = this.depthOfField
      ? new EffectPass(camera, this.exposure, this.bloom, this.depthOfField, toneMapping, this.lift)
      : null;
    if (this.effectPassWithDepthOfField) {
      this.effectPassWithDepthOfField.enabled = false;
      this.composer.addPass(this.effectPassWithDepthOfField);
    }
    this.antialiasPass = multisampling === 0 ? new EffectPass(camera, new SMAAEffect()) : null;
    if (this.antialiasPass) this.composer.addPass(this.antialiasPass);
    this.setDepthOfField('off');
    this.timePasses(timer);
  }

  private timePasses(timer: GpuTimer) {
    const names = new Map<Pass, string>([[this.renderPass, 'scene'], [this.effectPass, 'effects']]);
    if (this.ao) names.set(this.ao, 'ao');
    if (this.effectPassWithDepthOfField) names.set(this.effectPassWithDepthOfField, 'effects');
    for (const pass of this.composer.passes) {
      const name = names.get(pass) ?? 'smaa';
      const original = pass.render.bind(pass);
      pass.render = (...args: Parameters<Pass['render']>) => {
        timer.begin(name);
        original(...args);
        timer.end();
        if (pass === this.renderPass) this.sceneDrawCalls = this.renderer.info.render.calls;
      };
    }
  }

  setSize(width: number, height: number) {
    this.composer.setSize(width, height);
  }

  setExposure(value: number) {
    this.exposure.exposure = value;
  }

  setLift(amount: number, tint: THREE.Color) {
    this.lift.setLift(amount, tint);
  }

  setSaturation(value: number) {
    this.lift.saturation = value;
  }

  setAmbientOcclusionColor(color: THREE.Color) {
    if (this.ao) this.ao.configuration.color.copy(color);
  }

  get depthOfFieldAvailable() { return this.depthOfField !== null; }

  get depthOfFieldMode() { return this.depthOfFieldPreset; }

  setDepthOfField(preset: DepthOfFieldPreset) {
    this.depthOfFieldPreset = this.depthOfField ? preset : 'off';
    if (!this.depthOfField || !this.effectPassWithDepthOfField) {
      this.assignScreenPass();
      return;
    }
    const active = this.depthOfFieldPreset !== 'off';
    this.effectPass.enabled = !active;
    this.effectPassWithDepthOfField.enabled = active;
    this.depthOfField.bokehScale = preset === 'tilt-shift' ? 3.4 : 1.6;
    this.assignScreenPass();
  }

  private assignScreenPass() {
    const presenting = this.antialiasPass ?? (this.effectPassWithDepthOfField?.enabled ? this.effectPassWithDepthOfField : this.effectPass);
    for (const pass of [this.effectPass, this.effectPassWithDepthOfField, this.antialiasPass]) {
      if (pass) pass.renderToScreen = pass === presenting;
    }
  }

  /** Keeps the focus plane on the orbit target. */
  focusOn(target: THREE.Vector3) {
    if (!this.depthOfField || this.depthOfFieldPreset === 'off') return;
    const distance = this.camera.position.distanceTo(target);
    const cocMaterial = this.depthOfField.cocMaterial;
    cocMaterial.worldFocusDistance = distance;
    cocMaterial.worldFocusRange = this.depthOfFieldPreset === 'tilt-shift' ? distance * .18 : distance * .55;
  }

  render(deltaSeconds: number) {
    this.composer.render(deltaSeconds);
  }

  dispose() {
    this.composer.dispose();
    this.renderer.setRenderTarget(null);
  }
}
