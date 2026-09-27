import type { CitizenSave, FormationId } from './types';

/** One small, optional story; progress belongs to the town, not the browser profile. */
export type ResidentWish = {
  version: 1;
  residentId: string;
  residentName: string;
  status: 'offered' | 'accepted' | 'visiting' | 'fulfilled';
  hidden: boolean;
  destination?: { id: FormationId; x: number; z: number };
};

export const READING_FORMS: readonly FormationId[] = [
  'courtyard-garden', 'cloister-garden', 'courtyard-pavilion',
  'rooftop-court', 'rooftop-pavilion', 'hanging-roof-garden',
];

export function restoreResidentWish(raw: unknown): ResidentWish | undefined {
  if (!raw || typeof raw !== 'object') return;
  const value = raw as Partial<ResidentWish>;
  if (value.version !== 1 || typeof value.residentId !== 'string' || typeof value.residentName !== 'string'
    || !['offered', 'accepted', 'visiting', 'fulfilled'].includes(value.status ?? '')) return;
  const destination = value.destination;
  const validDestination = destination && READING_FORMS.includes(destination.id)
    && Number.isFinite(destination.x) && Number.isFinite(destination.z);
  return {
    version: 1, residentId: value.residentId, residentName: value.residentName,
    status: value.status === 'visiting' ? 'accepted' : value.status!,
    hidden: value.hidden === true,
    destination: validDestination ? { ...destination } : undefined,
  };
}

export function offerResidentWish(residents: readonly CitizenSave[]): ResidentWish | undefined {
  const resident = residents.find((person) => person.residentKind !== 'visitor' && person.ageGroup !== 'child');
  return resident ? { version: 1, residentId: resident.id, residentName: resident.name, status: 'offered', hidden: false } : undefined;
}

export function renderResidentWish(panel: HTMLElement, wish: ResidentWish, blocked: boolean) {
  const signature = JSON.stringify([wish, blocked]);
  if (panel.dataset.state === signature) return;
  panel.dataset.state = signature;
  // Names can arrive in shared towns. Insert them as text, never markup.
  panel.replaceChildren();
  const kicker = document.createElement('small');
  kicker.textContent = wish.status === 'fulfilled' ? 'A harbor memory' : 'An optional neighbor’s wish';
  const title = document.createElement('h2');
  title.textContent = wish.status === 'fulfilled' ? `${wish.residentName} found a reading place` : `A reading place for ${wish.residentName}`;
  const copy = document.createElement('p');
  copy.setAttribute('role', 'status');
  copy.textContent = wish.status === 'fulfilled'
    ? '“A little space, a book, and the sound of the harbor. Thank you.” This memory stays even if you reshape the town.'
    : wish.status === 'visiting'
      ? `${wish.residentName} is on the way to try the reading place. Follow along, or keep building.${blocked ? ' Resume the clock to watch the walk.' : ''}`
      : wish.status === 'offered'
        ? '“I’d love a quiet place to sit with a book.” A courtyard garden or a shared rooftop would do. There is no hurry.'
        : 'Leave a garden between three homes, or join four two-floor homes into a shared roof. Connect it to your neighbor’s home so they can walk there. Existing places count too.';
  const actions = document.createElement('div');
  const button = (action: string, label: string) => {
    const element = document.createElement('button');
    element.dataset.wishAction = action;
    element.textContent = label;
    actions.append(element);
  };
  if (wish.status === 'offered') button('accept', 'Make a reading place');
  if (wish.status === 'accepted') {
    const ideas = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = 'Building ideas · view from above';
    ideas.append(summary);
    for (const [name, rows, description] of [
      ['Courtyard garden', '· 1 ·\n· ≈ 1\n· 1 ·', 'Three one-floor homes shelter the empty center on its north, east, and south sides.'],
      ['Shared rooftop', '2 2\n2 2', 'Four touching homes in a square, each two floors high.'],
    ]) {
      const label = document.createElement('strong');
      label.textContent = name;
      const plan = document.createElement('pre');
      plan.textContent = rows;
      plan.setAttribute('aria-hidden', 'true');
      const explanation = document.createElement('p');
      explanation.textContent = description;
      ideas.append(label, plan, explanation);
    }
    panel.append(ideas);
  }
  button('follow', wish.status === 'visiting' ? `Watch ${wish.residentName} walk` : `Find ${wish.residentName}`);
  button('hide', wish.status === 'offered' ? 'Maybe later' : 'Keep building');
  panel.prepend(kicker, title, copy);
  panel.append(actions);
}
