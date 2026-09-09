import { FORMATION_BY_ID } from './formations.ts';
import type { FormationOccurrence } from './formations.ts';
import type { FormationId } from './types.ts';

export type CampaignSave = {
  version: 1;
  mode: 'campaign' | 'sandbox';
  /** Number of lessons explicitly completed, in order. */
  completed: number;
  ready: boolean;
  sandboxUnlocked: boolean;
  started?: boolean;
  expanded?: boolean;
  planExpanded?: boolean;
  /** High-water mark survives a replay. */
  earned?: number;
  /** Shapes already present when this lesson began need to be made again. */
  existing?: string[];
};

type Lesson = Readonly<{
  id: FormationId;
  chapter: string;
  /** Top-down example: zero is open water, positive numbers are floor counts. */
  plan: readonly (readonly number[])[];
  instruction: string;
}>;

const crossing = (height: number) => [[height, 0, height]];
const court = (height: number) => [[height, height], [height, height]];
const garden = (height: number) => [[0, height, 0], [0, 0, height], [0, height, 0]];
const stair = (height: number) => [[height, 0, 0], [height, height + 1, height + 2], [height, 0, 0]];

export const CAMPAIGN_LESSONS: readonly Lesson[] = [
  { id: 'narrow-canal', chapter: 'Across the water', plan: crossing(1), instruction: 'Click water to raise a home. Leave one empty space, then build a second home directly opposite. Build on a gold ripple to line up the homes.' },
  { id: 'sea-arch', chapter: 'Across the water', plan: crossing(2), instruction: 'Click each canal bank once more. Both homes need two floors; keep the water between them open.' },
  { id: 'high-bridge', chapter: 'Across the water', plan: crossing(3), instruction: 'Raise both canal banks to three floors. A footbridge appears above the water.' },
  { id: 'covered-skybridge', chapter: 'Across the water', plan: crossing(4), instruction: 'Add a fourth floor to both banks to shelter the crossing.' },
  { id: 'lantern-gate', chapter: 'Across the water', plan: crossing(5), instruction: 'Raise both banks to five floors. Lanterns mark the tallest crossing.' },
  { id: 'arcade-row', chapter: 'A street takes shape', plan: [[2, 2, 2]], instruction: 'Find a fresh patch of water. Build three homes touching in a straight line, each two floors high.' },
  { id: 'roof-promenade', chapter: 'A street takes shape', plan: [[3, 3, 3]], instruction: 'Raise all three arcade homes to three floors to join their rooftops.' },
  { id: 'courtyard-garden', chapter: 'Room to breathe', plan: garden(1), instruction: 'In a fresh patch, place one-floor homes on three sides of a single empty space. Keep the center open for a garden.' },
  { id: 'cloister-garden', chapter: 'Room to breathe', plan: garden(2), instruction: 'Raise the three homes around your garden to two floors. Leave the center empty.' },
  { id: 'courtyard-pavilion', chapter: 'Room to breathe', plan: garden(3), instruction: 'Raise the garden’s three surrounding homes to three floors to create its pavilion.' },
  { id: 'rooftop-court', chapter: 'Life above the street', plan: court(2), instruction: 'Build a new two-by-two block of touching homes, all two floors high. Fill all four spaces.' },
  { id: 'rooftop-pavilion', chapter: 'Life above the street', plan: court(3), instruction: 'Raise all four homes of the roof court to three floors.' },
  { id: 'hanging-roof-garden', chapter: 'Life above the street', plan: court(4), instruction: 'Raise all four homes to four floors. Vines and planters will fill their shared roof.' },
  { id: 'stepped-terrace', chapter: 'Climbing the hillside', plan: stair(1), instruction: 'Make a straight stair of one, two, then three floors. Add a one-floor home on each side of its lowest home to give the stair a usable landing.' },
  { id: 'terraced-garden', chapter: 'Climbing the hillside', plan: stair(2), instruction: 'Add one floor to every home in the stair example, including the two side homes. The main run should be two, three, four floors.' },
  { id: 'lantern-stair', chapter: 'Climbing the hillside', plan: stair(3), instruction: 'Lift all five homes once more. The main run should be three, four, five floors, with both side homes at three.' },
  { id: 'lookout-tower', chapter: 'An open harbor', plan: [[3]], instruction: 'Build a three-floor home in open water, away from other homes, for a view across the harbor.' },
  { id: 'harbor-plaza', chapter: 'An open harbor', plan: [[0, 1, 1, 0], [1, 0, 0, 0], [1, 0, 0, 0], [0, 1, 1, 0]], instruction: 'Leave a two-by-two opening. Build six one-floor homes around it: two above, two below, and two along one side. Keep all four central spaces empty.' },
];

export function restoreCampaign(raw: unknown, profileUnlocked: boolean): CampaignSave {
  const value = raw && typeof raw === 'object' ? raw as Partial<CampaignSave> : {};
  const valid = value.version === 1;
  const completed = valid && Number.isInteger(value.completed) && value.completed! >= 0 && value.completed! <= CAMPAIGN_LESSONS.length
    ? value.completed! : 0;
  const sandboxUnlocked = profileUnlocked || (valid && value.sandboxUnlocked === true) || completed === CAMPAIGN_LESSONS.length;
  return {
    version: 1,
    mode: sandboxUnlocked && (valid ? value.mode === 'sandbox' : true) ? 'sandbox' : 'campaign',
    completed,
    ready: valid && value.ready === true && completed < CAMPAIGN_LESSONS.length,
    sandboxUnlocked,
    started: valid ? value.started !== false : profileUnlocked,
    expanded: value.expanded !== false,
    planExpanded: typeof value.planExpanded === 'boolean' ? value.planExpanded : isNewPattern(completed),
    earned: Math.max(completed, valid && Number.isInteger(value.earned) ? Math.min(18, Math.max(0, value.earned!)) : 0),
    existing: valid && Array.isArray(value.existing) ? value.existing.filter((key): key is string => typeof key === 'string').slice(0, 500) : [],
  };
}

export function currentLesson(state: CampaignSave) {
  return CAMPAIGN_LESSONS[state.completed];
}

export function isNewPattern(index: number) {
  return [0, 5, 7, 10, 13, 16, 17].includes(index);
}

export function chapterInfo(state: CampaignSave) {
  const lesson = currentLesson(state);
  const chapter = lesson?.chapter ?? CAMPAIGN_LESSONS[17].chapter;
  const lessons = CAMPAIGN_LESSONS.filter((entry) => entry.chapter === chapter);
  const start = CAMPAIGN_LESSONS.findIndex((entry) => entry.chapter === chapter);
  const collected = Math.min(lessons.length, state.completed - start + Number(state.ready));
  return { chapter, lessons, start, collected, complete: collected === lessons.length };
}

export const CHAPTER_BEATS = [
  ['You can now shape crossings with height.', 'Next: what happens when homes touch?'],
  ['You can turn a street into a shared walk.', 'Next: leave room for a quiet garden.'],
  ['You can shelter a place by leaving it open.', 'Next: life above the street.'],
  ['You can bring neighbors together on the roofs.', 'Next: climb across different heights.'],
  ['You can connect the harbor with stairs.', 'Next: an open view and a sheltered square.'],
  ['You can shape both solitude and gathering.', 'Your harbor, your rules.'],
] as const;

const occurrenceKey = (occurrence: FormationOccurrence) => `${occurrence.id}:${occurrence.x},${occurrence.z}`;

/** Only exact current shapes count; earlier discoveries never skip a lesson. */
export function observeCampaign(state: CampaignSave, occurrences: readonly FormationOccurrence[]): CampaignSave {
  const lesson = currentLesson(state);
  if (state.mode !== 'campaign' || state.started === false || state.ready || !lesson) return state;
  const active = occurrences.filter(({ id }) => id === lesson.id).map(occurrenceKey);
  const existing = (state.existing ?? []).filter((key) => active.includes(key));
  if (active.some((key) => !existing.includes(key))) return { ...state, existing, ready: true, earned: Math.max(state.earned ?? 0, state.completed + 1) };
  return existing.length !== (state.existing ?? []).length ? { ...state, existing } : state;
}

export function advanceCampaign(state: CampaignSave, occurrences: readonly FormationOccurrence[] = []): CampaignSave {
  if (state.mode !== 'campaign' || !state.ready || !currentLesson(state)) return state;
  const completed = state.completed + 1;
  const next = CAMPAIGN_LESSONS[completed];
  return { ...state, completed, ready: false, earned: Math.max(state.earned ?? 0, completed),
    planExpanded: isNewPattern(completed),
    existing: occurrences.filter(({ id }) => id === next?.id).map(occurrenceKey),
    sandboxUnlocked: state.sandboxUnlocked || completed === CAMPAIGN_LESSONS.length };
}

export function replayCampaign(state: CampaignSave, occurrences: readonly FormationOccurrence[] = []): CampaignSave {
  return { ...state, mode: 'campaign', started: true, completed: 0, ready: false, expanded: true,
    planExpanded: true, earned: Math.max(state.earned ?? 0, state.completed),
    existing: occurrences.filter(({ id }) => id === CAMPAIGN_LESSONS[0].id).map(occurrenceKey) };
}

export function lessonTitle(lesson: Lesson) {
  return FORMATION_BY_ID.get(lesson.id)!.title;
}
