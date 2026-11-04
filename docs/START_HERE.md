# Start here: build your game!

MauriceCraft is **your** game. You can add things one small step at a time. A coding agent can explain code, find bugs, write tests, and suggest changes. You still get to choose what makes the game fun.

## 1. Play first

Open the [MauriceCraft website](https://maniator.github.io/MauriceCraft/). Try walking, placing a block, using your inventory, and opening a saved world. Keep a short note of things you want to change.

**Important:** A saved world lives in the browser you played in. It is not in the GitHub repository. Don't clear your browser's site data to fix a problem.

## 2. Make a change on your computer

Install Node.js 22 and npm (or ask a parent to help install them once). Open a terminal in the project folder:

```sh
npm install
npm run dev
```

Vite will print a local website address, usually `http://localhost:5173/`. Open it in a browser. Change a small piece of game code, then refresh to see your result.

## 3. Ask the agent in a helpful way

A good request says **what you want**, **what should stay working**, and **how to check it**. Example:

> I want a new on-screen hint when the player opens their inventory. Please show me which files need editing, make the smallest safe change, and add a test. Keep mobile controls and saved worlds working. Explain what changed in simple language.

If the agent gives a huge change you don't understand, ask: “Can you split this into smaller steps and explain the first one?”

## 4. Check before calling it done

```sh
npm run check
```

This checks code style, TypeScript, unit tests, and the production build. For browser checks, run `npx playwright install chromium` once and then `npm run test:e2e`.

When a check fails, paste the **first useful error message** into the agent chat and ask it to fix that cause. Don't ask it to skip the check.

## 5. How to work safely

- Try one feature or bug fix at a time.
- Tell the agent not to remove save files or saved-world data.
- Ask for a test whenever gameplay changes.
- Ask “What will I notice when I play?” before merging.
- If you aren't sure about a change, ask the agent to explain it with an example.
- Don't paste passwords, private tokens, or personal information into issues or code.

## Good first missions

1. Fix a spelling mistake or confusing message, then check it in the game.
2. Change a menu hint or button label.
3. Add a unit test for an existing helper function.
4. Improve the instructions for a keyboard or touch control.
5. Make a small visual improvement and check it on a phone-sized screen.

For larger features like new mobs, dimensions, or save formats, start with a GitHub issue and a tiny working slice instead of a giant rewrite.
