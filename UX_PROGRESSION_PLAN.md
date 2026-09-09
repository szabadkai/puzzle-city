# Formation Voyage: onboarding and progression UX plan

## Product promise

Formation Voyage teaches the player how Little Tides reads space. Across one persistent harbor, the player learns all 18 formations, one family at a time. Completing the voyage unlocks free sandbox permanently for this and future tides.

The experience should feel like an illustrated harbor field guide rather than a conventional level selector. Progress is visible and meaningful, but the game keeps its quiet pace: no score, stars, countdowns, failure screens, or forced simulation waiting.

## Experience goals

By the end of the first three minutes, a new player should understand four things:

1. Clicking water raises a home; clicking a roof adds a floor.
2. Empty water and neighboring buildings matter as much as individual buildings.
3. The current Formation card always tells them what to try next.
4. There are 18 formations across six chapters, and completing them unlocks free sandbox.

The campaign should provide three simultaneous scales of progress:

| Scale | Player question | Primary signal |
| --- | --- | --- |
| Construction | “What do I do next?” | World markers plus a live checklist |
| Lesson | “Did I make the formation?” | Formation reveal, stamp, and explicit Continue action |
| Voyage | “How far have I come?” | Six-chapter chart, 18 collected stamps, and sandbox key |

## Entry experience

### First-ever launch

Open on the harbor with a compact welcome sheet over the lower third of the screen. Do not begin with the full Journal or chapter list.

**Kicker:** `A harbor shaped by you`

**Title:** `Begin the Formation Voyage`

**Body:** `Learn how homes, rooftops, and open water become the places of Little Tides. Complete 18 formations to unlock free sandbox for every new tide.`

**Primary action:** `Raise the first home`

**Secondary action:** `How building works`

The primary action dismisses the sheet, places a gold ripple at the nearest safe central cell, and opens the compact objective card. “How building works” shows the input method for the current device, then returns to the same start sheet. The first action must never open a dense menu.

On desktop, a one-line prompt follows the pointer until the first build: `Click the gold ripple to raise a home.` On touch, the Build control pulses once and the prompt reads: `Build is selected. Tap the gold ripple.`

### Returning campaign player

Load directly into the harbor. Briefly show `Welcome back · Formation 7 of 18` above the objective card, then fade it after three seconds. Preserve whether the card and building plan were expanded. If the active formation still exists, offer `View formation`; if it was reshaped, show `Your progress is safe. Start this lesson again anywhere.`

### Existing player migration

Existing saves open in sandbox, as they do now. The header action reads `Voyage` rather than `Sandbox`, because the button opens progression rather than toggling the building rules. In the Voyage screen, offer `Begin Formation Voyage` and explain: `Your current town and sandbox access are safe.`

### Completed player

New tides default to sandbox. The Voyage remains available as a replayable guided route, but replay never removes sandbox access or clears previously earned completion.

## The first-session sequence

### Beat 1: one input, immediate result

The player raises the first home. The game gives a short build sound and a visible foundation response. The objective card updates in place:

`First home raised · now leave one space of open water.`

Four valid opposite positions receive soft gold ripples. The camera does not move automatically.

### Beat 2: teach negative space

The player raises the opposing home. The empty tile between them briefly glimmers, the canal receives its name in the world, and the card switches to success:

**Narrow Canal**

`Two homes, one lane of water. You made your first formation.`

Show `1 of 18 collected` and add the first stamp to the voyage strip. Keep `Continue to Sea Arch` as an explicit action so the player has time to inspect the result.

### Beat 3: teach vertical transformation

On Continue, mark both canal roofs and replace the lesson checklist with:

- Left bank: `1 / 2 floors`
- Right bank: `1 / 2 floors`

Each click updates the count immediately. When both reach two floors, reveal Sea Arch. This establishes the campaign’s core rhythm: read the plan, make a change, see the shape transform, collect it.

### Beat 4: show the larger journey

After Sea Arch is collected, briefly unfold the objective card to show:

`Across the water · 2 of 5`

Below it, show five small formation stamps. The first two are filled, the third has a soft outline, and the remaining two are silhouettes. This is the first time the player sees chapter-level detail. The full six-chapter Voyage screen stays optional.

## Lesson loop

Every lesson follows the same five-state model:

1. **Introduce** — name the formation, show why it is interesting, and give one clear action.
2. **Guide** — mark relevant world cells and update a live checklist after every build or removal.
3. **Recover** — if the shape is close but invalid, explain one correction without erasing progress.
4. **Reveal** — name and visually celebrate the formation in the world.
5. **Reflect** — explain the formation’s social effect, stamp it into the chart, and wait for Continue.

Only the first lesson in a new construction pattern opens its building plan automatically. Follow-up transformations keep it collapsed because the player is modifying a known shape. The plan can always be reopened.

The objective card should contain, in order:

- `Chapter 1 · Across the water`
- `Formation 2 of 18`
- Formation name
- One-sentence goal
- Live checklist or top-down plan
- Contextual correction, if needed
- Chapter strip
- Primary action

Do not repeat the sandbox reward in every lesson. It becomes visual wallpaper. Show the locked sandbox key in the Voyage screen, at chapter completion, and in the final three lessons.

## Guidance and recovery

The current exact-shape detector is appropriate for awarding completion, but onboarding needs a separate partial-progress layer. Each lesson should report the nearest candidate arrangement and what prevents it from completing.

Examples:

| Formation | Live guidance | Useful correction |
| --- | --- | --- |
| Narrow Canal | `Homes placed 1 / 2` | `Leave exactly one water space between the homes.` |
| Sea Arch | `Banks at 2 floors: 1 / 2` | `Raise the shorter bank once.` |
| Arcade Row | `Two-floor homes in a row: 2 / 3` | `Extend this row by one home.` |
| Courtyard Garden | `Sides sheltered: 2 / 3` | `Keep the center empty; build on its north side.` |
| Rooftop Court | `Matching roofs: 3 / 4` | `Raise the lower corner to two floors.` |
| Stepped Terrace | `Main stair: 1–2–3 ✓ · landing 1 / 2` | `Add one low home beside the first step.` |
| Lookout Tower | `Height 3 / 3 · open sides 2 / 3` | `This tower is too crowded. Try open water nearby.` |
| Harbor Plaza | `Open center 4 / 4 · surrounding homes 5 / 6` | `Add one home along the highlighted edge.` |

World markers should distinguish actions without relying on color alone:

- Build: gold ripple with a `+` center.
- Raise: gold roof ring with an upward chevron.
- Remove or lower: coral roof ring with a downward chevron.
- Preserve open space: pale blue water outline with a hollow center.

If several valid solutions exist, mark no more than four nearby candidates. The player can still build elsewhere. Markers are suggestions, never blocked zones.

If the player completes a later formation early, record it in the Atlas but do not advance campaign order. When that lesson becomes current, use: `Already discovered · place it once more to complete this Voyage lesson.` This preserves the satisfaction of discovery while keeping the guided sequence legible.

## Voyage structure

The current six chapters have a good conceptual arc. Present each as a page on a horizontal harbor chart:

| Chapter | Lessons | Teaching purpose | Chapter-complete beat |
| --- | --- | --- | --- |
| 1. Across the Water | Narrow Canal → Sea Arch → High Bridge → Covered Skybridge → Lantern Gate | Negative space and vertical transformation | The completed crossing lights at dusk; `5 of 18` |
| 2. A Street Takes Shape | Arcade Row → Roof Promenade | Adjacency and shared frontage | Residents walk the connected route; `7 of 18` |
| 3. Room to Breathe | Courtyard Garden → Cloister Garden → Courtyard Pavilion | Enclosure and intentional empty space | The garden receives its chapter stamp; `10 of 18` |
| 4. Life Above the Street | Rooftop Court → Rooftop Pavilion → Hanging Roof Garden | Equal-height blocks and shared roofs | A rooftop gathering marks `13 of 18` |
| 5. Climbing the Hillside | Stepped Terrace → Terraced Garden → Lantern Stair | Height sequences and landings | The stair lights in order; `16 of 18` |
| 6. An Open Harbor | Lookout Tower → Harbor Plaza | Isolation versus enclosure | Both landmarks answer across the harbor; `18 of 18` |

Use the uneven chapter lengths as pacing. Chapter 1 is a fast transformation chain that builds confidence. Chapter 2 is a short reward. Chapters 3–5 establish mastery through three-part families. Chapter 6 is a two-part contrast and finale.

At each chapter boundary:

1. Hold the normal formation reveal for about one second longer.
2. Fill the chapter seal on the voyage chart.
3. Show a one-line mastery statement, such as `You can now shape crossings with height.`
4. Tease the next idea, not its full solution: `Next: what happens when homes touch?`
5. Offer `Begin next chapter` and `Keep looking around`.

The player should never be forced into the full Voyage screen between chapters.

## Progress surfaces

### Compact objective card

This is the primary moment-to-moment surface. Keep it in the lower corner, collapse it to a single row, and remember its state. When collapsed it shows:

`3/18 · High Bridge` plus a small progress ring.

When an action completes the formation, the collapsed state changes to:

`✓ High Bridge · Continue`

### Voyage screen

Rename the current Campaign tab and header action to `Voyage`. “Campaign” is useful implementation language, while “Voyage” belongs to Little Tides.

The top of the screen contains:

- Overall progress: `7 / 18 formations`
- A six-stop illustrated harbor chart
- The sandbox key at the final stop
- `Continue current formation`

Below the chart, show all chapters. Completed formations have named stamps. The current formation is fully described. Future formations use a silhouette and name only; exact building plans remain hidden until their lesson begins. This preserves anticipation and keeps the Atlas valuable.

### Formation Atlas

The Voyage answers “what should I build next?” The Atlas answers “what has my town learned?” Keep those jobs separate.

During campaign:

- Completed formations show their full Atlas entry.
- The current formation shows its hint.
- Future formations remain rumor cards without exact floor plans.
- Living places and Confluences may be discovered, but their onboarding invitation waits until sandbox unlock so it does not compete with the core lesson.

In sandbox, the Atlas resumes its current discovery-led behavior and introduces living places as the next horizon.

## Celebration hierarchy

Feedback should scale with the achievement so progression feels stronger over time:

| Event | Feedback |
| --- | --- |
| Correct build step | Checklist tick, small sound, marker resolves |
| Formation complete | World glimmer, nameplate, short musical interval, stamp animation |
| Chapter complete | Formation feedback plus chapter seal, resident reaction, next-chapter teaser |
| Voyage complete | Harbor-wide sequence, sandbox key unlock, persistent header change |

Avoid showing the generic `New formation` toast at the same time as a campaign reveal. The campaign card owns that moment. Unrelated formations can still use the generic Atlas toast.

## Sandbox unlock finale

Completing Harbor Plaza begins a short, non-modal finale:

1. Harbor Plaza resolves in the world.
2. The 18th stamp fills.
3. The voyage chart traces a line through all six chapter seals.
4. The sandbox key turns and the interface label changes from `Voyage` to `Sandbox unlocked` for this moment only.
5. The camera eases back slightly to show the harbor the player built during the journey.

**Title:** `Your harbor, your rules`

**Body:** `You shaped all 18 formations. Free sandbox is now open for this harbor and every new tide. Living places and Confluences are still waiting to be discovered.`

**Primary action:** `Enter free sandbox`

**Secondary action:** `Review the voyage`

After the player enters sandbox, the persistent header action should become `Voyage`, not `Sandbox`, because sandbox is now the default state rather than a destination.

## Accessibility and device behavior

- All instruction text must describe position and shape, not color alone.
- World markers require icon and shape differences in addition to hue.
- Respect reduced-motion: replace camera easing and stamp travel with fades and immediate state changes.
- Success sounds need equivalent visible feedback; audio cannot carry completion alone.
- Plans need readable text alternatives, for example: `Three cells in a row: 3 floors, open water, 3 floors.`
- On touch, the card must end above the fixed Build/Remove controls and remain scrollable when expanded.
- Never cover the current world marker with the card; choose the opposite lower corner if needed.
- Focus moves to the success heading after completion only when the player is navigating with a keyboard. Pointer and touch users retain world focus.
- The collapsed objective remains at least 44 px high and exposes lesson name, completion state, and expansion state to assistive technology.

## Edge cases

- **Player reshapes a completed lesson:** completion remains earned; active-form actions explain that the shape no longer exists.
- **Player has no clean space nearby:** offer `Find open water`, then ease the camera toward a buildable area without placing anything.
- **Player repeatedly builds an invalid shape:** after the third relevant edit, automatically expand the plan and highlight the closest correction.
- **Formation completes off-camera:** show the nameplate at the screen edge with `View formation` rather than moving the camera.
- **Share link or postcard:** carry campaign progress with the town. Account-local sandbox unlock still wins if it is already earned.
- **New tide after unlock:** open in sandbox and keep `Replay Voyage` optional.
- **Reset during campaign:** the confirmation states both effects: `Begin a new tide? Your harbor will be cleared. Voyage progress stays with this save only; permanent sandbox access is kept once earned.`

## Copy principles

Use verbs tied to the world: raise, lift, leave open, shelter, join, surround. Avoid abstract grid language such as tile, cell, adjacency, valid, or detector in player-facing copy.

Each instruction should contain one primary action. Put exact counts in the live checklist or plan rather than embedding several operations in prose. For example, replace:

`Make a straight stair of one, two, then three floors. Add a one-floor home on each side of its lowest home to give the stair a usable landing.`

with:

**Goal:** `Build a stair that climbs across three roofs.`

**Checklist:**

- `Roof heights: 1 → 2 → 3`
- `Low landing: 0 / 2 side homes`

## Validation plan

Run five moderated first-session tests on desktop and five on touch. Do not explain the controls before observing behavior.

Measure:

- Time to first home: target under 20 seconds.
- First formation completion without outside help: target at least 90%.
- Sea Arch completion without reopening help: target at least 80%.
- Players who can explain that open water affects formations after lesson 1: target at least 80%.
- Players who can locate overall progress and state the sandbox reward after lesson 2: target at least 80%.
- Incorrect edits before recovery guidance appears: no more than three.
- Campaign return rate after completing chapter 1.
- Completion rate per lesson and the largest chapter-to-chapter drop.

Ask only three debrief questions:

1. `What were you trying to make?`
2. `If you came back tomorrow, where would you look for your next step?`
3. `What do you expect to happen after all 18 formations?`

## Implementation order

### P0 — proper first-use comprehension

- Add the first-launch welcome sheet.
- Add per-step world markers and live checklists for Narrow Canal and Sea Arch.
- Separate Voyage progress from the Atlas.
- Replace repeated sandbox reward text with the chapter strip.
- Suppress duplicate formation toasts during campaign completion.
- Rename player-facing Campaign navigation to Voyage.

### P1 — strong progression

- Add live partial-progress models and correction copy for all 18 formations.
- Add formation stamps, six chapter seals, and chapter-complete beats.
- Add returning-player state and `Find open water` recovery.
- Add the sandbox unlock finale and persistent unlock communication.

### P2 — polish and learning validation

- Add reduced-motion alternatives, plan text alternatives, and keyboard focus behavior.
- Instrument the funnel from welcome → first home → formation → chapter → unlock.
- Run desktop and touch usability sessions, then revise the highest-drop lessons.
- Add optional replay after sandbox unlock.

The first implementation milestone should stop after Sea Arch. If a new player can build the first home, understand the canal’s empty space, transform it vertically, and explain the 18-formation reward without help, the interaction model is ready to scale across the remaining chapters.
