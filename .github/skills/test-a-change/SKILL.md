---
name: test-a-change
description: Create useful unit and regression tests for MauriceCraft without testing implementation details or weakening quality gates.
---

# Test a change

Use this for test requests, new rules, bug regressions, CI failures, or code being extracted from bootstrap.

1. Name the behavior that matters to the player. Write down one normal case, one edge case, and one previously broken case.
2. Prefer **Vitest** for pure rules in `src/game/`; place unit tests in `tests/unit/`. For UI/startup/touch use **Playwright** in `tests/e2e/`.
3. Keep tests deterministic. Use tiny in-memory worlds, fake block readers, and fixed seeds rather than random clicks or waiting for a rare in-game event.
4. For storage changes, verify legacy `blockcraft-worlds` data remains readable. Never clear a real player's saved worlds in tests.
5. For mobile-related changes, include a narrow viewport/touch check.
6. Run the test, confirm it truly exercises the changed behavior, then run `npm run check`. Fix genuine failures instead of skipping assertions.
7. Explain to the creator what the test protects and how to rerun it.

Do not add tests that only assert file text or workflow YAML; prefer observable game behavior and real quality checks.
