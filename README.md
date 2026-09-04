# Little Tides

A small, polished sandbox city-building prototype inspired by effortless architectural sculpting and miniature living dioramas.

Click the water to raise a foundation, click existing structures to build upward, and arrange neighboring pieces to discover courtyards, arches, bridges, towers, docks, and other procedural transformations.

Every accessible home attracts a named resident. Citizens follow the town's quays and courtyards using A* routes, keep daily routines, form friendships, and can be clicked to reveal their small lives. A full day passes in about eight minutes, with pause, normal, and fast simulation controls.

As the population grows, residents may quietly turn their ground floor into a bakery, café, workshop, fishmonger, or inn. Storefronts emerge from resident traits and occupations; their opening hours then shape where neighbors walk and gather.

The town also keeps an observation journal. Twenty-three quiet discoveries connect its architecture, residents, friendships, time of day, businesses, gardens, wildlife, and a lantern-lit finale. Open **Journal** (or press `J`) to revisit the illustrated field notes the town has revealed.

Boats trace the changing shoreline, friends pause for shared meals and conversations, courtyard cuttings spread to rooftop pots, and the harbor gradually gathers gulls, blossom, festival ribbons, fireflies, and lantern light.

## Controls

- Left click: build
- Right click: remove a level or structure
- Click and drag: orbit
- Middle drag: pan
- Mouse wheel: zoom
- J: open or close the observation journal
- P: toggle the performance overlay
- G: toggle the GROW developer inspector

## Development

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

The `main` branch is automatically deployed to GitHub Pages by GitHub Actions.

Press `P` to toggle the lightweight performance overlay while testing a larger town.
