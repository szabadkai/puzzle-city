import { CAMPAIGN_LESSONS, CHAPTER_BEATS, chapterInfo, currentLesson, lessonTitle, type CampaignSave } from './campaign';
import type { CampaignGuidance } from './campaign-guidance';
import { FORMATION_BY_ID } from './formations';

function action(name: string, label: string, disabled = false) {
  return `<button data-campaign-action="${name}" ${disabled ? 'disabled' : ''}>${label}</button>`;
}

export function campaignChart(state: CampaignSave) {
  const chapters = [...new Set(CAMPAIGN_LESSONS.map(({ chapter }) => chapter))];
  const count = state.completed + Number(state.ready);
  return `<ol class="voyage-chart" aria-label="Six chapters of the Formation Voyage">${chapters.map((chapter, i) => {
    const end = CAMPAIGN_LESSONS.map((lesson) => lesson.chapter).lastIndexOf(chapter) + 1;
    const complete = count >= end;
    return `<li class="${complete ? 'sealed' : currentLesson(state)?.chapter === chapter ? 'current' : ''}" title="${chapter}"><span aria-hidden="true">${complete ? '✓' : ['≈', '⋂', '✣', '□', '⌁', '△'][i]}</span><small>${i + 1}</small><span class="sr-only">${chapter}: ${complete ? 'complete' : 'ahead'}</span></li>`;
  }).join('')}<li class="sandbox-key ${state.sandboxUnlocked ? 'sealed' : ''}"><span aria-hidden="true">⚿</span><small>${state.sandboxUnlocked ? 'Open' : 'Locked'}</small><span class="sr-only">Free sandbox ${state.sandboxUnlocked ? 'unlocked' : 'locked'}</span></li></ol>`;
}

function chapterStrip(state: CampaignSave) {
  const chapter = chapterInfo(state);
  return `<div class="chapter-strip"><small>${chapter.chapter} · ${chapter.collected} of ${chapter.lessons.length}</small><div class="formation-stamps">${chapter.lessons.map((lesson, i) => {
    const collected = i < chapter.collected;
    const current = chapter.start + i === state.completed + Number(state.ready);
    return `<span class="formation-stamp ${collected ? 'collected' : current ? 'current' : 'silhouette'}" title="${lessonTitle(lesson)} · ${collected ? 'collected' : current ? 'current' : 'ahead'}" aria-label="${lessonTitle(lesson)}: ${collected ? 'collected' : current ? 'current' : 'ahead'}">${collected ? FORMATION_BY_ID.get(lesson.id)!.mark : current ? '◌' : '◇'}</span>`;
  }).join('')}</div></div>`;
}

export type CampaignCardContext = { guidance?: CampaignGuidance; returning?: string; active?: boolean; discoveredEarly?: boolean; touch?: boolean; help?: boolean };

export function renderCampaignCard(panel: HTMLElement, state: CampaignSave, context: CampaignCardContext = {}) {
  panel.classList.toggle('show', state.mode === 'campaign');
  const signature = JSON.stringify([state, context]);
  if (panel.dataset.state === signature) return;
  panel.dataset.state = signature;
  panel.dataset.lesson = String(state.completed);
  panel.classList.toggle('welcome-sheet', state.started === false);
  panel.classList.toggle('voyage-finale', state.completed === 18);
  const lesson = currentLesson(state);
  const chapters = [...new Set(CAMPAIGN_LESSONS.map(({ chapter }) => chapter))];
  if (state.started === false) {
    panel.innerHTML = `<span class="campaign-kicker">A harbor shaped by you</span><h2 tabindex="-1">Begin the Formation Voyage</h2>
      <p>Learn how homes, rooftops, and open water become the places of Little Tides. Complete 18 formations to unlock free sandbox for every new tide.</p>
      ${context.help ? `<div class="voyage-controls" role="status">${context.touch ? 'Build is selected. Tap water to raise a home; tap a roof to add a floor. Choose Remove to lower it. Drag to orbit; pinch to zoom.' : 'Click water to raise a home; click a roof to add a floor. Right-click to lower it. Drag to pan, right-drag to orbit, and scroll to zoom. With a keyboard, focus the harbor: arrow keys choose a space, Enter raises it, and Delete lowers it.'}</div>${action('help-back', 'Back to the voyage')}` : `<div class="campaign-actions">${action('start', 'Raise the first home')}${action('help', 'How building works')}</div>`}`;
    return;
  }
  if (!lesson) {
    panel.innerHTML = `<span class="campaign-kicker">Voyage complete · 18/18</span><h2 tabindex="-1">Your harbor, your rules</h2>
      ${campaignChart(state)}<p>You shaped all 18 Voyage formations. Free sandbox is now open for this harbor and every new tide. Basin and lane forms, living places, and Confluences are still waiting to be discovered.</p>
      <div class="campaign-actions">${action('sandbox', 'Enter free sandbox')}${action('journey', 'Review the voyage')}</div>`;
    return;
  }
  const count = state.completed + Number(state.ready);
  const chapter = chapterInfo(state);
  const chapterIndex = chapters.indexOf(lesson.chapter);
  const plan = lesson.plan.map((row) => row.map((height) => `<span class="${height ? 'home' : 'water'}" aria-hidden="true">${height || '≈'}</span>`).join('')).join('');
  const alternative = lesson.plan.map((row, i) => `Row ${i + 1}: ${row.map((height) => height ? `${height} ${height === 1 ? 'floor' : 'floors'}` : 'open water').join(', ')}.`).join(' ');
  const next = CAMPAIGN_LESSONS[state.completed + 1];
  const success = state.completed === 0 ? 'Two homes, one lane of water. You made your first formation.' : FORMATION_BY_ID.get(lesson.id)!.socialEffect;
  panel.innerHTML = `${context.returning ? `<div class="voyage-return" role="status">${context.returning}</div>` : ''}
    <details class="campaign-fold" ${state.expanded !== false ? 'open' : ''}>
    <summary aria-expanded="${state.expanded !== false}"><i class="voyage-progress-ring" style="--progress:${count / 18 * 100}%" aria-hidden="true">${state.ready ? '✓' : count}</i><span>${state.ready ? `✓ ${lessonTitle(lesson)} · Continue` : `${state.completed + 1}/18 · ${lessonTitle(lesson)}`}</span><b aria-hidden="true">⌃</b></summary>
    <span class="campaign-kicker">Chapter ${chapterIndex + 1} · ${lesson.chapter}</span>
    <small class="formation-position">Formation ${state.completed + 1} of 18</small>
    <h2 tabindex="-1">${lessonTitle(lesson)}</h2>
    <p class="voyage-goal" role="status">${state.ready ? success : context.guidance?.goal ?? lesson.instruction}</p>
    ${state.ready ? `<p class="voyage-collected">✓ ${count} of 18 collected</p>` : `<ul class="voyage-checklist" aria-live="polite" aria-atomic="true">${(context.guidance?.checklist ?? []).map((item) => `<li>${item}</li>`).join('')}</ul>
    <details class="campaign-example" ${state.planExpanded ? 'open' : ''}><summary>Building plan · view from above</summary>
      <div class="campaign-plan" style="--plan-columns:${lesson.plan[0].length}" role="img" aria-label="${alternative}">${plan}</div>
      <small>${alternative}</small><small>Number = floors · ≈ = leave open. Raise a roof to add a floor; use Remove to lower it.</small>
    </details>
    ${context.guidance?.correction ? `<p class="voyage-correction">${context.guidance.correction}</p>` : ''}
    ${context.discoveredEarly ? '<small class="voyage-early">Already discovered · place it once more to complete this Voyage lesson.</small>' : ''}`}
    ${state.ready && context.active === false ? '<p class="voyage-correction">Your progress is safe. This formation has been reshaped; start this lesson again anywhere.</p>' : ''}
    ${state.completed > 0 || state.ready ? chapterStrip(state) : ''}
    ${state.ready && chapter.complete ? `<div class="chapter-beat"><strong>✓ Chapter ${chapterIndex + 1} complete</strong><p>${CHAPTER_BEATS[chapterIndex][0]}</p><small>${CHAPTER_BEATS[chapterIndex][1]}</small></div>` : ''}
    <div class="campaign-actions">${state.ready ? action('next', !next ? 'Unlock free sandbox' : chapter.complete ? 'Begin next chapter' : `Continue to ${lessonTitle(next)}`) : action('water', 'Find open water')}
    ${state.ready ? context.active ? action('view', 'View formation') : '' : action('journey', 'View voyage')}
    ${state.ready && chapter.complete ? action('look', 'Keep looking around') : ''}</div>
    ${!state.sandboxUnlocked && ((state.ready && chapter.complete) || state.completed >= 15) ? '<small class="campaign-reward">⚿ Free sandbox awaits at 18 formations.</small>' : ''}
  </details>`;
}

export function renderCampaignJourney(list: HTMLElement, state: CampaignSave) {
  const summary = document.createElement('section');
  summary.className = 'campaign-overview';
  summary.innerHTML = `<strong>${state.completed + Number(state.ready)} / 18 formations</strong>${campaignChart(state)}
    <p>Six chapters, one growing harbor. Reshape freely; collected stamps stay yours.</p>
    <div class="campaign-actions">${state.mode === 'sandbox'
      ? action(state.completed === 18 ? 'replay' : 'campaign', state.completed === 18 ? 'Replay Voyage' : state.completed ? 'Resume Formation Voyage' : 'Begin Formation Voyage')
      : action('return', 'Continue current formation')}
    ${state.mode === 'campaign' ? action('sandbox', state.sandboxUnlocked ? 'Enter free sandbox' : 'Sandbox locked', !state.sandboxUnlocked) : ''}</div>
    <p class="campaign-unlock">${state.sandboxUnlocked ? '⚿ Free sandbox unlocked · yours to keep across new tides.' : '⚿ Complete 18 formations to unlock free sandbox for every new tide.'}</p>
    ${(state.earned ?? 0) > state.completed + Number(state.ready) ? `<small>${state.earned} stamps earned on earlier voyages.</small>` : ''}`;
  list.append(summary);
  let chapter = '';
  CAMPAIGN_LESSONS.forEach((lesson, index) => {
    if (chapter !== lesson.chapter) {
      chapter = lesson.chapter;
      const heading = document.createElement('h3');
      heading.className = 'campaign-chapter';
      const end = CAMPAIGN_LESSONS.map((entry) => entry.chapter).lastIndexOf(chapter) + 1;
      heading.textContent = `${state.completed + Number(state.ready) >= end ? '✓ ' : ''}${chapter}`;
      list.append(heading);
    }
    const collected = index < state.completed || index === state.completed && state.ready;
    const row = document.createElement('div');
    row.className = `campaign-lesson ${collected ? 'complete' : index === state.completed ? 'current' : 'locked'}`;
    if (index === state.completed) row.setAttribute('aria-current', 'step');
    row.innerHTML = `<span class="campaign-number" aria-hidden="true">${collected ? FORMATION_BY_ID.get(lesson.id)!.mark : index === state.completed ? '◌' : '◇'}</span>
      <div><strong>${lessonTitle(lesson)}</strong>${index === state.completed ? `<p>${state.ready ? 'Collected · take a look around, then continue.' : lesson.instruction}</p>` : ''}</div>
      <small>${collected ? 'Collected' : index === state.completed ? 'Current' : 'Ahead'}</small>`;
    list.append(row);
  });
}
