# Little Tides — design notes

## Game pillars

- **Sculpt, do not zone.** The player touches the world directly and architecture responds.
- **Observation over management.** Town life should be legible through motion and visual change, not tables.
- **Discovery over instruction.** Interesting combinations quietly produce consequences.
- **A warm miniature.** Every system should help the town feel like a small physical diorama.
- **A storied harbor.** Layered eaves, laundry balconies, hand-painted signs, rooftop tanks, pipes, awnings, and warm window light suggest a fictional old East Asian port assembled across generations.

## World representation

The world is a sparse, integer-keyed square grid hidden under a continuous animated sea. Each occupied cell stores position, height, palette index, and a temporary construction timestamp. The visible building is regenerated from cell topology. The square grid is constrained to a soft circular patch so the buildable space reads as a tiny archipelago rather than an infinite board. Any cell within that patch can begin a new islet; foundations do not have to connect back to the existing town.

Only the edited cell and its immediate three-by-three neighborhood are rebuilt after an edit. This covers the cardinal topology and one-cell gap structures currently used by the generator while avoiding a full-town rebuild.

## Procedural-building rules

- An isolated low cell becomes a compact house with a steep roof.
- Exposed sides receive windows, doors, sills, and quay walls; shared sides merge visually.
- Opposite neighbors create a row; adjacent neighbors make a corner and can grow a balcony.
- Dense clusters use flat roof decks, parapets, and compact rooftop trees.
- An isolated stack of three or more levels becomes a flagged tower.
- Three or four buildings around an empty cell shelter a planted courtyard.
- Six or more buildings around a two-by-two opening form a paved harbor plaza with a central fountain and paired shade trees.
- Seed-selected exposed façades slowly claim a neighboring water edge for a garden plot; herbs and flowers fill in over time, while some plots eventually grow a small tree.
- Opposing buildings across one water tile grow through a canal → sea arch → high bridge → covered skybridge → lantern gate sequence as both sides rise from one to five storeys.
- Three buildings in a straight run become a sheltered arcade at two storeys and a lantern-lined roof promenade at three.
- Three buildings in a 1–2–3 height progression form an exterior stepped terrace; lifting the full sequence to 2–3–4 adds gardens, and 3–4–5 adds lanterns.
- Four equal-height buildings share a rooftop court at two storeys, a roofed pavilion at three, and a hanging garden from four storeys upward.
- A courtyard enclosed by three or four homes grows from a planted garden into a cloister at two storeys and a roofed courtyard pavilion at three.
- Shoreline edges deterministically gain docks, water stairs, and other tiny details from the saved seed.

Large form is entirely topology-driven. Cardinal heights determine exposed façades and connections, while diagonal crowding changes roofs from individual caps into shared-looking decks and gardens. Decorative variation uses a coordinate hash, so loading the same seed and grid recreates the same town.

## Simulation architecture

`main.ts` owns the render loop, input, camera, water, ambience, audio hooks, and persistence. `CityRenderer` owns the sparse world model and derives Three.js scene groups from it. Citizens live in a separate simulation and consume an A* navigation graph generated from foundations, entrances, courtyards, plazas, elevated bridges, and flat rooftop networks. Roof courts, promenades, and terraces receive discreet access hatches and daytime resident routines; bridge and rooftop nodes retain elevation in saves.

Static meshes are consolidated by material within each cell, while animated details remain separate. Materials and citizen geometry are shared; tiny details do not enter the shadow pass; shadow maps update periodically rather than once per frame. A frame-time governor gradually lowers pixel ratio on slower devices and, only as a final fallback, disables dynamic shadows. Press `P` to inspect FPS, draw calls, triangles, and current render scale.

Water topology is derived from exposed cell edges and shared by architecture, discoveries, harbor ambience, and fauna. It identifies deterministic docks, narrow canals, and sheltered water. Rowboats, fishing boats, merchant boats, and ferries follow separate deterministic, collision-safe water lanes around the changing town envelope; the working fleet changes as docks, occupations, businesses, discoveries, and daily sailing hours develop. The morning fishing boat carries a visible skipper and periodically casts a net, while fishers on land seek actual dock nodes instead of generic streets. Chimney smoke also follows the workday: bakery ovens wake before dawn, kitchens steam around meals, workshops fire by day, and homes smoke around breakfast and supper. A deterministic fauna layer derives habitat anchors from that same topology and from businesses: gulls fly, feed, perch, and scatter; fish school in sheltered water; crabs patrol docks; cats wander around fishmongers and inns; and butterflies stay near courtyards, plazas, and flower shops. Whales, dolphin pods, squid groups, and tuna packs occasionally pass around the outer harbor on staggered seed-derived schedules and collision-safe routes. Wildlife state comes from the saved seed, town, discoveries, and clock rather than a separate save payload. Relationship work uses spatial buckets and a fixed comparison ceiling rather than an unbounded all-pairs scan. Three-storey homes can support a second household member; age roles, favorite-shop visit histories, shop popularity, employees, and visitors are additive fields on the existing citizen and business saves.

The current version-7 save contains the grid, RNG seed, simulation state, discovered event IDs, journal entries, recurring-event cooldown timestamps, building foundation/renovation times, the founding time of the harbor-cat colony, and bounded crafting stocks/progression. Versions 1–6 remain loadable, and writes are debounced into `localStorage` after every edit, discovery, or production step.

## Town memory

Time adds history rather than upkeep. Courtyard trees grow continuously from young saplings into full canopies over roughly three simulated days. Their age is derived from the foundations that enclosed the courtyard, so reshaping upper floors does not erase the tree's history. Mature canopies add shaded seating and give cats an afternoon perch. Plazas and suitably dense flat roofs gain smaller trees immediately as part of their architecture. Exposed houses can also seed deterministic shoreline garden plots after 18–48 simulated hours. Those plots visibly fill in over the next two and a half days as herb beds, flower beds, or small trees, and disappear naturally if the player builds into their tile. Exposed façades accumulate deterministic, context-sensitive patina: salt on open waterfront walls, moss in sheltered clusters, soot around working food and craft businesses, and occasional rust streaks below rooftop tanks. Changing a building's height partially refreshes its surface, after which the patina gradually returns. Frequently visited businesses develop worn approach stones in coarse visit-count stages.

Once harbor cats are discovered, three founding cats establish a colony. A new kitten appears about every two simulated days and grows to adult size over the following two days. Fishmongers, inns, and up to two gardens determine the colony's carrying capacity, keeping reproduction legible and bounded. Coat colors and markings are inherited deterministically from the town seed. When habitat shrinks, displaced cats visibly walk out toward new harbor homes instead of silently disappearing.

Each simulated day has deterministic weather derived from the town seed. Passing showers add visible rain, roughen the water, darken surface response, bring in laundry, shelter butterflies, perch gulls, and keep cats close to cover. The Observe mode makes the system readable: selecting a building, courtyard tree, or cat shows its age and a short account of what time has done there. Five one-shot observations mark the first patina, first rain, mature tree, first kitten, and five-day-old house. All aging uses the running simulation clock; closing the game never advances or punishes the player. Patina updates are bucketed by simulated half-hour and rain band rather than recalculated every rendered frame.

## Discovery/event system

The event layer evaluates declarative condition trees against a cloned, frozen world snapshot and commits effects through narrow city, business, citizen, wildlife, ambience, and presentation APIs. Conditions query topology, adjacency, height, available storefronts, water configuration, population, citizen occupations, ages and traits, time, businesses, regular-customer habits, popularity, relationships, town-memory metrics, and prior discoveries. Fifty-two one-shot events are idempotent by stable ID. Six additional recurring town moments use persisted per-event simulated-hour cooldowns, so a reload cannot cause them to fire repeatedly. A recurring moment receives one illustrated journal entry the first time it is witnessed; later occurrences do not crowd the journal.

Courtyard, arch, bridge, and tower morphs anchor the architectural discovery chain. Population, friendship, opening-hour, and business branches eventually converge on a quiet whole-town observation. Feedback remains diegetic: a brief glimmer in the world, a soft sound, a camera-independent caption, a resident reaction, and a field note.

Later observations extend that graph through rooftop planting and returning gulls into blossom, an evening chorus, shared supper, festival ribbons, a ferry-borne traveler, rare tree, bird nest, clock tower, blossom at blue hour, and the all-lantern finale. The finale coordinates citizens, bells, the working fleet, floating sea lanterns, and fireworks while leaving play uninterrupted. Persistent visual state is derived from stable discovery IDs, so no parallel decoration save format is required. Press `G` to inspect the current snapshot, memory metrics, citizens, businesses, selected topology and event state, visualize navigation, force an event, spawn a citizen, or advance time by an hour or day.

## Planned milestones

1. **Townscaper toy — implemented.** Direct placement/removal, constrained orbit/zoom, local topology rebuilding, houses, rows, corners, towers, quays, docks, water stairs, canals, courtyards, plazas, arches, bridges, ambient water, boats, birds, animation, and deterministic saves.
2. **Living town — implemented.** Entrances, a topology-derived walk graph with A*, walkable courtyards, plazas, and elevated bridges, persistent named citizens, homes, routines, friendships, citizen inspection cards, simulation speed controls, and an eight-minute day/night cycle.
3. **Businesses — implemented.** Trait- and occupation-driven bakery, café, flower shop, workshop, bookstore, fishmonger, restaurant, tea house, inn, pottery, mill, smokehouse, weaver, and shipyard transformations, each with an owner, opening hours, visual storefront language, and citizen destinations. Businesses emerge one at a time as population grows, relocate if access is enclosed, and persist with the town.
4. **Crafting town — implemented.** Seventeen production steps connect fishing, herb growing, merchant imports, milling, baking, toolmaking, pottery, weaving, fish smoking, tea, supper, hospitality, boat fitting, and finished harbor exports. Goods are bounded and persistent, production waits quietly for missing inputs, first completions receive small diegetic notices, workers carry visible cargo between reachable businesses, and Observe mode explains each workshop’s active input/output chain.
5. **GROW system — implemented.** A reusable read-only snapshot and condition/effect graph, 52 chained one-shot discoveries, six cooldown-backed recurring moments, stable IDs, additive save migration, diegetic presentation beats, and an illustrated observation journal.
6. **Polish and quiet finale — implemented.** Deterministic vegetation and stateful fauna chains, a four-class topology-aware fleet, bounded shared relationship activities, layered harbor sound, local nighttime lights, festival and blossom sequences, the lantern finale, and a developer inspection panel.
