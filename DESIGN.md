# Little Tides — design notes

## Game pillars

- **Sculpt, do not zone.** The player touches the world directly and architecture responds.
- **Observation over management.** Town life should be legible through motion and visual change, not tables.
- **Discovery over instruction.** Interesting combinations quietly produce consequences.
- **A warm miniature.** Every system should help the town feel like a small physical diorama.

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

The current save is versioned and contains the grid plus RNG seed. Writes are debounced into `localStorage` after every edit.

## Discovery/event system

The intended event layer evaluates declarative conditions against a read-only world snapshot and commits effects through system APIs. Conditions may query topology, population, time, businesses, prior discoveries, and adjacency. Events are idempotent by ID, optionally repeatable, and record a short witnessed note in the journal. Effects can add details, change citizen behavior, transform a cell, or enqueue a presentation beat.

The prototype already treats courtyard, arch, bridge, and tower morphs as the first topology discoveries. Their feedback is deliberately diegetic: a construction animation, a soft sound, a camera-independent caption, and a field note.

## Planned milestones

1. **Townscaper toy — implemented.** Direct placement/removal, constrained orbit/zoom, local topology rebuilding, houses, rows, corners, towers, quays, docks, courtyards, arches, bridges, ambient water, boat, birds, animation, and deterministic saves.
2. **Living town.** Entrances, walk graph and A*, small named citizens, homes, routines, and a compressed day/night cycle.
3. **Businesses.** Trait-driven bakery, cafe, workshop, fishmonger, and inn transformations with destinations.
4. **GROW system.** A reusable condition/effect graph, 15 chained discoveries, and an illustrated observation journal.
5. **Polish and quiet finale.** Vegetation and wildlife chains, boats using water topology, relationships, richer sound, nighttime lighting, festival, blossom, lantern finale, and developer inspection panel.
