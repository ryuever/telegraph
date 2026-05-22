import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@/apps/shared': resolve(__dirname, 'src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/main-metrics': resolve(__dirname, '../../packages/services/src/main-metrics/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src'),
      '@/packages/run-protocol': resolve(__dirname, '../../packages/run-protocol/src'),
      '@/packages/remote-protocol': resolve(__dirname, '../../packages/remote-protocol/src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../../packages/computer-use-protocol/src'),
      '@/apps/main': resolve(__dirname, '../main/src'),
    },
  },
});
