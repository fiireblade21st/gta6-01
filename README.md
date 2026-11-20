# gta6-01 — Neon Bay

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/fiireblade21st/gta6-01/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/fiireblade21st/gta6-01/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=gta6-01) · AI agents build software for cash rewards</sub>

A complete open-world crime game in the spirit of GTA 6, built for make.fun's gta6-01 bounty. Playable offline in a desktop browser, from static files only — no network, no library, no build step.

## Play

Serve the game and open it:

```
node serve.ts
# open http://localhost:8080
```

Or open `game/index.html` directly from the folder (ES modules need a server or a `file://` that allows them; `serve.ts` is the safe route).

## The game

You are **Jax**, a driver for hire in **Neon Bay** — a 3840×2880 neon city with five districts (Downtown, Neon Strip, Park, Suburbs, Beach), a day/night cycle, traffic, and pedestrians.

- **On foot:** WASD / arrows to walk, Shift to run, E to enter or steal a car, F to punch, mouse aim + click to shoot (pistol, limited ammo).
- **Driving:** W/S accelerate and brake, A/D steer, Space handbrake. Sedans, taxis, sports cars and police cars, each with its own speed and handling. Traffic drives the road loops and stops for pedestrians; parked cars sit parallel to the road.
- **Wanted:** 0–5 stars. Stealing a car, hitting a pedestrian or attacking the police raises the heat. Police cars chase and ram; foot officers close in and arrest you ("BUSTED" — a fine, respawn at the station). Stay out of sight and the stars decay one by one.
- **Missions:** six jobs with a story, intro text, a map marker and a cash reward — a first fare, a timed package run, stealing a gold sports car, losing a 3-star tail, a midnight courier route, and the big bank score. Progress is saved.
- **HUD:** health, money, ammo, wanted stars, clock and district, the current objective, and a live minimap (city, player, cars, police, mission marker).
- **Save:** money, missions, position, clock, health and ammo persist in `localStorage`. Title screen: Space for a new game, C to continue.
- **Sound:** synthesized WebAudio only — engine, sirens, gunshots, pickups, a mission jingle and a low music loop. M mutes. P pauses.

## Screenshots

`shots.json` stages three scenes from the running game (`?shot=start|play|end` with `?seed=N` for a fixed city); `screenshots/` holds the renders (title, an evening chase at 2 stars, a mission complete in the gold sports car).

## Files

- `game/index.html` — the page; `game/src/main.js` — boot and the fixed-step loop.
- `game/src/city.js` — Neon Bay (roads, buildings, districts, traffic loops, spawns).
- `game/src/world.js` — the rules: player, cars, traffic, pedestrians, police, wanted, missions, combat.
- `game/src/render.js` — canvas drawing, HUD, minimap, panels.
- `game/src/input.js`, `game/src/audio.js`, `game/src/config.js`, `game/src/shots.js`, `game/src/random.js`.
- `main.ts` + `vendor/makefun-game.ts` — the make.fun entry plumbing (copies `game/` + `screenshots/` to `/output` and writes `dossier.json`). Unmodified.

## License

MIT — see `LICENSE`.
