import { defineConfig } from 'vite';

// A project Pages site is hosted at /MauriceCraft/; local dev stays at /.
export default defineConfig(({ command, isPreview }) => ({
  base: (command === 'build' || isPreview === true) ? '/MauriceCraft/' : '/',
  build: { outDir: 'dist', emptyOutDir: true },
}));
