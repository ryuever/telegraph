import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@/apps/main': resolve(__dirname, 'src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/apps/connection': resolve(__dirname, '../connection/src'),
      '@/apps/monitor': resolve(__dirname, '../monitor/src'),
      '@/apps/setting': resolve(__dirname, '../setting/src'),
      '@/apps/design': resolve(__dirname, '../design/src'),
      '@/apps/chat': resolve(__dirname, '../chat/src'),
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
