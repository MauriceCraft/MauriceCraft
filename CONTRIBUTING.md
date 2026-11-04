# Contributing

Thanks for improving MauriceCraft! Make changes in small, focused commits so it's easy to understand and learn from them.

## Before you submit

- Run `npm run typecheck`, `npm run build`, and `npm test` when the test suite is available.
- Include unit tests for gameplay rules, and smoke tests for UI, saving, and mobile flows when those change.
- Update README or `docs/` if commands, controls, or architecture change.
- Manually check a small mobile viewport and a desktop viewport for UI changes.

## Code rules

- New logic uses typed TypeScript in a focused module. Avoid adding features directly to the large `bootstrap.ts` unless necessary for integration.
- Never put new JavaScript or CSS inside `index.html`.
- Keep deterministic world rules, crafting, and parsing independent of the browser.
- Keep storage database/store names, block IDs, seeds, and save schemas backward-compatible. No silent IndexedDB resets.
- Prefer existing packages over maintaining duplicate implementations, but avoid unnecessary UI frameworks and large runtime dependencies.
- Make commits with a clear purpose; do not combine unrelated formatting with gameplay changes.
- Do not introduce a new error suppression, broad `any`, or test deletion merely to make checks pass.
