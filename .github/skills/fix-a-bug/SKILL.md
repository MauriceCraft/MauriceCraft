---
name: fix-a-bug
description: Reproduce and repair a MauriceCraft gameplay or UI bug while teaching the young creator what changed.
---

# Fix a bug

Use this skill for broken controls, rendering, inventory, portal lighting, crashes, and other gameplay issues.

1. Ask for a reproducible example only if the report is too vague to proceed. Otherwise reproduce or inspect the failing path.
2. Explain the bug in two plain-language sentences: “What happens” and “Why.”
3. Find the smallest responsible module. Keep browser-specific code separate from pure rules.
4. **Write a regression test that demonstrates the failure first**. Use Vitest for gameplay logic and Playwright for browser input/UI behavior. For a portal defect, test both orientations and old saved portals.
5. Fix the root cause. Do not bypass TypeScript, tests, lint, or reset IndexedDB.
6. Run `npm run check` plus the relevant browser tests, report the exact results, and give manual steps to verify in-game.
7. Commit the repair and its regression test together with a clear message.

Keep explanations encouraging but factual. Tell the creator what he can learn from the fix.
