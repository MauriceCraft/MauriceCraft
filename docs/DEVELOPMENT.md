# Development

1. Install Node.js 22 or newer (`.nvmrc` specifies 22) and npm.
2. Run `npm install`, then `npm run dev`.
3. Run `npm run typecheck` and `npm run build` before merging any changes.
4. Run the test suite once the testing stage is installed. New gameplay features should be accompanied by tests.

## Design principles

Keep browser APIs, WebGL, audio, and IndexedDB at integration boundaries. Put deterministic math, parsing, crafting, and rules into typed modules that can run in Node without WebGL. Prefer direct, named imports over global helpers. Avoid new dependencies unless they replace meaningful hand-written infrastructure.

Refactor in small steps, and confirm Creative, Survival, Adventure, Spectator, portal travel, saves, and phone controls still work. Never delete browser storage to “fix” a migration issue. The HTML file is not a place for JavaScript or CSS implementations.

## Code quality

Use TypeScript for new code, explicit types for exported functions, two-space indentation, single-purpose modules, no unexplained magic numbers, and clear ownership of persistent data. Do not extend the legacy `@ts-nocheck` exemption to new files. Make small meaningful commits. Treat changes to world generation, inventory IDs, saved worlds, and input handling as high risk.
