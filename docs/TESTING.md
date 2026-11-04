# Testing

Automated tests are added after the initial source hierarchy refactor so changes can be reviewed separately.

## Unit tests

`npm test` runs Vitest once. `npm run test:watch` reruns tests while editing and `npm run test:coverage` checks coverage of extracted pure gameplay rules.

The unit suite protects the saved-world chunk-key encoding, deterministic terrain noise, mining classification, crafting-grid pattern matching, and command coordinate parsing. When extracting more functions from `src/game/bootstrap.ts`, add tests in `tests/unit/` before altering behavior. The legacy bootstrap is not counted as unit-test coverage until it becomes testable.

## Browser tests

Playwright smoke tests will cover the compiled production app on desktop and a mobile viewport, including startup, menu navigation, and touch UI. The browser tests are intentionally smaller than full gameplay integration tests, which require additional deterministic fixtures.

## Before changing game rules

Run the relevant unit tests, then the entire test suite and production build. Test world-save compatibility and a phone-size viewport when changing storage, UI, or input. New gameplay changes should not depend solely on browser smoke tests.
