# Monsoon Drift · Mumbai Chai Rush

An original, India-inspired 3D open-world arcade driving game built for the browser. It takes the street-energy of a GTA-style city and rebuilds it as a cinematic, 60fps-friendly Mumbai-monsoon playground with Blender-authored characters, a live 3D rider preview, rainy streets, neon bloom, room-code multiplayer, and an installable PWA shell.

> This is an original vertical slice, not a copy of GTA VI and not a GPU cloud-streaming service. It is a cloud-hostable WebGL game: once deployed to Render, anyone with the URL can play solo or join Connect Play rooms in their own browser.

## Play

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal. For a production-style preview with the built-in multiplayer server:

```bash
npm run build
npm run preview
```

The preview server binds to `0.0.0.0:4173` by default and serves both the built game and the `/net` WebSocket endpoint. Set `PORT` to use another port. On a deployed HTTPS URL, the game is installable as a PWA; an **INSTALL APP** button appears in browsers that support `beforeinstallprompt`.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Accelerate | `W` / `↑` | `GO` button or push joystick up |
| Brake / reverse | `S` / `↓` | `BRAKE` button or pull joystick down |
| Steer | `A` `D` / `←` `→` | Left virtual joystick |
| Drift | `Space` | `DRIFT` |
| Boost | `Shift` | `BOOST` |
| Pause | `P` / `Esc` | Pause button |
| Instant restart | `R`, `Enter` or `Space` on game over | Restart button |
| Mute | `M` | Speaker buttons |

## Core loop

- Pick one of five Blender-made riders on the start screen; the live 3D preview, hero-car paint and saved selection update instantly.
- Start moving immediately: the first chai cup and boost pad are placed seconds from spawn.
- Thread through traffic for near-miss bonuses, chain cups and drifts to build an eight-step combo, and drive through glowing chai gates.
- Solo gates add nine seconds; Connect Play uses a shared 90-second score-attack clock.
- Damage, the clock, and combo decay create the risk/reward loop. Top-five high scores are stored locally in `localStorage`.

## Connect Play

`Connect Play` uses a small room server included in this repository — no external service is required.

1. Create a room and copy the invite link.
2. Open the link in another browser tab/device on the same server, or enter the four-letter code manually.
3. The host starts a shared run. Up to eight riders appear as named, color-coded ghost cars and compete on the live HUD leaderboard.

The same WebSocket server is attached in `vite.config.js` for development and in `server.mjs` for the built preview. Room state is fully in-memory and disappears when the server restarts.

## Blender asset pipeline

The hero car, city cars, auto-rickshaw, temple and chai stall are original low-poly assets authored with Blender's Python API. The playable cast and city NPCs are also Blender-authored, with separate arm/leg/head pivots for lightweight runtime animation:

- `tools/blender/monsoon_assets.blend` — editable vehicle/landmark source scene.
- `tools/blender/make_assets.py` — reproducible vehicle/landmark generator and glTF exporter.
- `tools/blender/monsoon_characters.blend` — editable character source scene.
- `tools/blender/make_characters.py` — reproducible character generator and glTF exporter.
- `public/assets/*.glb` — runtime binaries loaded by `GLTFLoader`.
- `public/icons/` and `tools/make_icons.py` — PWA icon source and generator.

Regenerate them with Blender or the `bpy` Python module:

```bash
blender --background --python tools/blender/make_assets.py
blender --background --python tools/blender/make_characters.py
python3 tools/make_icons.py
# or, with the bpy module:
PYTHONPATH=/path/to/bpy python3 tools/blender/make_assets.py
PYTHONPATH=/path/to/bpy python3 tools/blender/make_characters.py
```

At runtime, traffic, crowd NPCs and remote-player vehicles are merged into single vertex-colored meshes / instanced draws to keep draw calls low on mobile. The player car keeps separate wheel meshes for steering and spin animation; the menu rider and near-field pedestrians keep their Blender limb pivots.

## Performance notes

- Instanced buildings, windows, street lights, lane markings, garlands, palms, puddles and crowd NPCs.
- One shared particle `Points` buffer, one rain `LineSegments` buffer, and a cinematic bloom/output post-processing chain.
- Merged vertex-color geometry for traffic and instanced crowds; only the hero car, menu rider and nearby pedestrians keep detailed node hierarchies.
- Capped device pixel ratio, optional shadows, and automatic performance mode that disables bloom and lowers resolution if frame times slip.
- Delta-time clamped physics, no per-frame geometry allocation, and no external texture/font requests.
- Service worker caches the app shell, icons, JS/CSS and GLBs for faster repeat loads and offline solo play. Connect Play still needs the live `/net` server.

## Tech

Three.js + post-processing, Vite, WebAudio, Canvas 2D minimap, PWA/service worker, `ws` WebSockets, and Blender-generated glTF assets.

## Deploy to Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/Aidavil112/agentflow/tree/arena/2d55140b-agentflow)

This branch is ready for a one-click **Render** deployment. The button points at `arena/2d55140b-agentflow`; after this branch is merged into `main`, use `https://render.com/deploy?repo=https://github.com/Aidavil112/agentflow` instead.

`render.yaml` provisions one Node web service:

- Build: `npm ci --include=dev && npm run build`
- Start: `npm run preview` (`node server.mjs`)
- Health check: `/health`
- Region: `singapore` (low latency from India)
- Plan: `free`
- `PORT` is injected by Render; the server already binds `0.0.0.0` and serves both the game and the `/net` WebSocket endpoint.

Click the button, sign in to Render, connect GitHub, and confirm the service name. The first deploy builds `dist/` and then serves the full game, including **Connect Play** room-code multiplayer, over HTTPS/WSS. The HTTPS URL also enables the installable PWA and service-worker cache, so players can add Monsoon Drift to a phone or desktop home screen.

> Render's free web services spin down after inactivity and have a cold start on the next request. For an always-on public multiplayer room, switch the service to a paid Starter plan.
