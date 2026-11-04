# Prompts you can copy into a coding agent

You don't have to know how every file works before you start. Copy a prompt, replace the words in **[square brackets]**, and describe what you want.

## Fix something broken

> Please fix **[what broke]**. Here's how I saw it: **[steps to make it happen]**. Tell me why it happens in simple language. Add a test that fails before the fix and passes afterward. Keep existing saved worlds, mobile controls, and the other game modes working. Use a small commit and tell me how to try the fix myself.

## Add a fun feature

> I'd like **[feature]** because **[what it should do for the player]**. First propose the smallest playable version and which files it needs. Then implement it in typed TypeScript, with tests, and explain the controls. Keep each production module small. Don't rewrite unrelated parts of the game.

## Change a look or message

> Please improve **[screen/button/message]** so **[what I want]**. Keep it usable on a narrow phone screen and on desktop. Make the change easy to understand and add an appropriate browser regression test.

## Understand unfamiliar code

> I'm 12 and learning this game project. Please explain **[file or function]** like a friendly coding teacher. Give me a short example of what it does, where it is used, and one small thing I could safely change. Don't edit code yet.

## Fix a failing GitHub check

> The CI check **[name]** failed. Here is the relevant error: **[paste error]**. Find the actual cause, fix it without disabling the test or loosening the rules, run the relevant checks, and explain what happened.

## Save safety review

> Please review my change for risks to existing browser saves. The IndexedDB database is called `blockcraft-worlds`. Do not clear or reset it. Tell me what old saved-world data might be affected and add a compatibility test if needed.

## Handy agent skill files

Use `.github/skills/fix-a-bug/SKILL.md` for bug fixes, `.github/skills/add-a-feature/SKILL.md` for features, and `.github/skills/test-a-change/SKILL.md` for tests.

**Tip:** Ask the agent “Show me how to test this in the actual game” after it finishes.
