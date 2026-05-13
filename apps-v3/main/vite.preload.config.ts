import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@telegraph/main': resolve(__dirname, 'src'),
      '@telegraph/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@telegraph/connection': resolve(__dirname, '../connection/src'),
      '@telegraph/monitor': resolve(__dirname, '../monitor/src'),
      '@telegraph/setting': resolve(__dirname, '../setting/src'),
      '@telegraph/design': resolve(__dirname, '../design/src'),
    },
  },
  build: {
    outDir: '.vite/preload',
    lib: {
      entry: resolve(__dirname, 'src/application/electron-browser/preload.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['electron'],
      output: {
        entryFileNames: 'preload.js',
      },
    },
  },
});
