import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { CAMPAIGN_LESSONS } from '../src/campaign.ts';
import { CELL_SIZE, FLOOR_HEIGHT } from '../src/spatial.ts';

const storageKey = 'little-tides-town-v1';
const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-gl=angle'] });
const errors = [];
await mkdir('test-output', { recursive: true });

async function openTown(town, options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  if (town) await context.addInitScript(({ town, storageKey }) => {
    if (!sessionStorage.getItem('campaign-fixture-loaded')) {
      localStorage.setItem(storageKey, JSON.stringify(town));
      sessionStorage.setItem('campaign-fixture-loaded', 'true');
    }
  }, { town, storageKey });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => Boolean(window.__littleTides));
  await page.locator('[data-speed="0"]').click();
  return { page, context };
}

async function openVoyage(page) {
  await page.locator('#mobile-menu-toggle').click();
  await page.locator('#campaign-open').click();
}

async function clickHome(page, x, z, height = 0) {
  // Raw touchscreen taps lack locator actionability checks. Wait for the
  // responsive guide to move clear of the intended world point.
  await page.waitForFunction(({ x, z, height, CELL_SIZE, FLOOR_HEIGHT }) => {
    const camera = window.__littleTides.camera;
    const projected = camera.position.clone().set(x * CELL_SIZE, height ? .6 + height * FLOOR_HEIGHT : 0, z * CELL_SIZE).project(camera);
    return document.elementFromPoint((projected.x + 1) * innerWidth / 2, (1 - projected.y) * innerHeight / 2)?.tagName === 'CANVAS';
  }, { x, z, height, CELL_SIZE, FLOOR_HEIGHT });
  const point = await page.evaluate(({ x, z, height, CELL_SIZE, FLOOR_HEIGHT }) => {
    const camera = window.__littleTides.camera;
    const projected = camera.position.clone().set(x * CELL_SIZE, height ? .6 + height * FLOOR_HEIGHT : 0, z * CELL_SIZE).project(camera);
    return { x: (projected.x + 1) * innerWidth / 2, y: (1 - projected.y) * innerHeight / 2 };
  }, { x, z, height, CELL_SIZE, FLOOR_HEIGHT });
  if (await page.evaluate(() => matchMedia('(pointer: coarse)').matches)) await page.touchscreen.tap(point.x, point.y);
  else await page.mouse.click(point.x, point.y);
  await page.waitForFunction(({ storageKey, x, z, height }) =>
    JSON.parse(localStorage.getItem(storageKey))?.cells.some((cell) => cell.x === x && cell.z === z && cell.height === height + 1),
  { storageKey, x, z, height });
}

try {
  const first = await openTown();
  const page = first.page;
  assert.equal(await page.locator('#campaign-card h2').innerText(), 'Begin the Formation Voyage');
  await page.locator('[data-campaign-action="help"]').click();
  assert.match(await page.locator('.voyage-controls').innerText(), /Click water/);
  await page.locator('[data-campaign-action="help-back"]').click();
  await page.locator('[data-campaign-action="start"]').click();
  assert.equal(await page.locator('#campaign-card h2').innerText(), 'Narrow Canal');
  await openVoyage(page);
  assert.equal(await page.locator('.campaign-lesson').count(), 18);
  assert.equal(await page.locator('[data-campaign-action="sandbox"]').isDisabled(), true);
  await page.locator('[data-campaign-action="return"]').click();
  await clickHome(page, -1, 0);
  assert.match(await page.locator('.voyage-checklist').innerText(), /Homes placed: 1 \/ 2/);
  assert.match(await page.locator('.voyage-correction').innerText(), /First home raised/);
  await clickHome(page, 1, 0);
  assert.match(await page.locator('#campaign-card').innerText(), /1 of 18 collected/);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__littleTides));
  await page.locator('[data-speed="0"]').click();
  assert.match(await page.locator('#campaign-card').innerText(), /1 of 18 collected/, 'unclaimed completion survives reload');
  await page.locator('[data-campaign-action="next"]').click();
  assert.equal(await page.locator('#campaign-card h2').innerText(), 'Sea Arch');
  await clickHome(page, -1, 0, 1);
  assert.match(await page.locator('.voyage-checklist').innerText(), /2 \/ 2 floors/);
  assert.match(await page.locator('.voyage-checklist').innerText(), /1 \/ 2 floors/);
  await clickHome(page, 1, 0, 1);
  assert.match(await page.locator('#campaign-card').innerText(), /2 of 18 collected/);
  await page.screenshot({ path: 'test-output/campaign-desktop.png' });
  await page.locator('[data-campaign-action="next"]').click();
  await page.locator('.campaign-fold > summary').click();
  await page.waitForFunction((storageKey) => JSON.parse(localStorage.getItem(storageKey)).campaign.expanded === false, storageKey);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__littleTides));
  assert.equal(await page.locator('.campaign-fold').getAttribute('open'), null, 'collapsed card persists');
  await page.locator('.campaign-fold > summary').click();
  await page.locator('[data-speed="0"]').click();
  await openVoyage(page);
  await page.locator('[data-journal-view="atlas"]').click();
  assert.equal(await page.locator('.atlas-card.unknown svg').count(), 0, 'future floor plans remain hidden');
  await page.locator('#journal-close').click();
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const box = await page.locator('.header-controls').boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width, `header fits ${width}px`);
    await page.locator('.campaign-example summary').click();
    const card = await page.locator('#campaign-card').boundingBox();
    assert.ok(card.x >= 0 && card.y >= 0 && card.x + card.width <= width + 1 && card.y + card.height <= 844, 'expanded guide stays on screen');
    await page.screenshot({ path: `test-output/campaign-mobile-${width}.png` });
    await page.locator('.campaign-example summary').click();
  }
  await openVoyage(page);
  const tabsFit = await page.locator('.journal-tabs').evaluate((tabs) => tabs.scrollWidth <= tabs.clientWidth);
  assert.ok(tabsFit, 'all three journal tabs fit at 320px');
  await page.waitForFunction(() => getComputedStyle(document.querySelector('#journal-scrim')).opacity === '1');
  await page.screenshot({ path: 'test-output/campaign-journey.png' });
  await first.context.close();

  const touch = await openTown(undefined, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' });
  await touch.page.locator('[data-campaign-action="help"]').tap();
  assert.match(await touch.page.locator('.voyage-controls').innerText(), /Tap water/);
  await touch.page.locator('[data-campaign-action="help-back"]').tap();
  await touch.page.screenshot({ path: 'test-output/voyage-welcome-touch.png' });
  await touch.page.locator('[data-campaign-action="start"]').tap();
  assert.match(await touch.page.locator('#voyage-pointer').innerText(), /Build is selected/);
  await clickHome(touch.page, -1, 0);
  await clickHome(touch.page, 1, 0);
  await touch.page.locator('[data-campaign-action="next"]').tap();
  assert.equal(await touch.page.locator('.campaign-example').getAttribute('open'), null, 'transformation plan starts collapsed');
  await clickHome(touch.page, -1, 0, 1);
  await clickHome(touch.page, 1, 0, 1);
  await touch.page.screenshot({ path: 'test-output/voyage-touch-arch.png' });
  assert.match(await touch.page.locator('#campaign-card').innerText(), /2 of 18 collected/);
  assert.equal(await touch.page.locator('.formation-stamp.collected').first().evaluate((stamp) => getComputedStyle(stamp).animationName), 'none', 'reduced motion removes stamp animation');
  const inputFocus = await touch.page.evaluate(() => document.activeElement?.tagName);
  assert.notEqual(inputFocus, 'H2', 'touch completion does not steal world focus');
  const funnel = await touch.page.evaluate(() => JSON.parse(localStorage.getItem('little-tides-voyage-events-v1')));
  assert.ok(['welcome_shown', 'welcome_started', 'first_home', 'formation_collected'].every((name) => funnel.some(({ event }) => event === name)));
  await touch.context.close();

  const cells = [];
  CAMPAIGN_LESSONS.at(-1).plan.forEach((row, z) => row.forEach((height, x) => {
    if (height) cells.push({ x: x - 2, z: z - 2, height, color: 0, placedAt: 0 });
  }));
  const finale = await openTown({ version: 10, seed: 221, cells, campaign: { version: 1, mode: 'campaign', completed: 17, ready: false, sandboxUnlocked: false } });
  assert.match(await finale.page.locator('#campaign-card').innerText(), /Free sandbox is now open/);
  await finale.page.screenshot({ path: 'test-output/campaign-finale.png' });
  assert.equal(await finale.page.evaluate(() => localStorage.getItem('little-tides-sandbox-unlocked-v1')), 'true');
  await finale.page.locator('[data-campaign-action="sandbox"]').first().click();
  await finale.page.locator('#campaign-card').waitFor({ state: 'hidden' });
  await finale.page.reload();
  await finale.page.waitForFunction(() => Boolean(window.__littleTides));
  assert.equal(await finale.page.locator('.header-controls > #campaign-open').count(), 0, 'no standalone progression button on the top bar');
  const beforeRestart = await finale.page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), storageKey);
  await finale.page.locator('#mobile-menu-toggle').click();
  await finale.page.screenshot({ path: 'test-output/voyage-menu.png' });
  await finale.page.locator('#campaign-restart').click();
  await finale.page.locator('#campaign-card h2').waitFor({ state: 'visible' });
  assert.equal(await finale.page.locator('#campaign-card h2').innerText(), 'Begin the Formation Voyage', 'menu restarts the intro');
  const restarted = await finale.page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), storageKey);
  assert.deepEqual(restarted.cells, beforeRestart.cells, 'restart keeps the harbor');
  assert.equal(restarted.campaign.sandboxUnlocked, true, 'restart keeps earned sandbox');
  assert.equal(restarted.campaign.earned, 18, 'restart keeps earned completion');
  assert.equal(restarted.campaign.completed, 0);
  await finale.page.locator('[data-campaign-action="start"]').click();
  await openVoyage(finale.page);
  await finale.page.locator('[data-campaign-action="sandbox"]').click();
  await finale.page.locator('#mobile-menu-toggle').click();
  await finale.page.locator('#reset').click();
  await Promise.all([finale.page.waitForEvent('load'), finale.page.locator('#reset-confirm-yes').click()]);
  await finale.page.waitForFunction(() => Boolean(window.__littleTides) && Boolean(document.querySelector('#campaign-open')));
  assert.equal(await finale.page.locator('#first-tide').isVisible(), false, 'unlocked players do not repeat the old tutorial');
  await openVoyage(finale.page);
  await finale.page.locator('[data-campaign-action="campaign"]').click();
  await finale.page.locator('#campaign-card').waitFor({ state: 'visible' });
  assert.equal(await finale.page.locator('#campaign-card h2').innerText(), 'Narrow Canal', 'a new tide can replay the campaign without losing sandbox');
  await finale.context.close();

  const keyboard = await openTown(undefined, { reducedMotion: 'reduce' });
  await keyboard.page.locator('[data-campaign-action="start"]').focus();
  await keyboard.page.keyboard.press('Enter');
  await keyboard.page.locator('canvas').first().focus();
  await keyboard.page.keyboard.press('Enter');
  await keyboard.page.keyboard.press('ArrowRight');
  await keyboard.page.keyboard.press('ArrowRight');
  await keyboard.page.keyboard.press('Enter');
  assert.equal(await keyboard.page.evaluate(() => document.activeElement === document.querySelector('#campaign-card h2')), true, 'keyboard completion focuses success heading');
  assert.match(await keyboard.page.locator('#campaign-card').innerText(), /1 of 18 collected/);
  await keyboard.context.close();

  const chapter = await openTown({ version: 10, seed: 120, cells: [
    { x: -1, z: 0, height: 5, color: 0, placedAt: 0 }, { x: 1, z: 0, height: 5, color: 0, placedAt: 0 },
  ], campaign: { version: 1, mode: 'campaign', completed: 4, ready: true, sandboxUnlocked: false } });
  assert.match(await chapter.page.locator('.chapter-beat').innerText(), /shape crossings with height/);
  await chapter.page.locator('[data-campaign-action="look"]').click();
  assert.equal(await chapter.page.locator('.campaign-fold').getAttribute('open'), null);
  await chapter.page.locator('.campaign-fold > summary').focus();
  await chapter.page.keyboard.press('Enter');
  await chapter.page.locator('[data-campaign-action="next"]').focus();
  await chapter.page.keyboard.press('Enter');
  await chapter.page.locator('#campaign-card h2').waitFor({ state: 'visible' });
  assert.equal(await chapter.page.locator('#campaign-card h2').innerText(), 'Arcade Row');
  assert.notEqual(await chapter.page.locator('.campaign-example').getAttribute('open'), null, 'new pattern opens its plan');
  await chapter.context.close();

  const legacy = await openTown({ version: 10, seed: 120, cells: [{ x: 0, z: 0, height: 1, color: 0, placedAt: 0 }] });
  assert.equal(await legacy.page.locator('#campaign-card h2').innerText(), 'Begin the Formation Voyage');
  await legacy.page.locator('[data-campaign-action="start"]').click();
  const fresh = await legacy.page.evaluate((storageKey) => JSON.parse(localStorage.getItem(storageKey)), storageKey);
  assert.equal(fresh.cells.length, 0, 'legacy towns are discarded');
  assert.equal(fresh.campaign.sandboxUnlocked, false, 'legacy towns do not grant sandbox');
  await legacy.context.close();
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('Campaign browser checks passed: real building input, reload, mobile layout, finale, menu restart, new tide, and legacy reset.');
} finally {
  await browser.close();
  await server.close();
}
