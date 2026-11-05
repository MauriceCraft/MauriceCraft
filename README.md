# MauriceCraft

A browser-based block-building adventure inspired by Minecraft, built to run on school Chromebooks, computers, and phones. Play Creative, Survival, Adventure, or Spectator mode, explore generated terrain and structures, craft items, and visit the Nether and End.

## Quick start

Requires **Node.js 22+** and npm.

```sh
npm install
npm run dev
```

Open the local address printed by Vite. For a production build, run `npm run build` and `npm run preview` (preview the build under `/MauriceCraft/`).

## Controls

Desktop: **WASD** to move, **Space** to jump, mouse to look, left/right click to break/place, **1–9** or wheel to select, **I** for inventory, **C** for crafting, **T** or **/** for commands, and **Esc** to pause. Creative mode supports flight with **F** or double-tap Space. The in-game menu documents additional shortcuts.

Mobile: use the on-screen movement area, drag to look, and tap the on-screen Jump/Place/Bag/Cmd controls. Inventory, crafting, and the pause menu are touch-friendly.

## Exploring generated worlds

New worlds use generator v2: 11 climate-driven biomes (plains, forest, flower meadow, savanna, desert, badlands, marsh, snowy taiga, tundra, highlands and volcanic highlands), distinct tree silhouettes and densities, lakes and lava pools, cliffside cascades, and less repetitive villages. Weather can now shift between clear, cloudy, rain, and thunderstorms. Worlds use 32-bit seeded generation; the same seed and generator version reproduce the same starting terrain.

**Existing saves are preserved:** worlds created before this change stay on generator v1, including in unexplored chunks. Create a **New World** to see the new biomes and natural features. Do not rewrite an old world's generator version unless you deliberately accept terrain discontinuities.

## Saved worlds

Saves live **only in your current browser** in IndexedDB. They are not stored in this GitHub repository or synchronized across devices. Clearing site storage, switching browser profiles/devices, or changing the website origin can make saves inaccessible. The database name and saved data format are intentionally unchanged in this refactor.

## Project scripts

- `npm run dev`: development server
- `npm run typecheck`: TypeScript check
- `npm run check`: lint, typecheck, unit coverage and production build
- `npm run test:e2e`: browser regression tests on desktop and mobile
- `npm run build`: check types and build to `dist/`
- `npm run preview`: serve the production build
- `npm test`: run unit and regression tests

New here? Start with [**Build your game: first steps**](docs/START_HERE.md), [**copy-and-edit agent prompts**](docs/AGENT_PROMPTS.md), and [**coding-agent rules**](AGENTS.md).

For help making a Nether portal, see [the Nether portal guide](docs/PORTALS.md).

See [architecture](docs/ARCHITECTURE.md), [development guide](docs/DEVELOPMENT.md), [deployment](docs/DEPLOYMENT.md), and [contributing](CONTRIBUTING.md).
