# Little Tides

A small, polished sandbox city-building prototype inspired by effortless architectural sculpting and miniature living dioramas.

**[Play Little Tides](https://szabadkai.github.io/puzzle-city/)**

Click anywhere in the harbor to raise a foundation, click existing structures to build upward, and arrange neighboring pieces to discover courtyards, plazas, canals, arches, bridges, towers, arcaded rows, stepped terraces, shared rooftop courts, covered skybridges, docks, water stairs, and other procedural transformations. Many shapes keep growing: courtyards become cloisters and pavilions, arcades gain roof promenades, terraces gather gardens and lanterns, and water crossings can rise through five distinct forms. Foundations can stand alone as little islets or grow together into a continuous town.

A four-step **First Tide** teaches that spatial language in the world itself: temporary golden ripples suggest pieces of a canal, sea arch, and shared-wall row without exposing or zoning the hidden grid. The journal's illustrated **Formation Atlas** records 18 architectural forms once discovered, preserves their clues after they are reshaped, and can refocus a form that still exists in the town. Its field-guide sketches show how crossings, streets, terraces, rooftops, courtyards, and landmarks take shape, with unfinished tracings for forms still waiting to be found. These are working places rather than badges: residents seek them out, compatible businesses favor nearby ground floors and may open sooner, and a well-sited workplace makes fuller production batches. Bring compatible forms into a genuinely compact arrangement and one of fourteen higher-order **living places** can emerge—from Canal Market, Garden Commons, and Makers’ Walk to Ferry Quarter, Tidepool Cloister, Story Court, Windloom Quarter, Bell Steps, Messenger’s Row, Star Garden, and Kite Steps. Ordinary pairings require formation centers within two tiles; only the larger plaza and high-harbor recipes allow three. After the town knows three forms across two architectural families, a quiet **Second Tide** invitation opens progressively revealed combination clues without painting zones. Every living place grows its own exclusive physical landmark, including a working Market Barge, Ferry House, Tide Cistern, Reading Loggia, Wind Loom, Tide Bell, Post House, Star Dial, or Kite Loft. Its character then spreads through a bounded nearby footprint: market rigging, route boards, rain chains, book boxes, dyed cloth, bell ribbons, letter boxes, constellation tiles, and bright kites make the affected blocks legible at a glance. Where two places overlap, the nearer landmark gives a building its dominant character. Each place also changes town life differently: merchants follow market awnings, a passenger ferry serves its quarter, rooftop neighbors gather, couriers bring letters, a survey boat reads the beacon, and nightly audiences find the theatre. Matching trades open sooner, prefer the influenced blocks, and produce fuller batches; a shop remembers which living place first drew it there even after the source forms are reshaped. The Atlas reports the active footprint and lasting trades, while Observe explains the influence on an individual building. Reshaping the source forms removes the active landmark and local spread naturally while preserving both Atlas memory and the history it left behind. Once four living places are known, a hidden third Atlas layer reveals seven **Confluences**: strict three-formation clusters such as the Grand Exchange, Tide Sanctuary, Festival Crown, and Celestial Beacon. Every pair of formation centers in the trio must be within three tiles, so a loose chain or district-scale triangle cannot qualify. Each raises a reversible grand landmark that supersedes its exact component landmarks, attracts residents, and earns its own story while leaving the component places’ economic effects intact rather than adding another production multiplier.

Every accessible home attracts a named resident. Taller homes support small households with children or elders. Citizens follow the town's quays and courtyards using A* routes, keep daily routines, form friendships and favorite-shop habits, and can be clicked to reveal their small lives and current destination. A full day passes in about eight minutes, with pause, normal, and fast simulation controls.

As the population grows, residents may quietly turn their ground floor into a bakery, café, flower shop, workshop, bookstore, fishmonger, restaurant, tea house, inn, pottery studio, mill, smokehouse, weaver, or shipyard. Each has its own storefront details and opening hours. Repeat customers can become regulars, and a nearby adult regular may eventually stay on as a helper.

Those workplaces form a persistent crafting town rather than a set of isolated decorations. Fish and herbs are gathered locally, while grain, straight timber, river clay, and loom fiber can only arrive by merchant boat at a working dock. The merchant now makes a legible round trip from open water: it curves into the quay, pauses while a deckhand and dock porter carry each incoming load from its cargo lighter into an open store, takes finished harbor goods aboard, and sails back beyond the town. Exported crates leave the real inventory, while stored sacks, logs, jars, and bales rise and fall with current stock; residents carry imports onward from there. Seventeen linked steps cover milling, baking, toolmaking, pottery, weaving, fish preservation, tea and supper, hospitality, boat fitting, and the finished export. Missing inputs simply make a workshop wait; Observe mode explains both the store and each workshop’s chain without adding upkeep pressure or a permanent inventory dashboard.

The town also keeps an observation journal. Seventy-two quiet one-shot discoveries connect its architecture, living places, Confluences, water topology, working boats, residents, friendships, time of day, town memory, businesses, gardens, wildlife, a mysterious traveler, and a lantern-lit finale. Six cooldown-backed moments can recur on later days as the town settles into recognizable habits, but each earns only one journal entry. Open **Journal** (or press `J`) to revisit the illustrated field notes the town has revealed.

After First Tide, the journal reveals a gentle long-term goal: light five **Harbor Lanterns** by completing the Blossom, Table, Chorus, Clock, and Welcome stories. Each earned light appears at the place that inspired it and can be inspected in Observe mode. Once all five are lit, build a Lantern Square and return there between 19:00 and 23:00. The lights answer one another, residents gather, and the harbor celebrates without ending the sandbox; an active Festival Crown turns its pavilion into the gathering place.

The journal also carries three **Whispers on the Tide**: nearby discoveries chosen from the live GROW condition graph. Follow one to keep its changing clue and progress in view while shaping the harbor. Completed observations can be revisited from their journal entry, refocusing the camera and inviting citizens or wildlife to briefly remember the moment.

Rowboats trace the changing shoreline; docks can lead to fishing, merchant arrivals, and a last ferry. Friends pause for shared meals and conversations, dense roofs and plazas gain compact trees, and exposed homes gradually seed deterministic shoreline plots with herbs, flowers, or small trees. The harbor also gathers circling and feeding gulls, sheltered-water fish, dock crabs, swimming turtles, harbor cats, garden butterflies, blossom, festival ribbons, fireflies, and lantern light. Courtyard trees grow over several simulated days, popular routes wear smooth, and habitat-supported cat colonies slowly welcome kittens. Seeded rain showers bring in laundry, shelter butterflies, and leave the harbor shining. These changes add history rather than maintenance pressure, and time never advances while the game is closed. Wildlife perches, feeds, wanders, swims, and scatters when construction disturbs it. A hidden late-game chain brings a traveler, rare tree, bird nest, clock tower, coordinated gathering, floating lanterns, and fireworks without ending the sandbox.

## Controls

- Left click: build
- Right click: remove a level or structure
- Click and drag: move the view
- Middle or right drag: orbit
- Mouse wheel: zoom
- Touch: one-finger drag orbits; two-finger drag moves; pinch zooms
- J: open or close the observation journal
- I or **Observe**: inspect buildings, trees, residents, boats, cats, and waterlife—including turtles
- P: toggle the performance overlay
- G: toggle the GROW developer inspector (including nav visualization, event forcing, citizen spawning, and time controls)

## Development

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

Run the deterministic checks with `npm run test:formations`, `npm run test:crafting`, `npm run test:memory`, `npm run test:lanterns`, and `npm run test:render-structure`.

The `main` branch is automatically deployed to GitHub Pages by GitHub Actions.

Press `P` to toggle the lightweight performance overlay while testing a larger town. It includes FPS, draw calls, triangles, render scale, fallback state, and an EMA breakdown of the main CPU subsystems.

## Credits

Background music: [“Caketown - Cute/playful”](https://opengameart.org/content/caketown-cuteplayful) by [Matthew Pablo](https://opengameart.org/users/matthewpablo), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The included MP3 is the original, unmodified file.

Background music: [“Déjà Vus”](https://opengameart.org/content/free-contemplative-fantasy-music-pack) by [YannZ](https://yannz41.itch.io), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original loop was transcoded from MP3 to 64 kbps AAC for a smaller mobile download. [Spotify](https://open.spotify.com/intl-it/artist/76CUcHd0t0XViSm9YBbHBw) · Contact: [yziango@gmail.com](mailto:yziango@gmail.com).
