# OnSpace

**OnSpace** is an open-world space exploration game that runs in the browser. You can explore a procedurally generated galaxy, land anywhere on planets that spin and have day/night cycles, collect resources, craft, upgrade your gear and ship, trade at space stations, take contracts, catalogue alien life and follow the *Silent Signal* toward the galactic core.

It uses TypeScript and Three.js (WebGL 2). Everything in the game is generated at runtime from a seed: stars, planets, terrain, weather, creatures, ships, stations, structures, textures, sound effects and music. The project ships no art or audio files, so it has no licensing obligations beyond the libraries listed below. The art style is the same everywhere because every asset comes from the same toolkit.

```
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm test         # unit tests for deterministic generation & gameplay systems
```

It needs a browser with WebGL 2 (current Chrome, Edge, Firefox or Safari) and a dedicated or modern integrated GPU. You can change quality presets in **Settings**.

---

## The game loop

**Explore → Discover → Collect → Craft/Upgrade → Travel further → Encounter new things → Progress**

1. **Crash-landed.** You wake up next to your grounded ship. Its launch thrusters have no fuel.
2. **Gather and craft.** Mine blue crystals for Hydrex and rocks for Ferrox. Craft a *Launch Fuel Cell* and refuel the ship.
3. **Launch.** Fly from the ground straight into space with no loading screen, then use the pulse drive to cross the star system.
4. **Follow the Signal.** Each system has a Signal Monolith. Attuning to it teaches you the Hyperdrive, Warp Cell and Circuit blueprints.
5. **Station.** Dock at the orbital station to trade in a local economy, take procedural contracts, buy new ships, repair and refuel, and install upgrades.
6. **Hyperspace.** Install the hyperdrive, craft warp cells, pick a star on the 3D galaxy map and jump. The new system streams in while you are inside the warp tunnel.
7. **Keep going.** Each new system has new planet types, species, economies, pirates and Signal monoliths leading toward the core.

### Features
- **Seamless planets.** Cube-sphere quadtree LOD terrain is generated in Web Workers. Planets rotate, and the player and landed ship are carried along with the surface. Rayleigh/Mie atmospheric scattering works at any altitude, so there is no loading when you enter or leave a planet.
- **Eight planet archetypes:** Verdant, Pelagic, Arid, Glacial, Scorched, Caustic, Anomalous and Barren. They differ in terrain features (mesas, dunes, craters, spires, ridged mountains), liquids (water, lava, acid, ice), flora styles, hazards, weather and resources.
- **Living worlds.** Procedural fauna use six body plans with herding, grazing, fleeing and predator AI, animated gaits and synthesised calls. Warden drones react when you over-mine. Storms, lightning, rain, snow, dust, ash and spores come and go. Meteors strike and leave rare meteorites. Derelicts broadcast distress calls. NPC traders fly in and out of the station, and pirates ambush you.
- **Points of interest:** crash sites, Veil monoliths, abandoned outposts with crates and terminals, signal beacons, drop pods, ruins and rich ore deposits. All are deterministic per planet and remember when you have looted them.
- **Space.** Five ship classes with distinct procedural hulls and handling, a flight model with a virtual joystick, boost, pulse drive, auto-landing, docking, asteroid fields that stream in around you and can be mined, and ship combat with target leading.
- **Progression.** 15 upgradeable technologies, crafting, blueprints, tech fragments, a ship market with trade-in, credits, and uploading discoveries to earn money.
- **UI.** HUD with compass, world markers, vitals and flight instruments; exosuit inventory, crafting and technology screens; system and planet maps; mission and discovery log; 3D galaxy map; station services; settings; four save slots with JSON export and import.
- **Audio.** Everything is synthesised with Web Audio: engines, weapons, UI sounds, wind and rain ambience, creature calls, and generative music that changes with the situation.

---

## Controls

| Key | On foot | In ship |
|---|---|---|
| **Mouse** | Look | Steer (virtual joystick) |
| **W A S D** | Move | Throttle / roll |
| **Space** | Jump, hold for jetpack | Launch (when landed) |
| **Shift** | Sprint | Boost |
| **LMB** | Mine / fire | Photon cannons (also mine asteroids) |
| **E** | Interact / board ship | Disembark / Land / Dock |
| **Q** | Switch mining beam and boltcaster | – |
| **C** | Scanner pulse | – |
| **F (hold)** | Analysis visor | – |
| **R** | – | Pulse drive (in space) |
| **G** | Galaxy map | Galaxy map |
| **Tab / I** | Exosuit (inventory, crafting, tech) | same |
| **M / J / K / B** | Map / Log / Discoveries / Crafting | same |
| **L** | Flashlight | – |
| **V / H / F5 / Esc** | Third person / HUD / Quick save / Menu | same |

---

## Architecture

The code is split into modules by domain. Systems don't hold references to each other. They talk through the `Game` orchestrator or the typed `EventBus`.

```
src/
  core/        Game (orchestrator + mode state machine), Input (action bindings), EventBus,
               Settings (quality presets), Random (hashing + seeded PRNG)
  procgen/     Seeded simplex noise, names, colour utilities
  universe/    Plain-data descriptors: Galaxy → StarSystemGen → PlanetArchetypes (registry)
  world/       Runtime world: World (floating origin, lights, environment), StarSystem, Planet,
               Star, Skybox, Station, AsteroidField, Clouds, Weather, ScatterManager, FloraLibrary
    terrain/   TerrainGen (shared height/biome function), ChunkBuilder, terrain.worker,
               WorkerPool (priority queue), QuadTree (chunked LOD), TerrainMaterials
  entities/
    player/    Player (character controller + survival), Multitool, CameraRig, PlayerAvatar
    ship/      ShipDefs (class registry), ShipModel (procedural hulls), PlayerShip (flight model)
    creatures/ Species (generation), CreatureBuilder (rigs), CreatureManager (spawning + AI)
    npc/       Wardens (planetary drones), NpcShips (traders, pirates)
    poi/       POIs (deterministic sites, structures, interactables)
  gameplay/    Items (registry), Inventory, Crafting (recipes), Upgrades (tech registry), GameState
               (save data), Combat, Discovery, Economy, Missions, Quest, WorldEvents, Lore
  render/      Renderer (HDR pipeline), AtmospherePass, PlanetLighting, GeoKit (procedural
               modelling), Materials, Effects (pooled particles/beams), Textures, WarpTunnel
  audio/       AudioEngine (synthesised SFX, loops, generative music)
  save/        SaveSystem (slots, versioning, import/export)
  ui/          UI manager, HUD, screens (Exosuit, Map, Log, Station, Galaxy, Pause, Settings…)
```

### Key technical decisions
- **Deterministic generation.** Every location derives from `seed → system → planet → chunk → instance` hashes. Discoveries, looted sites and depleted resources are stored as stable IDs, so a world regenerated from its seed matches what you saw before.
- **Floating origin in double precision.** All game logic uses universe coordinates, which are JS doubles. The world root is offset by `-origin`, so render-space values stay small. Three.js builds its model-view matrices in doubles on the CPU, so float32 precision on the GPU is never a problem, even hundreds of kilometres from the star.
- **One height function.** `TerrainGen` runs both in the workers (to build meshes) and on the main thread (for collision, placement and landing), so what you see and what you stand on always match. Noise octaves are cut by wavelength, so distant LODs cost less to compute.
- **Quadtree LOD.** A node only splits once its bounds are known, so the tree stays small. A parent stays visible until all four children are ready, so no holes appear. Skirts hide cracks between LOD levels. Chunks beyond the horizon are culled, and results are uploaded within a per-frame time budget.
- **Per-planet lighting.** A single directional light would light far-away planets from the wrong side. Instead, standard materials are patched so each planet uses its own sun direction and a night-side ambient term.
- **Post pipeline.** HDR scene with a logarithmic depth buffer → screen-space atmospheric scattering that reads the decoded depth → bloom → filmic tonemapping and grading → FXAA.
- **Performance.** Workers generate the terrain; vegetation, rocks and asteroids are instanced; particles and projectiles come from pools; distance culling is applied per scatter type; asteroids stream in by cell; entities outside the play radius despawn; quality presets are exposed in Settings.

### Extending
- **New planet type:** call `registerArchetype({...})` in `universe/PlanetArchetypes.ts`.
- **New item or recipe:** `registerItem` / `registerRecipe`.
- **New technology:** `registerTech`. Consumers read the level with `state.level(id)`.
- **New ship class:** `registerShipClass`, then add a hull style in `ShipModel.ts`.
- **New mission type:** add a generator branch in `Missions.board()` and an event hook.
- **New point of interest:** add a type to `POIType` and a `case` in `POIManager.build()`.

---

## Credits & licences
- [three.js](https://threejs.org) — MIT licence.
- Fonts [Orbitron](https://fonts.google.com/specimen/Orbitron) and [Rajdhani](https://fonts.google.com/specimen/Rajdhani), via Fontsource — SIL Open Font License 1.1.
- Everything else (geometry, textures, shaders, audio, music, names, lore) is original and generated procedurally.

---

## Testing

- `npm test` runs the unit tests in `tests/`. They cover deterministic generation, noise bounds, chunk building, inventory rules, and checks that every recipe and tech entry refers to items that exist.
- `npm run typecheck` runs a strict TypeScript check.
- `tools/play.mjs` plus `tools/scenarios/*.mjs` are scripted Playwright play-tests. They run against `vite preview` on port 4173 and cover starting a new game, flight, docking, menus, mining, wildlife, hyperspace jumps, save → reload, combat, weather, points of interest and asteroid mining. Screenshots are written to `screenshots/`. Example: `npm run build && npx vite preview --port 4173 & node tools/play.mjs tools/scenarios/flight.mjs`.
