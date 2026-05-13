import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig(({ command }) => ({
  ...(command === 'serve' ? { base: '/' } : {}),
  plugins: [react()],
  resolve: {
    alias: {
      '@telegraph/main': resolve(__dirname, 'src'),
      '@telegraph/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@telegraph/main-metrics': resolve(__dirname, '../../packages/services/src/main-metrics/src'),
      '@telegraph/connection': resolve(__dirname, '../connection/src'),
      '@telegraph/daemon': resolve(__dirname, '../daemon/src'),
      '@telegraph/shared': resolve(__dirname, '../shared/src'),
      '@telegraph/monitor': resolve(__dirname, '../monitor/src'),
      '@telegraph/setting': resolve(__dirname, '../setting/src'),
      '@telegraph/design': resolve(__dirname, '../design/src'),
      '@telegraph/ui/useOrchestratorDashboard': resolve(__dirname, '../../packages/ui/src/hooks/useOrchestratorDashboard.ts'),
      '@telegraph/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    fs: {
      allow: ['..'],
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        setting: resolve(__dirname, 'setting.html'),
      },
    },
  },
}));
