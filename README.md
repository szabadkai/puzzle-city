# Little Tides

A small, polished sandbox city-building prototype inspired by effortless architectural sculpting and miniature living dioramas.

Click anywhere in the harbor to raise a foundation, click existing structures to build upward, and arrange neighboring pieces to discover courtyards, plazas, canals, arches, bridges, towers, arcaded rows, stepped terraces, shared rooftop courts, covered skybridges, docks, water stairs, and other procedural transformations. Many shapes keep growing: courtyards become cloisters and pavilions, arcades gain roof promenades, terraces gather gardens and lanterns, and water crossings can rise through five distinct forms. Foundations can stand alone as little islets or grow together into a continuous town.

Every accessible home attracts a named resident. Taller homes support small households with children or elders. Citizens follow the town's quays and courtyards using A* routes, keep daily routines, form friendships and favorite-shop habits, and can be clicked to reveal their small lives and current destination. A full day passes in about eight minutes, with pause, normal, and fast simulation controls.

As the population grows, residents may quietly turn their ground floor into a bakery, café, flower shop, workshop, bookstore, fishmonger, restaurant, tea house, inn, or pottery studio. Each has its own storefront details and opening hours. Repeat customers can become regulars, and a nearby adult regular may eventually stay on as a helper.

The town also keeps an observation journal. Forty-seven quiet one-shot discoveries connect its architecture, water topology, working boats, residents, friendships, time of day, businesses, gardens, wildlife, a mysterious traveler, and a lantern-lit finale. Six cooldown-backed moments can recur on later days as the town settles into recognizable habits, but each earns only one journal entry. Open **Journal** (or press `J`) to revisit the illustrated field notes the town has revealed.

The journal also carries three **Whispers on the Tide**: nearby discoveries chosen from the live GROW condition graph. Follow one to keep its changing clue and progress in view while shaping the harbor. Completed observations can be revisited from their journal entry, refocusing the camera and inviting citizens or wildlife to briefly remember the moment.

Rowboats trace the changing shoreline; docks can lead to fishing, merchant arrivals, and a last ferry. Friends pause for shared meals and conversations, courtyard cuttings spread to rooftop pots, and the harbor gradually gathers circling and feeding gulls, sheltered-water fish, dock crabs, harbor cats, garden butterflies, blossom, festival ribbons, fireflies, and lantern light. Courtyard trees grow over several simulated days, waterfront walls gather salt and sheltered walls moss, working shops leave soot, and habitat-supported cat colonies slowly welcome kittens. These changes add history rather than maintenance pressure, and time never advances while the game is closed. Wildlife perches, feeds, wanders, swims, and scatters when construction disturbs it. A hidden late-game chain brings a traveler, rare tree, bird nest, clock tower, coordinated gathering, floating lanterns, and fireworks without ending the sandbox.

## Controls

- Left click: build
- Right click: remove a level or structure
- Click and drag: move the view
- Middle or right drag: orbit
- Mouse wheel: zoom
- Touch: one-finger drag orbits; two-finger drag moves; pinch zooms
- J: open or close the observation journal
- P: toggle the performance overlay
- G: toggle the GROW developer inspector (including nav visualization, event forcing, citizen spawning, and time controls)

## Development

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

The `main` branch is automatically deployed to GitHub Pages by GitHub Actions.

Press `P` to toggle the lightweight performance overlay while testing a larger town.

## Credits

Background music: [“Caketown - Cute/playful”](https://opengameart.org/content/caketown-cuteplayful) by [Matthew Pablo](https://opengameart.org/users/matthewpablo), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The included MP3 is the original, unmodified file.
