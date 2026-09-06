# Little Tides

Little Tides is a harbor-building sandbox about architecture and the lives that collect around it. Click the water to raise a home. Add floors or build next door, and the town redraws roofs, walls, paths, and waterfront details around your changes.

**[Play Little Tides](https://szabadkai.github.io/puzzle-city/)**

There is no budget to balance and no failure state. You shape the harbor, then watch residents decide what to do with it.

## How the town grows

Buildings react to their neighbors. Leave a strip of water between two homes and you can turn it into a canal, sea arch, high bridge, covered skybridge, or lantern gate. Rows become arcades. Uneven roofs become stepped gardens. Dense blocks open into courtyards, shared roof courts, and plazas. A short First Tide guide teaches the basic moves without showing the hidden grid.

The Formation Atlas records 18 forms as you find them. These forms affect the simulation. Residents visit them, suitable trades open nearby with fewer residents, and nearby workshops make larger batches. The Atlas remembers a form after you rebuild the spot where it stood.

Put compatible forms close together and the town creates one of 14 living places. A Canal Market draws merchant boats. A Ferry Quarter runs a passenger route. A Story Court brings children and elders together. Each place adds its own landmark and marks nearby buildings with details such as route boards, rain chains, cloth, letter boxes, or kites. Shops also remember which place first attracted them.

After you discover four living places, the Atlas opens a third layer with seven Confluences. Each requires three formations in a tight cluster. A Confluence replaces its smaller local landmarks with one larger landmark, while the original trade bonuses stay active.

Every reachable home gets a named resident. Taller homes can hold small households with children or elders. Residents walk the actual quays, bridges, courtyards, and rooftops. They keep schedules, make friends, choose favorite shops, and stop for conversations or meals. Click one to see where they live, what they like, and where they are going. One full day takes about eight minutes.

As the population rises, residents open bakeries, cafes, workshops, inns, and other businesses on accessible ground floors. Seventeen production steps connect the working harbor. Fish and herbs come from town. Merchant boats bring grain, timber, clay, and fiber to a dock. Workers carry those supplies to shops, and finished export crates leave the real inventory when the merchant sails away.

Recent customers and successful production make prosperity visible. Comfortable shops set extra goods outside, flourishing shops raise a pennant, and customers carry parcels home. When several trades flourish together, a fair-weather market opens every few days at a harbor plaza or along an arcade. Its stalls pack away again that afternoon, and quiet shops gradually lose their extra displays.

The journal records 72 one-time observations and six daily habits. Its stories cover architecture, work, weather, friendships, wildlife, and a traveler who arrives late in the game. Five longer stories light the Harbor Lanterns. Light all five, build a Lantern Square, and visit it between 19:00 and 23:00 for the finale. The sandbox stays open afterward.

The harbor keeps changing between discoveries. Trees mature over several simulated days. Foot traffic wears paths smooth. Rain brings in laundry and sends animals under cover. Boats follow the shoreline, cats gather near fishmongers and inns, and fish prefer sheltered water. The game saves the simulation clock when you close it, so nothing advances while you are away.

You can save the current town as a PNG postcard. The image also contains the save data, so Little Tides can load the town from the picture later. The same panel can export the visible buildings as a printable STL model.

## Controls

- Left click: build
- Right click: remove one floor or building
- Click and drag: move the view
- Middle or right drag: orbit
- Mouse wheel: zoom
- Touch: drag with one finger to orbit, drag with two fingers to move, and pinch to zoom
- J: open or close the journal
- I or Observe: inspect buildings, trees, residents, boats, cats, and waterlife
- P: toggle the performance overlay
- G: toggle the GROW developer inspector

## Development

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

Run the deterministic checks with `npm run test:formations`, `npm run test:crafting`, `npm run test:memory`, `npm run test:lanterns`, `npm run test:water-routes`, and `npm run test:render-structure`.

GitHub Actions deploys the `main` branch to GitHub Pages.

Press `P` while testing a larger town to see FPS, draw calls, triangles, render scale, fallback state, and an EMA breakdown of the main CPU work.

## Credits

Background music: ["Caketown - Cute/playful"](https://opengameart.org/content/caketown-cuteplayful) by [Matthew Pablo](https://opengameart.org/users/matthewpablo), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The included MP3 is the original file.

Background music: ["Déjà Vus"](https://opengameart.org/content/free-contemplative-fantasy-music-pack) by [YannZ](https://yannz41.itch.io), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original loop was transcoded from MP3 to 64 kbps AAC for a smaller mobile download. [Spotify](https://open.spotify.com/intl-it/artist/76CUcHd0t0XViSm9YBbHBw). Contact: [yziango@gmail.com](mailto:yziango@gmail.com).
