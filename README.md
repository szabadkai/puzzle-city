# Little Tides

Little Tides is a harbor-building sandbox set in a tiny fictional city unmistakably shaped by Hong Kong. Steep green hills hold a crowded harbor of pale tong-lau-inspired blocks, tiled shopfronts, rooftop life, ferries, working boats, and rain-dark stone. Click the water to raise a home. Add floors or build next door, and the town redraws balconies, roofs, paths, and waterfront details around your changes.

**[Play Little Tides](https://szabadkai.github.io/puzzle-city/)**

There is no budget to balance and no failure state. You shape the harbor, then watch residents decide what to do with it.

## How the town grows

Buildings react to their neighbors. Leave a strip of water between two homes and you can turn it into a canal, sea arch, high bridge, covered skybridge, or lantern gate. Rows become arcades. Uneven roofs become stepped gardens. Dense blocks open into courtyards, shared roof courts, and plazas. A short First Tide guide teaches the basic moves without showing the hidden grid.

The Formation Atlas records 18 forms as you find them. These forms affect the simulation. Residents visit them, suitable trades open nearby with fewer residents, and nearby workshops make larger batches. The Atlas remembers a form after you rebuild the spot where it stood.

Put compatible forms close together and the town creates one of 14 living places. A Canal Market draws merchant boats. A Ferry Quarter runs a passenger route. A Story Court brings children and elders together. Each place adds its own landmark and marks nearby buildings with details such as route boards, rain chains, cloth, letter boxes, or kites. Shops also remember which place first attracted them.

After you discover four living places, the Atlas opens a third layer with seven Confluences. Each requires three formations in a tight cluster. A Confluence replaces its smaller local landmarks with one larger landmark, while the original trade bonuses stay active.

Every reachable home gets a named resident. Taller homes can hold small households with children or elders. Residents walk the actual quays, bridges, courtyards, and rooftops. They keep schedules, make friends, choose favorite shops, and stop for conversations or meals. Click one to see where they live, what they like, and where they are going. One full day takes about eight minutes.

As the population rises, residents open egg-tart bakeries, cha chaan teng-inspired cafés, wet-market fish stalls, dai pai dong-inspired restaurants, tea houses, upstairs guesthouses, workshops, and other businesses on accessible ground floors. Projecting signs, corrugated shutters, tiled bases, window grilles, milk-tea booths, and evening tables make the trades readable in the street. Seventeen production steps connect the working harbor. Fish and herbs come from town. Merchant boats bring grain, timber, clay, and fiber beneath striped tarps, and finished export crates leave the real inventory when the merchant sails away.

Recent customers and successful production make prosperity visible. Comfortable shops set extra goods outside, flourishing shops raise a pennant, and customers carry parcels home. When several trades flourish together, a fair-weather market opens every few days at a harbor plaza or along an arcade. Its stalls pack away again that afternoon, and quiet shops gradually lose their extra displays.

The journal records 72 one-time observations and six daily habits. Its stories cover architecture, work, weather, friendships, wildlife, and a traveler who arrives late in the game. The Harbor Lanterns are a separate architectural mastery goal. Each lantern lights as the player completes its Confluence requirements through construction; already-complete layouts can be claimed from the journal. Build Festival Crown as the seventh and final Confluence, then choose when to begin the gathering. Days, weather, visitors, observation chores, and unattended simulation do not advance this goal. The sandbox stays open afterward.

The harbor keeps changing between discoveries. Trees mature over several simulated days. Foot traffic wears paths smooth. Frequent short showers bring in laundry, close evening tables, raise the storm signal in hard weather, and call ferries home early without damaging the town. Cream-and-green double-deck ferries and sampan-like boats follow the shoreline, black kites turn above the waterfront, pink Chinese white dolphins occasionally cross the outer water, and cats gather near fishmongers and guesthouses. Dragon boats and a bun-tower gathering keep their own rare seeded calendars rather than appearing as everyday decoration. The game saves the simulation clock when you close it, so nothing advances while you are away.

You can save the current town as a PNG postcard. The image also contains the save data, so Little Tides can load the town from the picture later. The same panel can export the visible buildings as a printable STL model.

Photo mode (the camera button, or `F`) pauses the town, hides the interface, and frames the view at 9:16, 4:5, or 16:9. It can change the hour, the weather, the depth of field, and the palette for the picture only. From there you can save a postcard with a wordmark, record the last 5, 10, or 15 seconds as an MP4 clip, render a timelapse of how the town grew, copy a share link, or send the file to the system share sheet. A share link carries the whole town in the URL, so anyone who opens it gets the same harbor.

Every new town uses the same Hong Kong-inspired building language and grounded harbor palette: cream, pale green, faded pink, turquoise, weathered concrete, dark green paint, amber interiors, and black rain-darkened stone. Photo mode keeps alternate color treatments as camera filters; they do not change the town's identity.

## Controls

- Left click: build
- Right click: remove one floor or building
- Click and drag: move the view
- Middle or right drag: orbit
- Mouse wheel: zoom
- Touch: drag with one finger to orbit, drag with two fingers to move, and pinch to zoom
- J: open or close the journal
- I or Observe: inspect buildings, trees, residents, boats, cats, and waterlife
- F: open or close photo mode
- H: hide or show the interface for a screenshot
- P: toggle the performance overlay with shadow and wind tuning
- G: toggle the GROW developer inspector

## Development

```bash
npm install
npm run dev
```

Create a production build with `npm run build`.

Run the deterministic checks with `npm run test:formations`, `npm run test:crafting`, `npm run test:memory`, `npm run test:lanterns`, `npm run test:water-routes`, `npm run test:render-structure`, and `npm run test:palettes`.

`npm run capture-test` loads a fixture town through a share link in headless Chromium, takes three default portrait screenshots, scales them to 200 px, writes a contact sheet next to any reference thumbnails in `scripts/capture-reference/`, and checks the draw-call and frame-time budgets. Add `-- --webkit` to also run WebKit, or `-- --dev` to test the dev server. The output lands in `test-output/`.

GitHub Actions deploys the `main` branch to GitHub Pages.

Press `P` while testing a larger town to see FPS, draw calls (scene plus post passes), triangles, the quality tier, render scale, fallback state, an EMA breakdown of the main CPU work, and GPU time per pass. The same overlay exposes shadow bias and wind strength sliders. The quality tier is detected on first load and can be forced from the About panel or with `?tier=low|mid|high`.

## Credits

Background music: ["Caketown - Cute/playful"](https://opengameart.org/content/caketown-cuteplayful) by [Matthew Pablo](https://opengameart.org/users/matthewpablo), licensed under [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The included MP3 is the original file.

Background music: ["Déjà Vus"](https://opengameart.org/content/free-contemplative-fantasy-music-pack) by [YannZ](https://yannz41.itch.io), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The original loop was transcoded from MP3 to 64 kbps AAC for a smaller mobile download. [Spotify](https://open.spotify.com/intl-it/artist/76CUcHd0t0XViSm9YBbHBw). Contact: [yziango@gmail.com](mailto:yziango@gmail.com).
