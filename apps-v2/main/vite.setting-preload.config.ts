import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@telegraph/setting': resolve(__dirname, '../setting/src'),
      '@telegraph/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
    },
  },
  build: {
    outDir: '.vite/preload',
    lib: {
      entry: resolve(__dirname, '../setting/src/application/electron-browser/preload.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: 'setting-preload.js',
      },
    },
  },
});
