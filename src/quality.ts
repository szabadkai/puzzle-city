import * as THREE from 'three';

export type QualityTier = 'low' | 'mid' | 'high';

export type QualitySettings = Readonly<{
  tier: QualityTier;
  maxPixelRatio: number;
  shadowCascades: number;
  shadowMapSize: number;
  /** Ambient occlusion render scale relative to the frame. 0 disables the pass. */
  aoScale: number;
  reflection: 'sky' | 'half' | 'full';
  particleScale: number;
  depthOfField: boolean;
  pointLights: number;
  buildingTarget: number;
}>;

const TIER_KEY = 'little-tides-quality-tier';

export const QUALITY_SETTINGS: Record<QualityTier, QualitySettings> = {
  low: {
    tier: 'low',
    maxPixelRatio: 1,
    shadowCascades: 1,
    shadowMapSize: 1024,
    aoScale: .25,
    reflection: 'sky',
    particleScale: .3,
    depthOfField: false,
    pointLights: 0,
    buildingTarget: 200,
  },
  mid: {
    tier: 'mid',
    maxPixelRatio: 1.5,
    shadowCascades: 2,
    shadowMapSize: 2048,
    aoScale: .5,
    reflection: 'half',
    particleScale: 1,
    depthOfField: true,
    pointLights: 8,
    buildingTarget: 400,
  },
  high: {
    tier: 'high',
    maxPixelRatio: 2,
    shadowCascades: 2,
    shadowMapSize: 4096,
    aoScale: 1,
    reflection: 'full',
    particleScale: 1,
    depthOfField: true,
    pointLights: 16,
    buildingTarget: 800,
  },
};

export function storedTierOverride(): QualityTier | null {
  const fromUrl = new URLSearchParams(location.search).get('tier');
  if (fromUrl === 'low' || fromUrl === 'mid' || fromUrl === 'high') return fromUrl;
  try {
    const stored = localStorage.getItem(TIER_KEY);
    return stored === 'low' || stored === 'mid' || stored === 'high' ? stored : null;
  } catch {
    return null;
  }
}

export function storeTierOverride(tier: QualityTier | null) {
  try {
    if (tier) localStorage.setItem(TIER_KEY, tier);
    else localStorage.removeItem(TIER_KEY);
  } catch {
    // Private browsing can refuse storage. The tier still applies to this session.
  }
}

function rendererName(renderer: THREE.WebGLRenderer) {
  const gl = renderer.getContext();
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  const name = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return String(name ?? '').toLowerCase();
}

/**
 * Guess a starting tier from the GPU string, core count, and screen density.
 * `refineTier` corrects the guess after the first second of measured frames.
 */
export function guessTier(renderer: THREE.WebGLRenderer): QualityTier {
  const gpu = rendererName(renderer);
  const cores = navigator.hardwareConcurrency ?? 4;
  const mobile = /android|iphone|ipad|mobile/i.test(navigator.userAgent) || navigator.maxTouchPoints > 1;
  const desktopDiscrete = /nvidia|geforce|rtx|gtx|radeon|rx \d|arc\b/.test(gpu) && !mobile;
  if (desktopDiscrete) return 'high';
  const softwareRenderer = /swiftshader|llvmpipe|software|mesa offscreen/.test(gpu);
  if (softwareRenderer) return 'low';
  const olderMobileGpu = /adreno \(tm\) [56]\d\d|mali-g[57]\d\b|mali-t|apple a1[0-3]\b|powervr/.test(gpu);
  if (olderMobileGpu) return 'low';
  if (mobile) return cores <= 4 ? 'low' : 'mid';
  if (/apple m\d|apple gpu/.test(gpu)) return 'mid';
  return cores >= 8 ? 'mid' : 'low';
}

/** Demote one tier when the first second of frames misses the target budget. */
export function refineTier(tier: QualityTier, averageFrameMs: number): QualityTier {
  if (tier === 'high' && averageFrameMs > 20) return 'mid';
  if (tier === 'mid' && averageFrameMs > 26) return 'low';
  return tier;
}

type PendingQuery = { name: string; query: WebGLQuery; frame: number };

/**
 * Measures GPU time per named section with EXT_disjoint_timer_query_webgl2.
 * Results arrive a few frames late, so read `times` as a rolling report.
 */
export class GpuTimer {
  readonly times: Record<string, number> = {};
  readonly supported: boolean;
  private readonly gl: WebGL2RenderingContext | null;
  private readonly extension: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  private readonly pending: PendingQuery[] = [];
  private active: WebGLQuery | null = null;
  private frame = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    const gl = renderer.getContext();
    this.gl = gl instanceof WebGL2RenderingContext ? gl : null;
    this.extension = this.gl?.getExtension('EXT_disjoint_timer_query_webgl2') ?? null;
    this.supported = Boolean(this.gl && this.extension);
  }

  begin(name: string) {
    if (!this.gl || !this.extension || this.active) return;
    const query = this.gl.createQuery();
    if (!query) return;
    this.gl.beginQuery(this.extension.TIME_ELAPSED_EXT, query);
    this.active = query;
    this.pending.push({ name, query, frame: this.frame });
  }

  end() {
    if (!this.gl || !this.extension || !this.active) return;
    this.gl.endQuery(this.extension.TIME_ELAPSED_EXT);
    this.active = null;
  }

  /** Call once per frame after rendering to collect finished queries. */
  collect() {
    this.frame += 1;
    if (!this.gl || !this.extension) return;
    const gl = this.gl;
    const disjoint = gl.getParameter(this.extension.GPU_DISJOINT_EXT) as boolean;
    for (let index = this.pending.length - 1; index >= 0; index--) {
      const entry = this.pending[index];
      const available = gl.getQueryParameter(entry.query, gl.QUERY_RESULT_AVAILABLE) as boolean;
      const stale = this.frame - entry.frame > 8;
      if (!available && !stale) continue;
      if (available && !disjoint) {
        const nanoseconds = gl.getQueryParameter(entry.query, gl.QUERY_RESULT) as number;
        const milliseconds = nanoseconds / 1e6;
        const previous = this.times[entry.name] ?? milliseconds;
        this.times[entry.name] = previous + (milliseconds - previous) * .15;
      }
      gl.deleteQuery(entry.query);
      this.pending.splice(index, 1);
    }
  }
}
