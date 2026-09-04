# Little Tides — design notes

## Game pillars

- **Sculpt, do not zone.** The player touches the world directly and architecture responds.
- **Observation over management.** Town life should be legible through motion and visual change, not tables.
- **Discovery over instruction.** Interesting combinations quietly produce consequences.
- **A warm miniature.** Every system should help the town feel like a small physical diorama.
- **A storied harbor.** Layered eaves, laundry balconies, hand-painted signs, rooftop tanks, pipes, awnings, and warm window light suggest a fictional old East Asian port assembled across generations.

## World representation

The world is a sparse, integer-keyed square grid hidden under a continuous animated sea. Each occupied cell stores position, height, palette index, and a temporary construction timestamp. The visible building is regenerated from cell topology. The square grid is constrained to a soft circular patch so the buildable space reads as a tiny island rather than an infinite board.

Only a five-by-five neighborhood is rebuilt after an edit. This covers cardinal and diagonal topology plus gap-based special structures while avoiding a full-town rebuild.

## Procedural-building rules

- An isolated low cell becomes a compact house with a steep roof.
- Exposed sides receive windows, doors, sills, and quay walls; shared sides merge visually.
- Opposite neighbors create a row; adjacent neighbors make a corner and can grow a balcony.
- Dense clusters use flat roof decks, parapets, and roof gardens.
- An isolated stack of three or more levels becomes a flagged tower.
- Three or four buildings around an empty cell shelter a planted courtyard.
- Two opposing two-storey buildings form a sea arch over an empty cell.
- Raising both sides to three storeys transforms that crossing into a high pedestrian bridge.
- Shoreline edges deterministically gain docks and other tiny details from the saved seed.

Large form is entirely topology-driven. Decorative variation uses a coordinate hash, so loading the same seed and grid recreates the same town.

## Simulation architecture

`main.ts` owns the render loop, input, camera, water, ambience, audio hooks, and persistence. `CityRenderer` owns the sparse world model and derives Three.js scene groups from it. Future citizens should live in a separate fixed-step simulation and consume a navigation graph generated from foundations, entrances, courtyards, bridges, and stairs.

Static meshes are consolidated by material within each cell, while animated details remain separate. Materials and citizen geometry are shared; tiny details do not enter the shadow pass; shadow maps update periodically rather than once per frame. A frame-time governor gradually lowers pixel ratio on slower devices and, only as a final fallback, disables dynamic shadows. Press `P` to inspect FPS, draw calls, triangles, and current render scale.

The current version-4 save contains the grid, RNG seed, simulation state, discovered event IDs, and journal entries. Versions 1–3 remain loadable, and writes are debounced into `localStorage` after every edit or discovery.

## Discovery/event system

The event layer evaluates declarative condition trees against a cloned, frozen world snapshot and commits effects through narrow city, citizen, and presentation APIs. Conditions query topology, population, time, businesses, relationships, and prior discoveries. Events explicitly declare whether they repeat; the current 15 are one-shot and idempotent by stable ID. Each committed event records a witnessed note in the illustrated harbor journal.

Courtyard, arch, bridge, and tower morphs anchor the architectural discovery chain. Population, friendship, opening-hour, and business branches eventually converge on a quiet whole-town observation. Feedback remains diegetic: a brief glimmer in the world, a soft sound, a camera-independent caption, a resident reaction, and a field note.

## Planned milestones

1. **Townscaper toy — implemented.** Direct placement/removal, constrained orbit/zoom, local topology rebuilding, houses, rows, corners, towers, quays, docks, courtyards, arches, bridges, ambient water, boat, birds, animation, and deterministic saves.
2. **Living town — implemented.** Entrances, a topology-derived walk graph with A*, persistent named citizens, homes, routines, friendships, citizen inspection cards, simulation speed controls, and an eight-minute day/night cycle.
3. **Businesses — implemented.** Trait- and occupation-driven bakery, café, workshop, fishmonger, and inn transformations, each with an owner, opening hours, visual storefront language, and citizen destinations. Businesses emerge one at a time as population grows, relocate if access is enclosed, and persist with the town.
4. **GROW system — implemented.** A reusable read-only snapshot and condition/effect graph, 15 chained discoveries with stable IDs, additive save migration, diegetic presentation beats, and an illustrated observation journal.
5. **Polish and quiet finale.** Vegetation and wildlife chains, boats using water topology, relationships, richer sound, nighttime lighting, festival, blossom, lantern finale, and developer inspection panel.
