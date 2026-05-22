import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/apps/shared': resolve(__dirname, 'src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/main-metrics': resolve(__dirname, '../../packages/services/src/main-metrics/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/apps/main': resolve(__dirname, '../main/src'),
    },
  },
});
