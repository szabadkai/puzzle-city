import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import * as THREE from 'three';
import { chromium } from 'playwright';
import { createServer } from 'vite';

const server = await createServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' });
await server.listen();
const { BuildingPicker, ConstructionHistory } = await server.ssrLoadModule('/src/build-tools.ts');
const cell = (x, z, height = 1) => ({ x, z, height, color: 3, placedAt: 0, foundedAt: 12, renovatedAt: 15 });
const edits = new ConstructionHistory();
const first = cell(0, 0);
edits.record(0, 0, null, first);
first.color = 7;
assert.equal(edits.take('undo').after.color, 3, 'history must own snapshots');
assert.equal(edits.canUndo, false);
assert.equal(edits.canRedo, true);
assert.equal(edits.take('redo').after.foundedAt, 12);
edits.take('undo');
edits.record(1, 0, null, cell(1, 0));
assert.equal(edits.canRedo, false, 'a new edit discards the abandoned future');
for (let i = 0; i < 80; i++) edits.record(i, 0, null, cell(i, 0));
let count = 0;
while (edits.take('undo')) count++;
assert.equal(count, 60, 'history remains bounded');
const picker = new BuildingPicker();
const tall = cell(0, 0, 5), front = cell(0, 2);
assert.equal(picker.pick(new THREE.Ray(new THREE.Vector3(0, 1, 15), new THREE.Vector3(0, 0, -1)), [tall, front]), front, 'nearest facade wins');
assert.equal(picker.pick(new THREE.Ray(new THREE.Vector3(0, 6, 15), new THREE.Vector3(0, 0, -1)), [front, tall]), tall, 'tall roofs remain pickable behind lower homes');
assert.equal(picker.pick(new THREE.Ray(new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, -1, 0)), [tall]), tall);
assert.equal(picker.pick(new THREE.Ray(new THREE.Vector3(2.45, 10, 0), new THREE.Vector3(0, -1, 0)), [tall]), null, 'open water stays open');

const browser = await chromium.launch({ headless: true, args: ['--ignore-gpu-blocklist', '--use-gl=angle'] });
const errors = [];
const storageKey = 'little-tides-town-v1';
const town = { version: 10, seed: 42, cells: [], day: 1, timeOfDay: 9,
  campaign: { version: 1, mode: 'sandbox', completed: 18, sandboxUnlocked: true, ready: false },
  onboardingDismissed: true, placeIntroductionSeen: true, confluenceIntroductionSeen: true };
await mkdir('test-output', { recursive: true });
async function setup(options = {}) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ...options });
  await context.addInitScript(({ town, storageKey }) => {
    if (!sessionStorage.getItem('fixture')) { localStorage.setItem(storageKey, JSON.stringify(town)); sessionStorage.setItem('fixture', '1'); }
  }, { town, storageKey });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(server.resolvedUrls.local[0]);
  await page.waitForFunction(() => Boolean(window.__littleTides));
  await page.locator('[data-speed="0"]').click();
  return { page, context };
}
async function height(page, expected) {
  await page.waitForFunction(({ storageKey, expected }) => (JSON.parse(localStorage.getItem(storageKey)).cells.find(c => c.x === 0 && c.z === 0)?.height ?? 0) === expected, { storageKey, expected });
}
async function point(page, h = 0) {
  return page.evaluate(h => {
    const camera = window.__littleTides.camera;
    const p = camera.position.clone().set(0, h ? .6 + h * 1.42 : 0, 0).project(camera);
    return { x: (p.x + 1) * innerWidth / 2, y: (1 - p.y) * innerHeight / 2 };
  }, h);
}
try {
  const { page, context } = await setup();
  assert.equal(await page.locator('#build-undo').isDisabled(), true);
  const p = await point(page);
  await page.mouse.move(p.x, p.y);
  await page.waitForFunction(() => document.querySelector('#build-preview-label').textContent.includes('new home'));
  await page.mouse.click(p.x, p.y);
  await height(page, 1);
  const original = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).cells[0], storageKey);
  await page.keyboard.press('Control+z'); await height(page, 0);
  await page.keyboard.press('Control+Shift+z'); await height(page, 1);
  const restored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)).cells[0], storageKey);
  assert.equal(restored.color, original.color);
  assert.equal(restored.foundedAt, original.foundedAt);
  await page.locator('canvas').first().focus();
  for (let i = 0; i < 4; i++) await page.keyboard.press('Enter');
  await height(page, 5);
  await page.keyboard.press('Enter'); await height(page, 5);
  await page.keyboard.press('Control+z'); await height(page, 4);
  await page.keyboard.press('Control+Shift+z'); await height(page, 5);
  await page.keyboard.press('Delete'); await height(page, 4);
  await page.locator('#build-undo').click(); await height(page, 5);
  await page.locator('#build-redo').click(); await height(page, 4);
  await page.keyboard.press('r');
  const roof = await point(page, 4);
  await page.mouse.move(roof.x, roof.y);
  await page.waitForFunction(() => document.querySelector('#build-preview-label').textContent.includes('4 → 3'));
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-touch-mode=remove]')).backgroundColor === 'rgb(164, 81, 67)');
  assert.equal(await page.evaluate(() => window.__littleTides.scene.getObjectByName('construction-preview').children[0].geometry.attributes.position.count), 24, 'the floor outline must contain all twelve edges');
  await page.screenshot({ path: 'test-output/build-tools-desktop.png' });
  await page.mouse.click(roof.x, roof.y); await height(page, 3);
  assert.equal(await page.locator('#build-redo').isDisabled(), true);
  await page.locator('#touch-help-toggle').click();
  assert.equal(await page.locator('.desktop-build-help').isVisible(), true);
  await page.keyboard.press('Control+z'); await height(page, 3);
  await page.locator('#touch-guide-done').click();
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__littleTides));
  await height(page, 3);
  assert.equal(await page.locator('#build-undo').isDisabled(), true, 'session history resets on reload');
  await context.close();

  const mobile = await setup({ viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const tap = await point(mobile.page);
  await mobile.page.touchscreen.tap(tap.x, tap.y); await height(mobile.page, 1);
  await mobile.page.locator('#build-undo').tap(); await height(mobile.page, 0);
  await mobile.page.locator('#build-redo').tap(); await height(mobile.page, 1);
  for (const button of await mobile.page.locator('.mobile-controls button').all()) {
    const bounds = await button.boundingBox();
    assert.ok(bounds.width >= 44 && bounds.height >= 44 && bounds.x >= 0 && bounds.x + bounds.width <= 375, 'touch buttons must fit and remain tappable');
  }
  await mobile.page.locator('#touch-help-toggle').tap();
  await mobile.page.locator('#touch-guide-done').tap();
  await mobile.page.locator('#touch-guide').waitFor({ state: 'hidden' });
  await mobile.page.screenshot({ path: 'test-output/build-tools-mobile.png' });
  await mobile.page.setViewportSize({ width: 320, height: 740 });
  await mobile.page.locator('#touch-help-toggle').tap();
  await mobile.page.locator('#touch-guide-done').tap();
  await mobile.context.close();
  assert.deepEqual(errors, []);
  console.log('Construction history, target picking, desktop shortcuts, touch controls, metadata, persistence, and screenshots passed.');
} finally {
  await browser.close();
  await server.close();
}
