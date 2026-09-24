// Visual capture test. Loads a fixture town through a #t= share code, takes
// three default portrait screenshots, downscales them to 200 px with a Lanczos
// filter, writes a contact sheet next to any reference thumbnails, and checks
// the draw-call and frame-time budgets published on window.__perf.
//
//   npm run capture-test            # production build in dist/ (built when missing)
//   npm run capture-test -- --dev   # live Vite dev server
//   npm run capture-test -- --webkit
//   CAPTURE_STRICT=1                # exit 1 when a budget check fails
//   CAPTURE_GL=swiftshader|angle    # GL backend for Chromium (default: swiftshader on Linux)
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'test-output');
const referenceDir = path.join(root, 'scripts', 'capture-reference');
const args = new Set(process.argv.slice(2));
const useDev = args.has('--dev');
const withWebkit = args.has('--webkit');
const strict = process.env.CAPTURE_STRICT === '1';
const budgets = { drawCalls: 150, frameMs: 33.4 };
const THUMB_WIDTH = 200;
const PHONE = { width: 375, height: 812, deviceScaleFactor: 2 };

mkdirSync(outputDir, { recursive: true });

function fixtureTown() {
  const cells = [];
  let seedState = 1234567;
  const random = () => {
    seedState = (seedState * 1664525 + 1013904223) >>> 0;
    return seedState / 4294967296;
  };
  for (let x = -7; x <= 7; x++) {
    for (let z = -7; z <= 7; z++) {
      if (Math.hypot(x, z) > 8.3) continue;
      const canalRow = z % 3 === 0 && x % 2 !== 0;
      const canalColumn = x % 4 === 0 && z % 2 !== 0;
      if (canalRow || canalColumn) continue;
      if (random() < .18) continue;
      const height = 1 + Math.floor(random() * 3) + (Math.abs(x) + Math.abs(z) < 3 ? 1 : 0);
      cells.push({ x, z, height: Math.min(5, height), color: Math.floor(random() * 8), placedAt: 0, foundedAt: 0, renovatedAt: 0 });
    }
  }
  return {
    version: 10,
    seed: 20260908,
    // Current saves need Voyage state; otherwise the app correctly starts a fresh harbor.
    campaign: { version: 1, mode: 'sandbox', completed: 18, ready: false, sandboxUnlocked: true },
    cells,
    timeOfDay: 17.5,
    day: 3,
    onboardingDismissed: true,
    placeIntroductionSeen: true,
  };
}

function shareCode(town) {
  return deflateRawSync(Buffer.from(JSON.stringify(town))).toString('base64url');
}

async function startServer() {
  const vite = await import('vite');
  if (useDev) {
    const server = await vite.createServer({ root, server: { port: 0 }, logLevel: 'error' });
    await server.listen();
    return { url: server.resolvedUrls.local[0], close: () => server.close() };
  }
  if (!existsSync(path.join(root, 'dist', 'index.html'))) await vite.build({ root, logLevel: 'error' });
  const server = await vite.preview({ root, preview: { port: 0 }, logLevel: 'error' });
  return { url: server.resolvedUrls.local[0], close: () => new Promise((resolve) => server.httpServer.close(resolve)) };
}

function chromiumArgs() {
  const backend = process.env.CAPTURE_GL ?? (process.platform === 'linux' ? 'swiftshader' : 'angle');
  const common = ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  if (backend === 'swiftshader') return [...common, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  return [...common, '--use-gl=angle'];
}

// Runs inside the browser. Separable Lanczos-3 resample of an RGBA image.
const pageHelpers = `
  function lanczos(x, a = 3) {
    if (x === 0) return 1;
    if (Math.abs(x) >= a) return 0;
    const px = Math.PI * x;
    return a * Math.sin(px) * Math.sin(px / a) / (px * px);
  }
  function resampleAxis(source, sourceWidth, sourceHeight, targetWidth) {
    const target = new Float32Array(targetWidth * sourceHeight * 4);
    const scale = sourceWidth / targetWidth;
    const support = 3 * Math.max(1, scale);
    for (let tx = 0; tx < targetWidth; tx++) {
      const center = (tx + .5) * scale - .5;
      const start = Math.max(0, Math.floor(center - support));
      const end = Math.min(sourceWidth - 1, Math.ceil(center + support));
      const weights = [];
      let total = 0;
      for (let sx = start; sx <= end; sx++) {
        const weight = lanczos((sx - center) / Math.max(1, scale));
        weights.push(weight);
        total += weight;
      }
      for (let y = 0; y < sourceHeight; y++) {
        let r = 0, g = 0, b = 0, alpha = 0;
        for (let sx = start, w = 0; sx <= end; sx++, w++) {
          const weight = weights[w] / total;
          const index = (y * sourceWidth + sx) * 4;
          r += source[index] * weight;
          g += source[index + 1] * weight;
          b += source[index + 2] * weight;
          alpha += source[index + 3] * weight;
        }
        const out = (y * targetWidth + tx) * 4;
        target[out] = r; target[out + 1] = g; target[out + 2] = b; target[out + 3] = alpha;
      }
    }
    return target;
  }
  function transpose(data, width, height) {
    const out = new Float32Array(data.length);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const from = (y * width + x) * 4;
      const to = (x * height + y) * 4;
      out[to] = data[from]; out[to + 1] = data[from + 1]; out[to + 2] = data[from + 2]; out[to + 3] = data[from + 3];
    }
    return out;
  }
  async function loadImage(dataUrl) {
    const image = new Image();
    image.src = dataUrl;
    await image.decode();
    return image;
  }
  window.__lanczosResize = async (dataUrl, targetWidth) => {
    const image = await loadImage(dataUrl);
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d');
    context.drawImage(image, 0, 0);
    const source = Float32Array.from(context.getImageData(0, 0, canvas.width, canvas.height).data);
    const targetHeight = Math.round(canvas.height * targetWidth / canvas.width);
    const horizontal = resampleAxis(source, canvas.width, canvas.height, targetWidth);
    const vertical = resampleAxis(transpose(horizontal, targetWidth, canvas.height), canvas.height, targetWidth, targetHeight);
    const result = transpose(vertical, targetHeight, targetWidth);
    const output = document.createElement('canvas');
    output.width = targetWidth;
    output.height = targetHeight;
    const imageData = output.getContext('2d').createImageData(targetWidth, targetHeight);
    for (let index = 0; index < result.length; index++) imageData.data[index] = Math.max(0, Math.min(255, Math.round(result[index])));
    output.getContext('2d').putImageData(imageData, 0, 0);
    return output.toDataURL('image/png');
  };
  window.__contactSheet = async (entries, thumbWidth) => {
    const images = await Promise.all(entries.map(async (entry) => ({ ...entry, image: await loadImage(entry.dataUrl) })));
    const gap = 16;
    const labelHeight = 26;
    const thumbHeight = Math.max(...images.map((entry) => Math.round(entry.image.naturalHeight * thumbWidth / entry.image.naturalWidth)));
    const canvas = document.createElement('canvas');
    canvas.width = gap + images.length * (thumbWidth + gap);
    canvas.height = gap + thumbHeight + labelHeight + gap;
    const context = canvas.getContext('2d');
    context.fillStyle = '#1b1b1b';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.font = '13px system-ui, sans-serif';
    context.fillStyle = '#e8e2d2';
    images.forEach((entry, index) => {
      const x = gap + index * (thumbWidth + gap);
      const height = Math.round(entry.image.naturalHeight * thumbWidth / entry.image.naturalWidth);
      context.drawImage(entry.image, x, gap + (thumbHeight - height) / 2, thumbWidth, height);
      context.fillText(entry.label, x, gap + thumbHeight + 18);
    });
    return canvas.toDataURL('image/png');
  };
`;

function shuffle(items, seed) {
  const result = [...items];
  let state = seed;
  for (let index = result.length - 1; index > 0; index--) {
    state = (state * 1103515245 + 12345) >>> 0;
    const swap = state % (index + 1);
    [result[index], result[swap]] = [result[swap], result[index]];
  }
  return result;
}

async function captureWith(browserType, name, url, code) {
  const { chromium, webkit } = await import('playwright');
  const launcher = browserType === 'webkit' ? webkit : chromium;
  const browser = await launcher.launch(browserType === 'chromium' ? { args: chromiumArgs() } : {});
  const page = await browser.newPage({ viewport: { width: PHONE.width, height: PHONE.height }, deviceScaleFactor: PHONE.deviceScaleFactor, isMobile: browserType === 'chromium', hasTouch: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${url}#t=${code}`, { waitUntil: 'load' });
  // Ten seconds lets the drift camera settle into its default framing.
  await page.waitForTimeout(10_000);
  const shots = [];
  for (let index = 0; index < 3; index++) {
    const file = path.join(outputDir, `${name}-shot-${index + 1}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
    await page.waitForTimeout(1500);
  }
  await page.keyboard.press('p');
  await page.waitForTimeout(1600);
  const perf = await page.evaluate(() => window.__perf ?? null);
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const info = gl?.getExtension('WEBGL_debug_renderer_info');
    return gl && info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : 'unknown';
  });
  const cellCount = await page.evaluate(() => JSON.parse(localStorage.getItem('little-tides-town-v1') ?? '{}').cells?.length ?? 0);

  const helper = await browser.newPage();
  await helper.setContent('<!doctype html><title>capture</title>');
  await helper.addScriptTag({ content: pageHelpers });
  const thumbs = [];
  for (const [index, file] of shots.entries()) {
    const dataUrl = `data:image/png;base64,${readFileSync(file).toString('base64')}`;
    const thumb = await helper.evaluate(([source, width]) => window.__lanczosResize(source, width), [dataUrl, THUMB_WIDTH]);
    const thumbFile = path.join(outputDir, `${name}-thumb-${index + 1}.png`);
    writeFileSync(thumbFile, Buffer.from(thumb.split(',')[1], 'base64'));
    thumbs.push({ label: `Little Tides ${index + 1}`, dataUrl: thumb });
  }
  const references = existsSync(referenceDir)
    ? readdirSync(referenceDir).filter((file) => /\.(png|jpe?g|webp)$/i.test(file)).map((file) => ({
      label: path.parse(file).name,
      dataUrl: `data:image/${path.extname(file).slice(1).replace('jpg', 'jpeg')};base64,${readFileSync(path.join(referenceDir, file)).toString('base64')}`,
    }))
    : [];
  const referenceThumbs = [];
  for (const reference of references) {
    referenceThumbs.push({ label: reference.label, dataUrl: await helper.evaluate(([source, width]) => window.__lanczosResize(source, width), [reference.dataUrl, THUMB_WIDTH]) });
  }
  const sheet = await helper.evaluate(([entries, width]) => window.__contactSheet(entries, width), [shuffle([...thumbs, ...referenceThumbs], 7), THUMB_WIDTH]);
  writeFileSync(path.join(outputDir, `${name}-contact-sheet.png`), Buffer.from(sheet.split(',')[1], 'base64'));
  await browser.close();
  return { browser: browserType, gpu, cellCount, perf, errors, referenceCount: references.length };
}

const server = await startServer();
const town = fixtureTown();
const code = shareCode(town);
const results = [];
let failed = false;
try {
  results.push(await captureWith('chromium', 'chromium', server.url, code));
  if (withWebkit) results.push(await captureWith('webkit', 'webkit', server.url, code));
} finally {
  await server.close();
}

for (const result of results) {
  const software = /swiftshader|llvmpipe|software/i.test(result.gpu);
  const checks = [];
  if (!result.perf) checks.push({ name: 'perf report', ok: false, detail: 'window.__perf missing' });
  else {
    checks.push({ name: 'draw calls', ok: result.perf.drawCalls <= budgets.drawCalls, detail: `${result.perf.drawCalls} ≤ ${budgets.drawCalls}` });
    checks.push({ name: 'frame time', ok: software || result.perf.frameMs <= budgets.frameMs, detail: `${result.perf.frameMs} ms ≤ ${budgets.frameMs} ms${software ? ' (software renderer, informational)' : ''}` });
  }
  checks.push({ name: 'fixture loaded', ok: result.cellCount === town.cells.length, detail: `${result.cellCount}/${town.cells.length} cells` });
  checks.push({ name: 'page errors', ok: result.errors.length === 0, detail: result.errors.join('; ') || 'none' });
  if (result.referenceCount === 0) console.log(`[${result.browser}] No reference thumbnails in scripts/capture-reference/. Add Townscaper and Tiny Glade store screenshots there for the 200px test.`);
  for (const check of checks) {
    console.log(`[${result.browser}] ${check.ok ? 'PASS' : 'FAIL'} ${check.name}: ${check.detail}`);
    if (!check.ok) failed = true;
  }
  console.log(`[${result.browser}] GPU: ${result.gpu}`);
}
writeFileSync(path.join(outputDir, 'perf.json'), JSON.stringify({ budgets, results }, null, 2));
console.log(`Wrote ${path.relative(root, outputDir)}/`);
if (failed && strict) process.exit(1);
