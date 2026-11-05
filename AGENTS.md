# How coding agents should help with MauriceCraft

Welcome! This is a game made by a young creator. **Explain changes kindly and in plain English.** Help him learn instead of just dumping code.

## Before editing

1. Read [Start here](docs/START_HERE.md), [project architecture](docs/ARCHITECTURE.md), and [contributing](CONTRIBUTING.md).
2. Restate the requested change in one or two simple sentences. If a task is big, split it into **small, playable steps**.
3. Name the files you expect to change and the tests that will prove it works.
4. Prefer letting the creator make the design decisions (game feel, colors, controls, features). Explain technical choices without jargon.

## Safety rules (these are not optional)

- **Protect existing worlds.** Keep the IndexedDB database name `blockcraft-worlds`, store keys, block IDs, and world format backwards-compatible. Never clear storage, delete saves, or reset schemas to make a bug go away.
- **Keep the game playable on phones and computers.** Keyboard, mouse, touch, the pause menu, inventory, and saving must continue working.
- **Fix the cause, not the symptom.** For any bug, first reproduce it and add a regression test that would catch it again. Add unit tests for pure gameplay rules; add browser tests when UI or controls change.
- Run `npm run check` and applicable Playwright tests before calling work finished. If something could not be run, say what and why.
- **Write typed TypeScript.** New logic goes in focused typed modules, not the bootstrap composition layer. Keep production modules at or under **500 lines** unless there is a documented, temporary exception; test files are exempt.
- Do not add `@ts-nocheck`, broad `any`, disabled tests, secrets, generated `dist/`, or unrelated changes.
- Preserve the Vite/GitHub Pages base path `/MauriceCraft/`. Pages must pass its own TypeScript and production-build checks; the independent CI workflow tests gameplay without blocking deployment.

## How to work

Make a small, understandable commit for each completed change. For each task, explain: **what changed**, **how to try it in the game**, **what tests ran**, and **what still needs work**. Never say tests passed unless they did.

## Reusable skill guides

Read the matching guide when your task fits:

- [Fix a bug](.github/skills/fix-a-bug/SKILL.md)
- [Add a game feature](.github/skills/add-a-feature/SKILL.md)
- [Write or improve tests](.github/skills/test-a-change/SKILL.md)

For sample requests to give an agent, see [Agent prompts](docs/AGENT_PROMPTS.md).
