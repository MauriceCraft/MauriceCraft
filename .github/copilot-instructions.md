# MauriceCraft coding-agent rules

Read `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, and `docs/DEVELOPMENT.md` before changing game behavior.

1. Preserve all existing game modes, desktop and mobile input, portal travel, and browser saves. Never reset the `blockcraft-worlds` IndexedDB database as a shortcut.
2. Implement new rules in small **typed** TypeScript modules. Keep DOM/WebGL/IndexedDB integration thin. The legacy `bootstrap.ts` exception is temporary: do not add `@ts-nocheck` elsewhere.
3. Prefer pure functions for testable rules, and add regression tests for defects. For mobile UI changes, test phone-sized interactions as well as desktop.
4. Use npm packages where a dependency is justified, but do not add React or a giant framework just to reorganize the game. Global HUD CSS is intentional until UI components are extracted.
5. Change tests/docs with behavior changes. Verify `npm run typecheck`, `npm run build`, and `npm test` (once available). Report any check not run.
6. Make small, meaningful commits and complete the full requested task; do not silently skip remaining requirements. Never include secrets or generated `dist/` files.
