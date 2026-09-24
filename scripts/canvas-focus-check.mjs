import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
let browser;
try {
  browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-gl=angle'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, hasTouch: true });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem('little-tides-town-v1', JSON.stringify({
    version: 10, seed: 42, cells: [],
    campaign: { version: 1, mode: 'sandbox', completed: 18, sandboxUnlocked: true, ready: false },
    onboardingDismissed: true,
  })));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => Boolean(window.__littleTides));
  await page.locator('[data-speed="0"]').click();
  const canvas = page.locator('#app > canvas');
  const outlined = () => canvas.evaluate((element) => {
    const style = getComputedStyle(element);
    return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0;
  });
  // Open water clear of UI, so pointer checks do not change the town.
  await page.mouse.click(400, 200);
  assert.equal(await canvas.evaluate((element) => document.activeElement === element), true);
  assert.equal(await outlined(), false, 'mouse focus has no screen border');
  await page.keyboard.press('b');
  assert.equal(await outlined(), false, 'a build-mode shortcut must not add a persistent screen border');
  await page.keyboard.press('ArrowRight');
  assert.equal(await outlined(), true, 'keyboard construction shows its focus indicator');
  await page.mouse.click(400, 200);
  assert.equal(await outlined(), false, 'clicking the already-focused canvas clears the border');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await outlined(), true, 'keyboard construction restores its indicator');
  await page.touchscreen.tap(400, 200);
  assert.equal(await outlined(), false, 'touch also clears the border');
  await page.keyboard.press('Tab');
  assert.equal(await canvas.evaluate((element) => document.activeElement === element), false);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await canvas.evaluate((element) => document.activeElement === element), true);
  assert.equal(await outlined(), true, 'tabbing into the harbor retains visible keyboard focus');
  await page.keyboard.press('Tab');
  assert.equal(await outlined(), false, 'leaving the canvas removes its indicator');
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log('Canvas focus checks passed: shortcuts, mouse, touch, keyboard construction, and Tab navigation.');
} finally {
  await browser?.close();
  await server.close();
}
