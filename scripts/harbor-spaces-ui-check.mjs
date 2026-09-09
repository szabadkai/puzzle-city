import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createServer } from 'vite';
import { HARBOR_SPACE_PLANS } from '../src/harbor-space-plans.ts';
import { FORMATION_BY_ID } from '../src/formations.ts';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-gl=angle'] });
await mkdir('test-output', { recursive: true });
const errors = [];
try {
  for (const [id, rows] of Object.entries(HARBOR_SPACE_PLANS)) {
    const cells = [];
    rows.forEach((row, iz) => [...row].forEach((kind, ix) => {
      if (kind === 'H') cells.push({ x: ix - Math.floor(row.length / 2), z: iz - Math.floor(rows.length / 2), height: 1, color: (ix + iz) % 5, placedAt: 0 });
    }));
    const town = { version: 10, seed: 42, cells, timeOfDay: 10.5, day: 1,
      campaign: { version: 1, mode: 'sandbox', completed: 18, ready: false, sandboxUnlocked: true, started: true },
      placeIntroductionSeen: true, onboardingDismissed: true };
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    await context.addInitScript((town) => {
      if (sessionStorage.getItem('space-fixture')) return;
      localStorage.setItem('little-tides-town-v1', JSON.stringify(town));
      sessionStorage.setItem('space-fixture', 'true');
    }, town);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${id}: ${error.message}`));
    await page.goto(server.resolvedUrls.local[0]);
    await page.waitForFunction(() => Boolean(window.__littleTides));
    await page.locator('[data-speed="0"]').click();
    await page.evaluate(() => {
      const { camera } = window.__littleTides;
      camera.position.set(12, 18, 20);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    });
    await page.keyboard.press('h');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: `test-output/${id}-world.png` });
    await page.keyboard.press('h');
    await page.locator('#journal-open').click();
    await page.locator('#journal-tab-atlas').click();
    assert.equal(await page.locator('.atlas-card').count(), 24, 'the Atlas includes all six extra forms');
    const card = page.locator(`.atlas-card[data-formation-id="${id}"]`);
    await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
    assert.match(await card.getAttribute('class'), /learned/);
    assert.ok((await card.innerText()).includes(FORMATION_BY_ID.get(id).title));
    assert.equal(await card.locator('svg').count(), 2, 'new forms have field-guide art and a separate build plan');
    assert.ok(await card.locator('.atlas-illustration .wash').count(), 'the main journal art uses the existing watercolor wash language');
    assert.ok(await card.locator('.atlas-illustration .accent-line').count(), 'the main journal art uses the existing restrained accent line');
    assert.equal(await card.locator('.atlas-footprint-plan').count(), 1, 'the construction diagram remains separate from the field-guide art');
    assert.match(await card.locator('.atlas-signature-note').innerText(), /Town signature/i);
    await page.screenshot({ path: `test-output/${id}-atlas.png` });
    if (id === 'market-lanes') {
      for (const width of [390, 320]) {
        await page.setViewportSize({ width, height: 844 });
        await card.evaluate((element) => element.scrollIntoView({ block: 'center' }));
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'the Atlas fits a mobile viewport');
        assert.ok(await page.locator('.journal-tabs').evaluate((tabs) => tabs.scrollWidth <= tabs.clientWidth), 'the journal tabs fit the mobile viewport');
        await page.screenshot({ path: `test-output/market-lanes-mobile-${width}-atlas.png` });
      }
    }
    await page.reload();
    await page.waitForFunction(() => Boolean(window.__littleTides));
    await page.waitForTimeout(500);
    await page.locator('#journal-open').click();
    await page.waitForFunction(() => document.querySelector('#journal-scrim')?.classList.contains('show'));
    await page.locator('#journal-tab-atlas').click();
    assert.equal(await page.locator(`.atlas-card.learned[data-formation-id="${id}"]`).count(), 1, 'reload preserves the discovered shape');
    await context.close();
    console.log(`Verified ${id}: world, Atlas, and reload.`);
  }
  assert.deepEqual(errors, [], 'no browser runtime errors');
} finally {
  await browser.close();
  await server.close();
}
