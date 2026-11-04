---
name: add-a-feature
description: Safely add a small MauriceCraft feature, with typed modules, mobile UX, tests, and a short kid-friendly explanation.
---

# Add a feature

Use this when someone asks for a new block, tool, menu improvement, mob behavior, or other game feature.

1. Explain what the player will be able to do; suggest the **smallest playable version** first.
2. Identify files and potential effects on saved worlds, inventory IDs, world generation, or mobile controls.
3. Implement the rule in a focused typed module (prefer fewer than 400 lines; lint enforces 500) and wire it into the UI only where necessary.
4. Add unit tests for rules and regression tests for related old behavior. If players tap or click something, add an appropriate browser test.
5. Check phone and desktop layouts, preserving existing controls.
6. Update controls/help or README/docs when the player-facing behavior changes.
7. Run `npm run check` and appropriate browser tests. Use a small, meaningful commit.
8. Finish with: what the new feature does, how to try it, tests run, and any limitations.

For new blocks/items, keep old numeric IDs stable and avoid changing the shape of existing browser saves.
