/**
 * Capture helpers for photo mode: still composition with a wordmark, sharing
 * or downloading files, and clip recording through WebCodecs with a
 * MediaRecorder fallback.
 */

export const CLIP_FPS = 30;
export const WORDMARK_TEXT = 'Little Tides';

export type ClipResult = { blob: Blob; extension: 'mp4' | 'webm'; mimeType: string };

export function drawWordmark(context: CanvasRenderingContext2D, width: number, height: number, alpha: number, url: string) {
  if (alpha <= 0) return;
  const shortEdge = Math.min(width, height);
  const margin = Math.round(shortEdge * .05);
  const titleSize = Math.round(shortEdge * .046);
  const urlSize = Math.round(shortEdge * .022);
  context.save();
  context.globalAlpha = alpha;
  context.textBaseline = 'alphabetic';
  context.textAlign = 'left';
  context.shadowColor = 'rgba(8, 20, 24, .55)';
  context.shadowBlur = shortEdge * .012;
  context.shadowOffsetY = shortEdge * .002;
  context.fillStyle = '#fff6df';
  context.font = `600 ${titleSize}px Fraunces, Georgia, serif`;
  context.fillText(WORDMARK_TEXT, margin, height - margin - urlSize * 1.6);
  context.font = `500 ${urlSize}px "DM Sans", system-ui, sans-serif`;
  context.fillStyle = 'rgba(255, 246, 223, .9)';
  context.fillText(url, margin, height - margin);
  context.restore();
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png', quality?: number) {
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('The image could not be encoded.'));
  }, type, quality));
}

/** Copies a rendered frame into a PNG, with the wordmark in the corner. */
export async function composeStill(source: HTMLCanvasElement, wordmark: boolean, url: string) {
  const output = document.createElement('canvas');
  output.width = source.width;
  output.height = source.height;
  const context = output.getContext('2d');
  if (!context) throw new Error('The image could not be created.');
  context.drawImage(source, 0, 0);
  if (wordmark) drawWordmark(context, output.width, output.height, 1, url);
  return canvasToBlob(output);
}

export function downloadBlob(blob: Blob, filename: string) {
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

export function canShareFiles(files: File[]) {
  return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files });
}

/**
 * Sends the file to the system share sheet when the browser allows file sharing,
 * otherwise downloads it. Returns how it was delivered.
 */
export async function deliverFile(blob: Blob, filename: string, text?: string, url?: string): Promise<'shared' | 'downloaded' | 'cancelled'> {
  const file = new File([blob], filename, { type: blob.type });
  if (canShareFiles([file])) {
    try {
      await navigator.share({ files: [file], text, url, title: WORDMARK_TEXT });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }
  downloadBlob(blob, filename);
  return 'downloaded';
}

export function webCodecsAvailable() {
  return typeof VideoEncoder === 'function' && typeof VideoFrame === 'function';
}

type StoredChunk = { chunk: EncodedVideoChunk; meta?: EncodedVideoChunkMetadata; timestamp: number };

type EncoderChoice = { codec: string; container: 'mp4' | 'webm' };

async function chooseEncoder(width: number, height: number): Promise<EncoderChoice | null> {
  const candidates: EncoderChoice[] = [
    { codec: 'avc1.4d0028', container: 'mp4' },
    { codec: 'avc1.42002a', container: 'mp4' },
    { codec: 'vp09.00.40.08', container: 'webm' },
    { codec: 'vp8', container: 'webm' },
  ];
  for (const candidate of candidates) {
    try {
      const support = await VideoEncoder.isConfigSupported({ codec: candidate.codec, width, height, framerate: CLIP_FPS, bitrate: 9_000_000 });
      if (support.supported) return candidate;
    } catch {
      // The next candidate may still work.
    }
  }
  return null;
}

/**
 * Encodes frames at a fixed 30 fps into a ring buffer of encoded chunks, so
 * the last N seconds are always ready to mux. Frames come from a compositing
 * canvas so the wordmark can fade in on the final second.
 */
export class ClipRecorder {
  private encoder: VideoEncoder | null = null;
  private choice: EncoderChoice | null = null;
  private readonly chunks: StoredChunk[] = [];
  /** The encoder describes itself only on its first chunk. The ring buffer drops that chunk, so keep the description. */
  private decoderConfig: VideoDecoderConfig | null = null;
  private readonly compositor = document.createElement('canvas');
  private frameIndex = 0;
  private elapsed = 0;
  private lastSlot = -1;
  private failed: Error | null = null;
  /** Frames actually encoded. Useful when judging clip smoothness. */
  frames = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    /** Seconds of footage to keep. Null keeps everything, for offline renders. */
    private readonly ringSeconds: number | null,
    private readonly url: string,
  ) {
    this.compositor.width = width;
    this.compositor.height = height;
  }

  get ready() { return this.encoder !== null && this.failed === null; }

  get container() { return this.choice?.container ?? 'mp4'; }

  get recordedSeconds() {
    if (this.chunks.length < 2) return 0;
    return (this.chunks[this.chunks.length - 1].timestamp - this.chunks[0].timestamp) / 1e6 + 1 / CLIP_FPS;
  }

  async start() {
    this.choice = await chooseEncoder(this.width, this.height);
    if (!this.choice) throw new Error('No video encoder is available.');
    this.encoder = new VideoEncoder({
      output: (chunk, meta) => {
        if (meta?.decoderConfig) this.decoderConfig = meta.decoderConfig;
        this.chunks.push({ chunk, meta, timestamp: chunk.timestamp });
        this.prune();
      },
      error: (error) => { this.failed = error; },
    });
    this.encoder.configure({
      codec: this.choice.codec,
      width: this.width,
      height: this.height,
      framerate: CLIP_FPS,
      bitrate: this.width * this.height >= 1080 * 1920 ? 10_000_000 : 6_000_000,
      latencyMode: 'realtime',
      ...(this.choice.container === 'mp4' ? { avc: { format: 'avc' as const } } : {}),
    });
  }

  /**
   * Adds one frame per 1/30 s slot of real time. Timestamps follow the slots,
   * so a frame the game could not deliver becomes a short hold rather than a
   * speed-up. Pass `force` to add exactly one frame regardless, for offline renders.
   */
  captureFrame(source: HTMLCanvasElement, deltaSeconds: number, wordmarkAlpha: number, force = false) {
    if (!this.encoder || this.failed) return false;
    let slot: number;
    if (force) {
      slot = this.lastSlot + 1;
    } else {
      this.elapsed += deltaSeconds;
      slot = Math.round(this.elapsed * CLIP_FPS);
      if (slot <= this.lastSlot) return false;
    }
    if (this.encoder.encodeQueueSize > 6) return false;
    this.lastSlot = slot;
    // The plain frame copies straight from the WebGL canvas; the compositor only serves the wordmark.
    let image: CanvasImageSource = source;
    if (wordmarkAlpha > 0 || source.width !== this.width || source.height !== this.height) {
      const context = this.compositor.getContext('2d')!;
      context.drawImage(source, 0, 0, this.width, this.height);
      drawWordmark(context, this.width, this.height, wordmarkAlpha, this.url);
      image = this.compositor;
    }
    const frame = new VideoFrame(image, { timestamp: Math.round(slot * 1e6 / CLIP_FPS), duration: Math.round(1e6 / CLIP_FPS) });
    this.encoder.encode(frame, { keyFrame: this.frameIndex % CLIP_FPS === 0 });
    frame.close();
    this.frameIndex += 1;
    this.frames += 1;
    return true;
  }

  /** Drops whole keyframe groups older than the ring length. */
  private prune() {
    if (this.ringSeconds === null) return;
    const limit = (this.ringSeconds + 1) * 1e6;
    while (this.chunks.length > 1) {
      const newest = this.chunks[this.chunks.length - 1].timestamp;
      const nextKey = this.chunks.findIndex((entry, index) => index > 0 && entry.chunk.type === 'key');
      if (nextKey === -1 || newest - this.chunks[nextKey].timestamp < limit) break;
      this.chunks.splice(0, nextKey);
    }
  }

  /** Flushes the encoder and muxes the retained chunks into a file. */
  async finish(keepSeconds: number | null = this.ringSeconds): Promise<ClipResult> {
    if (!this.encoder || !this.choice) throw new Error('The recorder was not started.');
    if (this.failed) throw this.failed;
    await this.encoder.flush();
    this.encoder.close();
    this.encoder = null;
    let retained = this.chunks;
    if (keepSeconds !== null && retained.length) {
      const newest = retained[retained.length - 1].timestamp;
      const firstIndex = retained.findIndex((entry) => newest - entry.timestamp <= keepSeconds * 1e6);
      let start = Math.max(0, firstIndex);
      while (start > 0 && retained[start].chunk.type !== 'key') start -= 1;
      retained = retained.slice(start);
    }
    if (!retained.length) throw new Error('Nothing was recorded.');
    const first = retained[0];
    if (!first.meta?.decoderConfig && this.decoderConfig) retained[0] = { ...first, meta: { ...first.meta, decoderConfig: this.decoderConfig } };
    const container = this.choice.container;
    if (container === 'mp4') {
      const { Muxer, ArrayBufferTarget } = await import('mp4-muxer');
      const muxer = new Muxer({
        target: new ArrayBufferTarget(),
        video: { codec: 'avc', width: this.width, height: this.height, frameRate: CLIP_FPS },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
      });
      for (const entry of retained) muxer.addVideoChunk(entry.chunk, entry.meta);
      muxer.finalize();
      return { blob: new Blob([muxer.target.buffer], { type: 'video/mp4' }), extension: 'mp4', mimeType: 'video/mp4' };
    }
    const { Muxer, ArrayBufferTarget } = await import('webm-muxer');
    const muxer = new Muxer({
      target: new ArrayBufferTarget(),
      video: { codec: this.choice.codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width: this.width, height: this.height, frameRate: CLIP_FPS },
      firstTimestampBehavior: 'offset',
    });
    for (const entry of retained) muxer.addVideoChunk(entry.chunk, entry.meta);
    muxer.finalize();
    return { blob: new Blob([muxer.target.buffer], { type: 'video/webm' }), extension: 'webm', mimeType: 'video/webm' };
  }

  dispose() {
    try {
      this.encoder?.close();
    } catch {
      // Closing an errored encoder throws; nothing else to release.
    }
    this.encoder = null;
    this.chunks.length = 0;
  }
}

/**
 * Fallback for browsers without WebCodecs: records the compositing canvas
 * forward for a fixed number of seconds with MediaRecorder.
 */
export class ForwardRecorder {
  private readonly compositor = document.createElement('canvas');
  private recorder: MediaRecorder | null = null;
  private readonly parts: Blob[] = [];
  private mimeType = '';

  constructor(readonly width: number, readonly height: number, private readonly url: string, private readonly audio: MediaStream | null) {
    this.compositor.width = width;
    this.compositor.height = height;
  }

  static supported() {
    return typeof MediaRecorder === 'function' && typeof HTMLCanvasElement.prototype.captureStream === 'function';
  }

  start() {
    const stream = this.compositor.captureStream(CLIP_FPS);
    for (const track of this.audio?.getAudioTracks() ?? []) stream.addTrack(track);
    this.mimeType = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((type) => MediaRecorder.isTypeSupported(type)) ?? '';
    this.recorder = new MediaRecorder(stream, this.mimeType ? { mimeType: this.mimeType, videoBitsPerSecond: 8_000_000 } : undefined);
    this.recorder.ondataavailable = (event) => { if (event.data.size) this.parts.push(event.data); };
    this.recorder.start(250);
  }

  captureFrame(source: HTMLCanvasElement, wordmarkAlpha: number) {
    const context = this.compositor.getContext('2d')!;
    context.drawImage(source, 0, 0, this.width, this.height);
    drawWordmark(context, this.width, this.height, wordmarkAlpha, this.url);
  }

  finish(): Promise<ClipResult> {
    return new Promise((resolve, reject) => {
      const recorder = this.recorder;
      if (!recorder) {
        reject(new Error('The recorder was not started.'));
        return;
      }
      recorder.onstop = () => {
        const type = recorder.mimeType || this.mimeType || 'video/webm';
        const extension = type.includes('mp4') ? 'mp4' : 'webm';
        resolve({ blob: new Blob(this.parts, { type }), extension, mimeType: type });
      };
      recorder.onerror = () => reject(new Error('Recording failed.'));
      recorder.stop();
    });
  }
}

export async function requestWakeLock() {
  try {
    return await navigator.wakeLock?.request('screen') ?? null;
  } catch {
    return null;
  }
}
