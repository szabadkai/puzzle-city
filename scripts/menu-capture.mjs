// Town menu capture. Loads the fixture town through a #t= share code, opens
// the menu, and writes screenshots to test-output/ for a phone, a phone at
// night, a short phone, and a desktop viewport. It also checks that a tap on
// the scrim closes the menu without reaching the canvas, and that the town
// clock stands still while the menu is open.
//
//   npm run menu-capture            # live Vite dev server
//   CAPTURE_GL=swiftshader|angle    # GL backend for Chromium (default: swiftshader on Linux)
import { mkdirSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'test-output');
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
    cells,
    timeOfDay: 17.5,
    day: 3,
    onboardingDismissed: true,
    placeIntroductionSeen: true,
    confluenceIntroductionSeen: true,
  };
}

function shareCode(town) {
  return deflateRawSync(Buffer.from(JSON.stringify(town))).toString('base64url');
}

async function startServer() {
  const vite = await import('vite');
  const server = await vite.createServer({ root, server: { port: 0 }, logLevel: 'error' });
  await server.listen();
  return { url: server.resolvedUrls.local[0], close: () => server.close() };
}

function chromiumArgs() {
  const backend = process.env.CAPTURE_GL ?? (process.platform === 'linux' ? 'swiftshader' : 'angle');
  const common = ['--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'];
  if (backend === 'swiftshader') return [...common, '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
  return [...common, '--use-gl=angle'];
}

const town = fixtureTown();
const code = shareCode(town);
const server = await startServer();
const { chromium } = await import('playwright');
const browser = await chromium.launch({ args: chromiumArgs() });
const phone = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const shortPhone = { ...phone, viewport: { width: 375, height: 560 } };
const desktop = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 };
const failures = [];

function check(passed, label) {
  console.log(`${passed ? 'PASS' : 'FAIL'} ${label}`);
  if (!passed) failures.push(label);
}

async function openMenu(name, context, { night = false } = {}) {
  const page = await browser.newPage(context);
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`${server.url}#t=${code}`, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  if (night) await page.evaluate(() => document.body.classList.add('night'));
  await page.click('#mobile-menu-toggle');
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outputDir, `${name}.png`) });
  check(errors.length === 0, `${name}: no page errors${errors.length ? ` (${errors[0]})` : ''}`);
  check(await page.evaluate(() => document.querySelector('.top-actions').classList.contains('open')), `${name}: menu opens`);
  return page;
}

const page = await openMenu('menu-mobile', phone);

const menuOpen = () => page.evaluate(() => document.querySelector('.top-actions').classList.contains('open'));
const clock = () => page.evaluate(() => document.querySelector('#mobile-clock-display').textContent);
const savedCells = () => page.evaluate(() => JSON.parse(localStorage.getItem('little-tides-town-v1') ?? 'null')?.cells?.length ?? null);

check(await page.evaluate(() => document.querySelector('canvas').hasAttribute('inert')), 'menu-mobile: canvas is inert while open');
check(await page.evaluate(() => document.activeElement?.id === 'top-actions-menu'), 'menu-mobile: dialog holds focus');

const clockBefore = await clock();
await page.waitForTimeout(1500);
check((await clock()) === clockBefore, 'menu-mobile: clock stands still while open');

check(await page.evaluate(() => document.querySelector('#reset-confirm').hidden && getComputedStyle(document.querySelector('#reset-confirm')).display === 'none'), 'menu-mobile: confirm starts hidden');
const sheetTop = await page.evaluate(() => document.querySelector('#top-actions-menu').getBoundingClientRect().top);
await page.touchscreen.tap(187, Math.max(70, sheetTop - 30));
await page.waitForTimeout(600);
check(!(await menuOpen()), 'menu-mobile: scrim tap closes the menu');
const cells = await savedCells();
check(cells === null || cells === town.cells.length, `menu-mobile: scrim tap did not build (${cells ?? 'no save'} cells)`);

await page.click('[data-speed="3"]');
const clockClosed = await clock();
await page.waitForTimeout(1500);
check((await clock()) !== clockClosed, 'menu-mobile: clock runs again after close');

await page.click('#mobile-menu-toggle');
await page.waitForTimeout(400);
await page.click('#music-toggle');
await page.waitForTimeout(300);
check(await menuOpen(), 'menu-mobile: music toggle keeps the menu open');
await page.click('#reset');
await page.waitForTimeout(300);
check(await page.evaluate(() => !document.querySelector('#reset-confirm').hidden && document.activeElement?.id === 'reset-cancel'), 'menu-mobile: new tide shows the inline confirm');
await page.screenshot({ path: path.join(outputDir, 'menu-mobile-confirm.png') });
await page.click('#reset-cancel');
await page.waitForTimeout(200);
check(await page.evaluate(() => document.querySelector('#reset-confirm').hidden && document.querySelector('.top-actions').classList.contains('open')), 'menu-mobile: keep this town hides the confirm');
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
check(!(await menuOpen()) && await page.evaluate(() => !document.querySelector('canvas').hasAttribute('inert')), 'menu-mobile: escape closes and frees the canvas');

await openMenu('menu-mobile-night', phone, { night: true });
await openMenu('menu-mobile-short', shortPhone);
const desktopPage = await openMenu('menu-desktop', desktop);
await desktopPage.keyboard.press('j');
await desktopPage.waitForTimeout(400);
check(await desktopPage.evaluate(() => document.querySelector('#journal-scrim').classList.contains('show') && !document.querySelector('.top-actions').classList.contains('open')), 'menu-desktop: J opens the journal and closes the menu');
await desktopPage.keyboard.press('Escape');
await desktopPage.waitForTimeout(400);
check(await desktopPage.evaluate(() => !document.querySelector('canvas').hasAttribute('inert') && !document.querySelector('.header-controls').hasAttribute('inert')), 'menu-desktop: escape from journal leaves nothing inert');

await browser.close();
await server.close();
if (failures.length) {
  console.error(`${failures.length} check(s) failed`);
  process.exit(1);
}
