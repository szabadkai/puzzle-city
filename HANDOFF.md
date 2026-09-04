# Little Tides — project handoff

This repository is complete through **Milestone 5**, the final milestone in the current roadmap. The playable build is deployed at <https://szabadkai.github.io/puzzle-city/>.

## Completed milestones

1. **Townscaper toy**
   - Direct build/remove interaction on a compact island grid.
   - Topology-driven houses, rows, corners, towers, courtyards, arches, bridges, quays, and docks.
   - Animated sea, construction feedback, ambient boat and birds, constrained orbit camera, and deterministic saves.
2. **Living town**
   - One persistent resident per accessible home.
   - Topology-derived navigation graph, A* walking, daily routines, relationships, and inspectable citizen cards.
   - Eight-minute day/night cycle with pause, 1x, and 3x simulation speeds.
3. **Businesses**
   - Bakery, café, workshop, fishmonger, and inn emerge from population, resident traits, occupation, and site suitability.
   - Persistent owners, names, opening hours, procedural storefronts, owner routines, and visitor destinations.
   - Businesses close or are reassigned when edits invalidate their site or owner.
4. **GROW discoveries**
   - Pure declarative condition trees evaluate cloned, read-only snapshots of topology, population, time, businesses, relationships, and prior discoveries.
   - Fifteen stable, chained one-shot event IDs commit through narrow city, citizen, and presentation effects.
   - Discoveries add a restrained world glimmer, resident reaction, caption and sound, then persist an illustrated observation in the harbor journal.
5. **Polish and quiet finale**
   - Two boats follow a deterministic water route rebuilt from the occupied shoreline after every edit.
   - Rooftop planting, gulls, blossom, fireflies, festival ribbons, local lantern lights, and a quiet finale emerge through eight additional chained discoveries.
   - Spatially bucketed relationship checks are capped per tick, and established friends pause for shared meals, harbor news, evening walks, and other joint routines.
   - Layered ambient tones respond to daylight and the finale without starting audio before the player has interacted.
   - Press `G` for a developer panel showing snapshot totals, event eligibility, and recently committed effects.

The visual direction is a warm, fictional old East Asian harbor: layered tiled eaves, narrow signs, awnings, laundry balconies, pipes, rooftop tanks, and evening window light. It draws on old Tokyo and Hong Kong atmosphere without reproducing a specific property or place.

## Code map

- `src/main.ts` — application shell, Three.js scene, render loop, input, camera, water, ambience, day/night cycle, persistence, UI, and adaptive performance governor.
- `src/city.ts` — sparse cell model, procedural architecture/storefront generation, local topology rebuilds, and static geometry batching.
- `src/citizens.ts` — navigation graph, A* routing, resident lifecycle, routines, relationships, business visits, and citizen rendering.
- `src/businesses.ts` — business recipes, emergence thresholds, scoring, opening hours, ownership, and validity maintenance.
- `src/grow.ts` — read-only world snapshots, declarative conditions, event commitment, discovery focus resolution, and the 23-event catalog.
- `src/harbor.ts` — shoreline-derived boat routes, boats, birds, clouds, stars, blossom particles, and evening fireflies.
- `src/types.ts` — saved-world and shared domain types.
- `src/random.ts` — deterministic coordinate hashing and selection helpers.
- `src/style.css` — HUD and presentation styling.
- `DESIGN.md` — design pillars, procedural rules, and milestone roadmap.
- `.github/workflows/deploy-pages.yml` — automatic GitHub Pages build and deployment from `main`.

## Persistence and compatibility

The town is stored in `localStorage` under `little-tides-town-v1`. The current payload is save version 4 and includes:

- the deterministic world seed and sparse cell array;
- day and time-of-day;
- citizens, homes, positions, traits, occupations, and relationships;
- businesses, sites, owners, names, types, and opening times.
- discovered stable event IDs and illustrated journal entries.

`SavedTown` accepts versions 1, 2, 3, and 4, and all fields added after version 1 are optional. Existing towns discover any currently satisfied observations gradually after loading. Preserve that additive migration behavior when extending the schema. The in-game **New tide** action clears the existing local save.

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

The five-milestone prototype roadmap is complete. Further work should be treated as a new scope rather than another assumed milestone. Good extension seams include touch-specific interaction polish, multiple save slots or export/import, accessibility settings for motion and sound, more boat silhouettes, and authored discovery packs registered against the existing GROW engine.

Preserve the GROW boundary: pure snapshot evaluation in `grow.ts`, state changes only through narrow system APIs, and additive save migrations. Keep wildlife and seasonal animation batched, and use the `P` and `G` panels together when evaluating dense-town changes.
