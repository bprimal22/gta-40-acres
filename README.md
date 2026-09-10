# GTA 40 Acres

An unofficial third-person web game for exploring a playable recreation of the
University of Texas at Austin campus. It combines Three.js, Rapier physics,
locally authored campus geometry, and optional Google Photorealistic 3D Tiles
through Cesium ion.

**Live demo:** [gta40acres.pages.dev](https://gta40acres.pages.dev/)

This project is independent and is not affiliated with or endorsed by the
University of Texas at Austin, Rockstar Games, Take-Two Interactive, Google,
or Cesium. “GTA” is used informally in the project title and does not indicate
that Grand Theft Auto assets or code are included.

## Run locally

Requirements: Node.js 22.13 or newer.

```sh
npm install
npm run dev -- --host localhost --port 5173
```

Open [http://localhost:5173](http://localhost:5173).

The default photographic view needs a Cesium ion token that can read Google
Photorealistic 3D Tiles (asset 2275207). For local development, create
`../.local/cesium/credentials.env` with:

```dotenv
CESIUM_ION_TOKEN=your_restricted_token
CESIUM_GOOGLE_ASSET_ID=2275207
```

Restrict the token to `http://localhost:5173` and
`http://127.0.0.1:5173`. The credential file sits outside this repository and
must never be committed. You can also open
[local-only mode](http://localhost:5173/?offline=1), which uses bundled
geometry and makes no Cesium tile requests.

## Controls

- **WASD** or arrow keys: move
- **Shift**: run
- **Space**: jump or brake the scooter
- **F**: mount or dismount the scooter
- **V**: switch between character and campus overview
- **M**: open the travel map and click a destination
- Mouse drag: orbit the camera
- Scroll: zoom

## Build and check

```sh
npx tsc --noEmit
npm run build
npm run build:demo
```

The static demo build is written to `dist-demo/`. Hosting the guest-access
worker also requires server-side Cesium configuration; do not embed a Cesium
token in browser code or commit it to Git.

## Project structure

- `lib/campus/game.ts` owns the render loop, controls, camera, character, and
  fixed-step Rapier simulation.
- `lib/campus/photoreal.ts` streams photographic tiles and applies foreground
  repairs.
- `lib/campus/walkway.ts` assembles authored roads, landmarks, buildings, and
  matching collision surfaces.
- `lib/campus/terrain.ts` samples the same local triangle surface used by
  rendering and physics.
- `public/data/` contains compact derived campus plans.
- `public/assets/` contains redistributable local models and materials with
  source manifests and license records.

Local coordinates are measured in meters around longitude -97.73716 and
latitude 30.2861. X points east, Z points south, and Y points up.

## Data and asset licenses

Source code in this repository is released under the [MIT License](LICENSE).
Third-party assets retain their original licenses:

- Microsoft Rocketbox character and animations: MIT
- Poly Haven materials and foreground tree: CC0
- OpenStreetMap-derived roads and paths: ODbL
- Three.js: MIT
- Rapier: Apache-2.0

See [public/credits.txt](public/credits.txt) and the `sources.json` files under
`public/assets/` for attribution, URLs, revisions, and checksums. Google
Photorealistic 3D Tiles are streamed at runtime and are not included in this
repository. Research photographs and raw downloaded datasets are also excluded.

The public repository uses the generic Rocketbox character. The creator's
personal likeness textures used in a private development build are excluded.

## Current limitations

This remains an experimental campus reconstruction. Photographic tiles can
contain tree, entrance, and ground artifacts, while local-only mode uses
simplified architecture. Building dimensions, unseen facades, road widths, and
terrain transitions are approximate rather than survey-grade.
