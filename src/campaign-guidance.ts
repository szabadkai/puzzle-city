import { currentLesson, type CampaignSave } from './campaign.ts';
import { CARDINALS, keyOf, type Cell } from './types.ts';

export type GuidePoint = { x: number; z: number };
export type GuideMarker = GuidePoint & { height: number; action: 'build' | 'raise' | 'lower' | 'preserve'; target: number };
export type CampaignGuidance = {
  markers: GuideMarker[];
  checklist: string[];
  correction: string;
  goal: string;
  anchor: GuidePoint;
  remaining: number;
};

const GOALS = [
  'Raise two homes facing across a lane of water.', 'Lift both canal banks to join above the water.',
  'Lift the crossing into a walkable bridge.', 'Shelter the crossing with one more floor.', 'Light the tallest crossing.',
  'Join three homes along one street.', 'Lift the street into a shared rooftop walk.',
  'Shelter an open garden with three homes.', 'Raise the walls around your garden.', 'Lift a pavilion above the garden.',
  'Join four matching roofs in a square.', 'Lift the shared court into a pavilion.', 'Raise a garden above the street.',
  'Build a stair that climbs across three roofs.', 'Lift every roof along your stair.', 'Raise the stair into the lantern light.',
  'Raise a tower with a clear view of the harbor.', 'Surround an open square with homes.',
];

export function findCampaignWater(cells: ReadonlyMap<string, Cell>, isBuildable: (x: number, z: number) => boolean, near: GuidePoint): GuidePoint | undefined {
  // Enough room for the largest lesson, including its open edges. Never place anything.
  for (let radius = 0; radius <= 48; radius++) {
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
      const x = Math.round(near.x) + dx, z = Math.round(near.z) + dz;
      let clear = true;
      for (let oz = -2; oz <= 2 && clear; oz++) for (let ox = -2; ox <= 2; ox++) {
        if (cells.has(keyOf(x + ox, z + oz)) || !isBuildable(x + ox, z + oz)) { clear = false; break; }
      }
      if (clear) return { x, z };
    }
  }
  return undefined;
}

/** Suggestions are separate from the exact formation detector and never restrict building. */
export function campaignGuidance(
  state: CampaignSave, cells: ReadonlyMap<string, Cell>,
  isBuildable: (x: number, z: number) => boolean = () => true,
  near: GuidePoint = { x: 0, z: 0 }, fresh = false,
): CampaignGuidance | undefined {
  const lesson = currentLesson(state);
  if (!lesson) return;
  const index = state.completed;
  const base: { x: number; z: number; target: number }[] = [];
  lesson.plan.forEach((row, z) => row.forEach((target, x) => {
    const requiredWater = index < 5 || (index >= 7 && index <= 9 && x === 1 && z === 1)
      || (index === 17 && x >= 1 && x <= 2 && z >= 1 && z <= 2);
    if (target || requiredWater) base.push({ x, z, target });
  }));
  if (index < 5) base.push({ x: 1, z: -1, target: 0 }, { x: 1, z: 1, target: 0 });
  let best: GuideMarker[] = [], bestScore = Infinity;
  const water = findCampaignWater(cells, isBuildable, near) ?? near;
  for (let rotation = 0; rotation < 4; rotation++) {
    const rotate = (x: number, z: number): GuidePoint => {
      for (let i = 0; i < rotation; i++) [x, z] = [-z, x];
      return { x, z };
    };
    const pattern = base.map(({ x, z, target }) => ({ ...rotate(x, z), target }));
    const homes = pattern.filter(({ target }) => target);
    const origins = new Map<string, GuidePoint>();
    const addOrigin = (x: number, z: number) => origins.set(keyOf(x, z), { x, z });
    addOrigin(water.x - homes[0].x, water.z - homes[0].z);
    if (!fresh) for (const cell of cells.values()) for (const home of homes) addOrigin(cell.x - home.x, cell.z - home.z);
    for (const origin of origins.values()) {
      const markers: GuideMarker[] = pattern.map((point) => {
        const x = origin.x + point.x, z = origin.z + point.z;
        const height = cells.get(keyOf(x, z))?.height ?? 0;
        return { x, z, height, target: point.target, action: height > point.target ? 'lower' : !point.target ? 'preserve' : height ? 'raise' : 'build' };
      });
      if (markers.some(({ x, z, target }) => target && !isBuildable(x, z))) continue;
      let score = markers.reduce((sum, { height, target }) => sum + (target ? height ? Math.abs(height - target) : target + 3 : height * 5), 0);
      if (index === 16) {
        const home = markers[0];
        const adjacent = CARDINALS.map(([dx, dz]) => ({ x: home.x + dx, z: home.z + dz }));
        const occupied = adjacent.filter(({ x, z }) => cells.has(keyOf(x, z)));
        score += Math.max(0, occupied.length - 1) * 5;
        adjacent.sort((a, b) => (cells.get(keyOf(a.x, a.z))?.height ?? 0) - (cells.get(keyOf(b.x, b.z))?.height ?? 0));
        for (const point of adjacent.slice(0, 3)) {
          const height = cells.get(keyOf(point.x, point.z))?.height ?? 0;
          markers.push({ ...point, height, target: 0, action: height ? 'lower' : 'preserve' });
        }
      }
      // Geometry wins; distance only breaks ties. Follow-up lessons prefer the existing family.
      const distance = Math.hypot(origin.x - near.x, origin.z - near.z);
      score += Math.min(distance, 1000) * .0001;
      if (score < bestScore) { bestScore = score; best = markers; }
    }
  }
  if (!best.length) return { markers: [], checklist: ['Find a little more open water.'], correction: 'There is no room for this plan nearby.', goal: GOALS[index], anchor: near, remaining: 1 };
  const homes = best.filter(({ target }) => target > 0);
  const placed = homes.filter(({ height }) => height > 0).length;
  const matched = homes.filter(({ height, target }) => height === target).length;
  const open = best.filter(({ target }) => target === 0);
  const clear = open.filter(({ height }) => height === 0).length;
  let checklist = [`Matching roofs: ${matched} / ${homes.length}`];
  if (index === 0) checklist = [`Homes placed: ${placed} / 2`, `Lane of water: ${best.find(({ target }) => target === 0)?.height === 0 ? 'open ✓' : 'leave open'}`];
  else if (index < 5) checklist = homes.map(({ height, target }, i) => `${i ? 'Second' : 'First'} bank: ${height} / ${target} floors`);
  else if (index <= 6) checklist = [`${index === 5 ? 'Two' : 'Three'}-floor homes in a row: ${matched} / 3`];
  else if (index <= 9) checklist = [`Sides sheltered: ${placed} / 3`, `Walls at ${homes[0].target} floors: ${matched} / 3`, `Garden center: ${clear === open.length ? 'open ✓' : 'leave open'}`];
  else if (index >= 13 && index <= 15) {
    // In the plan the main run is the middle row; rotations preserve this order.
    const run = homes.slice(1, 4), landing = [homes[0], homes[4]];
    checklist = [`Roof heights: ${run.map(({ height }) => height).join(' → ')} (aim for ${run.map(({ target }) => target).join(' → ')})`, `Low landing: ${landing.filter(({ height, target }) => height === target).length} / 2 side homes`];
  } else if (index === 16) checklist = [`Height: ${homes[0].height} / 3 floors`, `Open sides: ${clear} / 3`];
  else if (index === 17) checklist = [`Open center: ${clear} / 4`, `Surrounding homes: ${placed} / 6`];
  const wrong = best.filter(({ height, target }) => height !== target);
  const next = wrong.find(({ action }) => action === 'lower') ?? wrong[0];
  const position = (point: GuidePoint) => {
    const center = homes.reduce((sum, home) => ({ x: sum.x + home.x / homes.length, z: sum.z + home.z / homes.length }), { x: 0, z: 0 });
    const dx = point.x - center.x, dz = point.z - center.z;
    return Math.abs(dx) > Math.abs(dz) ? dx < 0 ? 'west' : 'east' : dz < 0 ? 'north' : 'south';
  };
  let correction = next ? next.action === 'lower'
    ? next.target === 0 ? 'Keep the outlined water open; lower the home with the downward mark.' : `Lower the marked roof to ${next.target} ${next.target === 1 ? 'floor' : 'floors'}.`
    : next.action === 'raise' ? `Raise the marked ${position(next)} roof to ${next.target} floors.` : `Raise a home at the + on the ${position(next)} side.` : '';
  if (index === 0 && placed === 1 && !homes.some(({ height }) => height > 1)) correction = 'First home raised · now leave one space of open water.';
  if (!cells.size) correction = '';
  let markers = [...wrong, ...open.filter(({ height }) => !height)].slice(0, 4);
  if (index === 0 && placed <= 1 && !homes.some(({ height }) => height > 1)) {
    const first = homes.find(({ height }) => height > 0);
    markers = first ? CARDINALS.filter(([dx, dz]) => !cells.has(keyOf(first.x + dx, first.z + dz))
      && !cells.has(keyOf(first.x + dx * 2, first.z + dz * 2)) && isBuildable(first.x + dx * 2, first.z + dz * 2))
      .map(([dx, dz]) => ({ x: first.x + dx * 2, z: first.z + dz * 2, height: 0, target: 1, action: 'build' as const }))
      : [homes[0]];
  }
  return { markers, checklist, correction, goal: GOALS[index], anchor: homes[0], remaining: wrong.reduce((sum, point) => sum + Math.abs(point.height - point.target), 0) };
}
