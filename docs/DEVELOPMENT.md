# Development

1. Install Node.js 22 or newer (`.nvmrc` specifies 22) and npm.
2. Run `npm ci` to install exactly the locked dependencies, then `npm run dev`.
3. Run `npm run check` before calling a change complete; this covers ESLint, strict TypeScript, unit coverage thresholds, and a production Vite build.
4. Run `npx playwright install chromium` once, then `npm run test:e2e` for desktop/mobile startup, gameplay and persistence regressions. `npm run check:full` runs both stages.

## Design principles

Keep browser APIs, WebGL, audio, and IndexedDB at integration boundaries. Put deterministic math, parsing, crafting, and rules into typed modules that can run in Node without WebGL. Prefer direct, named imports over global helpers. Avoid new dependencies unless they replace meaningful hand-written infrastructure.

Refactor in small steps, and confirm Creative, Survival, Adventure, Spectator, portal travel, saves, and phone controls still work. Never delete browser storage to “fix” a migration issue. The HTML file is not a place for JavaScript or CSS implementations.

## Code quality

Use strict TypeScript, explicit dependency interfaces, two-space indentation, single-purpose modules, no unexplained magic numbers, and clear ownership of persistent data. The bootstrap only wires modules together. Do not use `@ts-nocheck` or bypass the 500-effective-line lint limit. Make small meaningful commits, and keep the architecture and testing docs current. Treat generation versions, inventory/block IDs, save data, and mobile input as high risk.
