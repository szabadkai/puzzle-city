// Dense-town interaction regression. Optional --profile writes a Chromium CPU
// profile; PLACEMENT_STRICT=1 enforces desktop timing/draw-call budgets.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ args: ['--ignore-gpu-blocklist', '--use-gl=angle'] });
const profiling = process.argv.includes('--profile');
mkdirSync('test-output', { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const cells = [];
  let state = 1234567;
  const random = () => { state = (state * 1664525 + 1013904223) >>> 0; return state / 4294967296; };
  for (let x = -7; x <= 7; x++) for (let z = -7; z <= 7; z++) {
    if (Math.hypot(x, z) > 8.3 || z % 3 === 0 && x % 2 !== 0 || x % 4 === 0 && z % 2 !== 0 || random() < .18) continue;
    cells.push({ x, z, height: Math.min(5, 1 + Math.floor(random() * 3) + (Math.abs(x) + Math.abs(z) < 3 ? 1 : 0)), color: Math.floor(random() * 8), placedAt: 0, foundedAt: 0, renovatedAt: 0 });
  }
  await page.addInitScript(cells => localStorage.setItem('little-tides-town-v1', JSON.stringify({
    version: 10, seed: 20260908, cells, day: 3, timeOfDay: 17.5,
    campaign: { version: 1, mode: 'sandbox', completed: 18, ready: false, sandboxUnlocked: true },
    onboardingDismissed: true, placeIntroductionSeen: true, confluenceIntroductionSeen: true,
  })), cells);
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => window.__littleTides);
  await page.locator('[data-speed="0"]').click();
  await page.waitForTimeout(1200);
  const cdp = await page.context().newCDPSession(page);
  if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start'); }
  await page.evaluate(() => {
    window.placementFrames = [];
    let previous = performance.now();
    const sample = now => {
      window.placementFrames.push({ ms: now - previous, calls: window.__littleTides.renderer.info.render.calls });
      previous = now;
      window.placementFrameRequest = requestAnimationFrame(sample);
    };
    window.placementFrameRequest = requestAnimationFrame(sample);
  });
  const timings = [];
  // Raise/lower a home, then create/delete a tile on open water. Keep the next
  // edit inside the debounce interval to exercise multiple pending mutations.
  for (const key of ['Enter', 'Delete', 'ArrowRight', 'Enter', 'Delete']) {
    timings.push(await page.evaluate(async key => {
      const canvas = document.querySelector('canvas');
      canvas.focus();
      const start = performance.now();
      canvas.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      const handlerMs = performance.now() - start;
      await new Promise(resolve => requestAnimationFrame(() => resolve()));
      return { key, handlerMs, nextFrameMs: performance.now() - start };
    }, key));
    if (process.argv.includes('--artifacts') && key !== 'ArrowRight') {
      await page.screenshot({ path: `test-output/placement-transition-${timings.length}.png` });
    }
    await page.waitForTimeout(550);
  }
  await page.waitForTimeout(1600);
  const frames = await page.evaluate(() => {
    cancelAnimationFrame(window.placementFrameRequest);
    return window.placementFrames;
  });
  if (profiling) {
    const { profile } = await cdp.send('Profiler.stop');
    writeFileSync('test-output/placement-profile.json', JSON.stringify(profile));
  }
  const savedCells = await page.evaluate(() => JSON.parse(localStorage.getItem('little-tides-town-v1')).cells);
  const heights = values => values.map(({ x, z, height }) => `${x},${z}:${height}`).sort();
  assert.deepEqual(heights(savedCells), heights(cells), 'raise/lower and create/delete must restore the town');
  assert.deepEqual(errors, []);
  const report = {
    cells: cells.length, timings,
    maxFrameMs: Math.max(...frames.map(frame => frame.ms)),
    maxDrawCalls: Math.max(...frames.map(frame => frame.calls)),
    budgets: { handlerMs: 300, frameMs: 500, drawCalls: 1000 },
  };
  writeFileSync('test-output/placement-performance.json', JSON.stringify(report, null, 2));
  await page.screenshot({ path: 'test-output/placement-performance.png' });
  console.log(JSON.stringify(report, null, 2));
  if (process.env.PLACEMENT_STRICT === '1') {
    assert.ok(timings.every(timing => timing.handlerMs < report.budgets.handlerMs), 'placement exceeded the input budget');
    assert.ok(report.maxFrameMs < report.budgets.frameMs, 'construction or deferred batching stalled rendering');
    assert.ok(report.maxDrawCalls < report.budgets.drawCalls, 'construction unbatched too much of the town');
  }
} finally {
  await browser.close();
  await server.close();
}
