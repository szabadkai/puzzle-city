import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-gl=angle'] });
const key = 'little-tides-town-v1';
const errors = [];
const town = {
  version: 10, seed: 42, timeOfDay: 12, day: 1,
  cells: [[0, -1], [1, 0], [0, 1]].map(([x, z]) => ({ x, z, height: 1, color: 0, placedAt: 0 })),
  campaign: { version: 1, mode: 'sandbox', completed: 2, ready: false, sandboxUnlocked: true },
};
await mkdir('test-output', { recursive: true });
try {
  for (const width of [1280, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 844 }, reducedMotion: 'reduce', ...(width < 500 ? { isMobile: true, hasTouch: true } : {}) });
    await context.addInitScript(({ town, key }) => {
      if (!sessionStorage.getItem('wish-fixture')) {
        localStorage.setItem(key, JSON.stringify(town));
        sessionStorage.setItem('wish-fixture', 'true');
      }
    }, { town, key });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator('[data-wish-action="accept"]').waitFor();
    await page.locator('[data-speed="0"]').click();
    await page.locator('[data-wish-action="hide"]').click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).residentWish.hidden, key);
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__littleTides));
    assert.equal(await page.locator('#resident-wish').isVisible(), false, 'maybe later survives reload');
    await page.locator('[data-speed="0"]').click();
    await page.locator('#mobile-menu-toggle').click();
    await page.locator('#resident-wish-open').click();
    await page.locator('[data-wish-action="accept"]').click();
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).residentWish.status === 'visiting', key);
    const box = await page.locator('#resident-wish').boundingBox();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 844, 'wish fits viewport');
    assert.match(await page.locator('#resident-wish').innerText(), /Resume the clock/);
    await page.screenshot({ path: `test-output/resident-wish-${width}.png` });
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__littleTides));
    await page.waitForFunction((key) => JSON.parse(localStorage.getItem(key)).residentWish.status === 'fulfilled', key, { timeout: 30000 });
    assert.match(await page.locator('#resident-wish').innerText(), /Thank you/);
    const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), key);
    const hasBook = await page.evaluate(() => window.__littleTides.citizens.root.getObjectByName('neighbors-reading-book').visible);
    assert.equal(hasBook, true, 'visible reading reaction accompanies completion');
    const roundTrip = await page.evaluate(async (town) => {
      const { encodeShareCode, decodeShareCode } = await import('/src/share-code.ts');
      return (await decodeShareCode(await encodeShareCode(town))).residentWish;
    }, saved);
    assert.deepEqual(roundTrip, saved.residentWish, 'share links carry the memory');
    await page.locator('[data-wish-action="follow"]').click();
    assert.equal(await page.locator('#citizen-card').isVisible(), true);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#citizen-card')).opacity === '1');
    await page.screenshot({ path: `test-output/resident-reading-${width}.png` });
    await context.close();
  }
  assert.deepEqual(errors, []);
  console.log('Resident wish UI passed on desktop, 390px and 320px: dismiss, resume, walk recovery, completion, share roundtrip, follow, and layout.');
} finally {
  await browser.close();
  await server.close();
}
