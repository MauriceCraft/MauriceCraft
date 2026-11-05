# Nether dimension follow-up

**Sequence:** Do not start the Nether feature work until Overworld generator v3, fluids, caves, animal/hostile spawning, landmarks, and mobile browser regressions have a green CI and GitHub Pages deployment. Keep this phase as small, reviewed commits.

## Goal

Entering a lit portal should lead to a **complete, continuously generated Nether**, rather than a mostly empty or incomplete area. Generate new chunks as explored, preserving deterministic seed results, coordinates, edited chunks, and safe return travel. "Complete world" does not mean allocating infinite terrain in memory.

## Features

1. **Portal reliability:** Flint & Steel lights correctly sized frames, shows the portal visually, transports players reliably, creates/links safe arrival and return portals and restores these links after reload. Include explicit blocked-site/invalid-frame feedback.
2. **Nether world generation:** Distinctive lava oceans, cliffs, enclosed networks, caves, lavafalls, paths, and coherent Nether biomes. Fortresses and bastions should have varied seeded designs and reasonable rarity, not identical copies. Preserve chunk-edge continuity.
3. **Nether ecosystem:** Piglins (including neutral/hostile behavior and equipment), zombified piglins, hoglins, ghasts, blazes, magma cubes and striders, with habitat-specific spawning, movement, combat and drops. Avoid normal Overworld cows/creepers spawning via Overworld-only rules.
4. **Liquid and rendering parity:** Lava flows and slopes in the Nether without runaway chunk generation or unbounded work on mobile. Verify meshing of ceilings, caves, lava, and structure interiors.
5. **Exploration/UI:** Dimension label, biome/nearby Nether features, suitable lighting/fog and safe spectator travel within generated caves.
6. **Persistence:** Dimension-aware chunk edits and saved portal pairs, with round-trip and reload integrity. Keep old worlds untouched, use explicit world-generation versioning if algorithms change.

## Test and release gate

- Deterministic generation at positive/negative coordinates and across chunk-generation order; no void gaps along traversable terrain.
- Unit tests for portal frame validation, lighting, linking, spawn rules, AI, fluid interactions, and legacy world loading.
- Playwright desktop and mobile: build and light a portal, enter the Nether, explore several chunks, observe piglin spawning, return to Overworld, reload and repeat.
- No direct world-generation logic in bootstrap; typed module boundaries; avoid excessive allocations in 60fps updates.
- Update player-facing help and docs; report final CI including coverage and GitHub Pages deployment before requesting manual testing.
