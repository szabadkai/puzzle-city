# Little Tides — project handoff

This repository contains the completed original prototype plus four implemented slices of the new **Formation mastery** scope. The playable `main` build is deployed at <https://szabadkai.github.io/puzzle-city/>.

## Completed milestones

1. **Townscaper toy**
   - Direct build/remove interaction on a compact island grid.
   - Topology-driven houses, rows, corners, towers, courtyards, plazas, canals, arches, bridges, quays, docks, and water stairs.
   - Animated sea, construction feedback, ambient boat and birds, constrained orbit camera, and deterministic saves.
2. **Living town**
   - One persistent resident per accessible home, with a second household member in taller homes; adults, children, elders, and visitors have distinct roles.
   - Topology-derived navigation graph, A* walking across courtyards, plazas, and elevated bridges, daily routines, relationships, and inspectable citizen cards.
   - Eight-minute day/night cycle with pause, 1x, and 3x simulation speeds.
3. **Businesses**
   - Bakery, café, flower shop, workshop, bookstore, fishmonger, restaurant, tea house, inn, pottery studio, mill, smokehouse, weaver, and shipyard emerge from population, resident traits, occupation, and site suitability.
   - Persistent owners, names, opening hours, procedural storefronts, owner routines, visitor destinations, favorite-shop histories, popularity counts, and neighbor employees.
   - Businesses close or are reassigned when edits invalidate their site or owner.
4. **Crafting town**
   - Seventeen connected production steps carry raw catch, herbs, grain, timber, clay, and fiber through processed food, tools, tableware, cloth, hospitality, fishing gear, and a finished harbor export.
   - Stocks and completed steps persist; carriers visibly move cargo; Observe mode shows a workplace’s inputs, output, and shortages without turning the main HUD into a management screen.
5. **GROW discoveries**
   - Pure declarative condition trees evaluate cloned, read-only snapshots of topology, population, time, businesses, relationships, and prior discoveries.
   - Fifty-eight stable, chained one-shot event IDs commit through narrow city, business, citizen, wildlife, ambience, and presentation effects.
   - Six recurring, cooldown-backed observations turn regular customers, dawn fishing crews, bird-feeding children, waterfront elders, familiar restaurant tables, and the harbor cats’ breakfast into persistent daily patterns without adding duplicate journal entries.
   - Discoveries add a restrained world glimmer, resident reaction, caption and sound, then persist their first illustrated observation in the harbor journal.
6. **Polish and quiet finale**
   - A rowboat, fishing boat, merchant boat, and ferry follow separate deterministic routes rebuilt from the occupied shoreline after every edit. Docks, canals, sheltered water, occupations, businesses, and discoveries determine which vessels appear.
   - Rooftop planting, gulls, blossom, fireflies, festival ribbons, a traveler, rare tree, nest, clock tower, local lantern lights, and a quiet finale emerge through chained discoveries.
   - Stateful gulls fly, perch, feed, and scatter from construction; fish school in sheltered water; crabs patrol docks; cats wander outside fishmongers and inns; and butterflies circle sheltered gardens.
   - Spatially bucketed relationship checks are capped per tick, and established friends pause for shared meals, harbor news, evening walks, and other joint routines.
   - Layered procedural cues cover water, gulls, footsteps, construction, doors, chatter, bells, horns, insects, and the finale without starting ambient playback before the player has interacted.
   - Press `G` for a developer panel showing snapshot totals, citizen and business state, selected topology, event eligibility, recent effects, nav visualization, event forcing, citizen spawning, and time advancement.
7. **Formation mastery — four slices**
   - A pure detector recognizes 18 tiered architectural forms across water, street, terrace, rooftop, courtyard, and landmark families.
   - The Formation Atlas permanently remembers discovered forms, shows clues for unknown forms, counts active occurrences, and refocuses forms that still exist.
   - A dismissible four-step First Tide uses temporary world-space ripples to teach negative space, vertical transformation, and adjacency on desktop and touch layouts.
   - Active forms register named, reachable gathering nodes in the citizen navigation graph; the Atlas reports current visitors and citizen cards name the destination.
   - Compatible forms improve business site scoring, allow a trade to arrive up to two residents earlier when a supported ground floor exists, and add one item to nearby production batches. The Atlas and Observe-mode workplace detail explain the relationship.
   - Six higher-order living places emerge from nearby compatible forms without painted zones: Canal Market, Garden Commons, Makers’ Walk, Roof Village, High Harbor, and Lantern Square.
   - Every living place grows one exclusive procedural landmark—Market Barge, Seed House, Guild Kiln, Roof Hall, Signal Beacon, or Lantern Theatre—at a source-formation socket, with a rising arrival animation, camera glimmer, two-tone cue, and resident welcome. It disappears reversibly if the relationship is broken and can be inspected directly.
   - The six consequences are asymmetric: early merchant traffic, spreading seed trays, fired-clay façade marks, concentrated rooftop meetings, a dedicated survey boat, and a nightly theatre audience and glow.
   - Living places become exact resident destinations, bring matching trades up to three residents earlier, add two items to supported production, remain remembered after reshaping, and expose actionable combination clues in the Atlas.
   - A one-time Second Tide invitation waits for three known forms, two active families, three residents, and a quiet delay. Unrelated possibilities remain poetic rumors; building one ingredient progressively surfaces its place name and actionable clue. A surfaced clue can be followed through the existing tide tracker, and six GROW stories respond to residents using the resulting landmarks.

The visual direction is a warm, fictional old East Asian harbor: layered tiled eaves, narrow signs, awnings, laundry balconies, pipes, rooftop tanks, and evening window light. It draws on old Tokyo and Hong Kong atmosphere without reproducing a specific property or place.

## Code map

- `src/main.ts` — application shell, Three.js scene, render loop, input, camera, water, ambience, day/night cycle, persistence, UI, and adaptive performance governor.
- `src/city.ts` — sparse cell model, procedural architecture/storefront generation, local topology rebuilds, and static geometry batching.
- `src/citizens.ts` — navigation graph, A* routing, resident lifecycle, routines, relationships, business visits, and citizen rendering.
- `src/businesses.ts` — business recipes, emergence thresholds, scoring, opening hours, ownership, and validity maintenance.
- `src/crafting.ts` — production recipes, bounded stocks, progression milestones, delivery intents, and save serialization.
- `src/grow.ts` — read-only world snapshots, declarative conditions, event commitment, discovery focus resolution, 58 one-shot discoveries, and six recurring moments.
- `src/harbor.ts` — shoreline-derived boat routes, boats, birds, clouds, stars, blossom particles, and evening fireflies.
- `src/fauna.ts` — deterministic habitat derivation, low-poly wildlife models, and fly/feed/perch/scatter/swim/wander behavior.
- `src/water.ts` — shared deterministic shoreline, dock, canal, sheltered-water, and route derivation.
- `src/topology.ts` — shared multi-cell plaza recognition.
- `src/formations.ts` — pure formation catalogue, lineage expansion, active occurrence detection, business affinity, and player-facing influence descriptions.
- `src/place-identities.ts` — higher-order formation combinations, progressive Atlas clues, exclusive landmark sockets, living-place discovery, trade affinity, opening thresholds, and resident activity language.
- `src/types.ts` — saved-world and shared domain types.
- `src/random.ts` — deterministic coordinate hashing and selection helpers.
- `src/style.css` — HUD and presentation styling.
- `DESIGN.md` — design pillars, procedural rules, and milestone roadmap.
- `.github/workflows/deploy-pages.yml` — automatic GitHub Pages build and deployment from `main`.

## Persistence and compatibility

The town is stored in `localStorage` under `little-tides-town-v1`. The current payload is save version 10 and includes:

- the deterministic world seed and sparse cell array;
- day and time-of-day;
- citizens, homes, household/age roles, visitor status, positions and optional bridge elevation, traits, occupations, relationships, favorite shops, and visit histories;
- businesses, sites, owners, employees, popularity, names, types, and opening times.
- discovered stable event IDs, illustrated journal entries, and recurring-event cooldown timestamps.
- crafting stocks, completed production steps, and the production cursor.
- remembered formation and living-place IDs, First/Second Tide introduction state, and the currently followed living-place clue.

`SavedTown` accepts versions 1 through 10, and all fields added after version 1 are optional. Existing towns discover any currently active formations and living places on load and skip First Tide automatically; repeated journal entries from older saves are compacted on load. Preserve that additive migration behavior when extending the schema. The in-game **New tide** action clears the existing local save.

## Performance baseline

The current renderer batches static cell geometry by material, rebuilds only the edited cell plus its eight neighbors, shares citizen assets, throttles relationship/business work, and updates the shadow map periodically. An adaptive governor lowers render pixel ratio on slower devices and disables dynamic shadows only as a final fallback.

Press `P` to toggle the performance overlay. It reports FPS, draw calls, triangle count, shop count, render scale, and whether the lightweight shadow fallback is active.

The latest manual browser checks held 60 FPS in the tested desktop environment:

- two-home town: about 57–58 draw calls;
- 11-resident town: about 255 draw calls;
- Milestone 4, 13-resident town with all five businesses: about 328–336 draw calls and 99–102k triangles.
- Milestone 5, the same town at night with rooftop gardens and blossom active: about 341 draw calls and 102k triangles.

Treat these as comparison baselines, not cross-device guarantees. Re-test a dense town after adding any animated or per-cell feature.

## Run, verify, and deploy

Use Node.js 22, matching the Pages workflow.

```bash
npm install
npm run dev
```

Before committing:

```bash
npm run build
```

Pushing `main` triggers the `Deploy to GitHub Pages` workflow. Check it with:

```bash
gh run list --repo szabadkai/puzzle-city --workflow deploy-pages.yml --limit 3
```

Repository: <https://github.com/szabadkai/puzzle-city>

## Current state and future extensions

The original prototype roadmap is complete. The active new scope is formation mastery. Individual forms and higher-order living places now affect movement, gathering, business suitability, production, landmark transformation, and authored resident stories; First Tide and Second Tide teach the two layers without exposing zones. The nearest follow-up is replayable seeded harbor constraints and expeditions. Caribbean and Italian coastal world packs are promising later multipliers, but should reuse the mechanical grammar instead of becoming cosmetic reskins. Other extension seams include multiple save slots, accessibility settings for motion and sound, more boat silhouettes, and authored discovery packs registered against the existing GROW engine.

Preserve the GROW boundary: pure snapshot evaluation in `grow.ts`, state changes only through narrow system APIs, and additive save migrations. Keep wildlife and seasonal animation batched, and use the `P` and `G` panels together when evaluating dense-town changes.
