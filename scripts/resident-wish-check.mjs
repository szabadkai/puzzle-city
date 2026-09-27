import assert from 'node:assert/strict';
import { createServer } from 'vite';

globalThis.document = { createElement: () => ({ getContext: () => ({ fillRect() {}, beginPath() {}, ellipse() {}, fill() {} }) }) };
const server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom', logLevel: 'error' });
try {
  const { CitizenSystem } = await server.ssrLoadModule('/src/citizens.ts');
  const { detectFormations } = await server.ssrLoadModule('/src/formations.ts');
  const { offerResidentWish, restoreResidentWish } = await server.ssrLoadModule('/src/resident-wish.ts');
  const cell = (x, z, height = 1) => ({ x, z, height, color: 0, placedAt: 0 });
  const garden = [cell(0, -1), cell(1, 0), cell(0, 1)];
  const cells = new Map(garden.map((c) => [`${c.x},${c.z}`, c]));
  const citizens = new CitizenSystem(42, cells, []);
  const wish = offerResidentWish(citizens.residents());
  assert.ok(wish);
  assert.equal(offerResidentWish([]), undefined);
  assert.equal(restoreResidentWish({ version: 1, status: 'made-up' }), undefined);
  assert.equal(restoreResidentWish({ ...wish, status: 'visiting' }).status, 'accepted', 'reload replans an unfinished walk');
  assert.equal(restoreResidentWish({ ...wish, status: 'fulfilled', hidden: true }).status, 'fulfilled');
  const form = detectFormations(cells).find((form) => form.id === 'courtyard-garden');
  assert.ok(form);
  assert.ok(citizens.visitReadingPlace(wish.residentId, form), 'garden is reachable');
  assert.notEqual(citizens.readingVisitStatus(wish.residentId), 'missing');
  citizens.rebuild(cells);
  assert.equal(citizens.readingVisitStatus(wish.residentId), 'missing', 'construction invalidates the old route');
  assert.ok(citizens.visitReadingPlace(wish.residentId, form), 'route can be replanned');
  for (let tick = 0; tick < 1500 && citizens.readingVisitStatus(wish.residentId) !== 'arrived'; tick++) {
    citizens.update(.1, 12, 36 + tick * .005, tick * .1);
  }
  assert.equal(citizens.readingVisitStatus(wish.residentId), 'arrived', 'resident physically arrives');
  citizens.update(.1, 12, 44, 150);
  assert.match(citizens.card(wish.residentId).activity, /reading a book/);
  assert.equal(citizens.root.getObjectByName('neighbors-reading-book').visible, true, 'arrival shows a book');
  citizens.finishReadingVisit();
  citizens.update(.1, 12, 44.01, 150.1);
  assert.match(citizens.card(wish.residentId).activity, /reading a book/, 'reading continues after awarding the memory');

  const isolated = new Map([...cells, ['8,8', cell(8, 8)]]);
  const separated = new CitizenSystem(42, isolated, []);
  const remote = separated.residents().find((person) => person.homeKey === '8,8');
  assert.ok(remote);
  assert.equal(separated.visitReadingPlace(remote.id, form), false, 'an isolated resident cannot teleport to the garden');
  assert.equal(separated.visitReadingPlace('missing-resident', form), false);

  const roofs = new Map([cell(0, 0, 2), cell(1, 0, 2), cell(0, 1, 2), cell(1, 1, 2)].map((c) => [`${c.x},${c.z}`, c]));
  const roofCitizens = new CitizenSystem(42, roofs, []);
  const rooftop = detectFormations(roofs).find((form) => form.id === 'rooftop-court');
  assert.ok(rooftop);
  assert.ok(roofCitizens.residents().some((person) => roofCitizens.visitReadingPlace(person.id, rooftop)), 'shared roofs provide a second solution');
  console.log('Resident wish checks passed: persistence, reachable gardens and roofs, interrupted walks, physical arrival, and visible reading.');
} finally { await server.close(); }
