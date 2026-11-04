import { defineConfig } from 'vite';

// A project Pages site is hosted at /MauriceCraft/; local dev stays at /.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/MauriceCraft/' : '/',
  build: { outDir: 'dist', emptyOutDir: true },
}));
