import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/game/world/**/*.ts', 'src/game/crafting/**/*.ts', 'src/game/commands/**/*.ts'],
      exclude: ['src/game/bootstrap.ts'],
      reporter: ['text', 'lcov'],
      thresholds: { statements: 80, branches: 65, functions: 85, lines: 80 },
    },
  },
});
