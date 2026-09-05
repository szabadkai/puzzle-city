# Little Tides

A small, polished sandbox city-building prototype inspired by effortless architectural sculpting and miniature living dioramas.

Click anywhere in the harbor to raise a foundation, click existing structures to build upward, and arrange neighboring pieces to discover courtyards, plazas, canals, arches, bridges, towers, docks, water stairs, and other procedural transformations. Foundations can stand alone as little islets or grow together into a continuous town.

Every accessible home attracts a named resident. Taller homes support small households with children or elders. Citizens follow the town's quays and courtyards using A* routes, keep daily routines, form friendships and favorite-shop habits, and can be clicked to reveal their small lives and current destination. A full day passes in about eight minutes, with pause, normal, and fast simulation controls.

As the population grows, residents may quietly turn their ground floor into a bakery, café, flower shop, workshop, bookstore, fishmonger, restaurant, tea house, inn, or pottery studio. Each has its own storefront details and opening hours. Repeat customers can become regulars, and a nearby adult regular may eventually stay on as a helper.

The town also keeps an observation journal. Forty-seven quiet one-shot discoveries connect its architecture, water topology, working boats, residents, friendships, time of day, businesses, gardens, wildlife, a mysterious traveler, and a lantern-lit finale. Six cooldown-backed moments can recur on later days as the town settles into recognizable habits, but each earns only one journal entry. Open **Journal** (or press `J`) to revisit the illustrated field notes the town has revealed.

Rowboats trace the changing shoreline; docks can lead to fishing, merchant arrivals, and a last ferry. Friends pause for shared meals and conversations, courtyard cuttings spread to rooftop pots, and the harbor gradually gathers circling and feeding gulls, sheltered-water fish, dock crabs, harbor cats, garden butterflies, blossom, festival ribbons, fireflies, and lantern light. Wildlife perches, feeds, wanders, swims, and scatters when construction disturbs it. A hidden late-game chain brings a traveler, rare tree, bird nest, clock tower, coordinated gathering, floating lanterns, and fireworks without ending the sandbox.

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
