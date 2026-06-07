import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/apps/main': resolve(__dirname, 'src'),
      '@/apps/connection': resolve(__dirname, '../connection/src'),
      '@/apps/monitor': resolve(__dirname, '../monitor/src'),
      '@/apps/design': resolve(__dirname, '../design/src'),
      '@/apps/chat': resolve(__dirname, '../chat/src'),
      '@/apps/daemon': resolve(__dirname, '../daemon/src'),
      '@/apps/shared': resolve(__dirname, '../shared/src'),
      '@/apps/setting': resolve(__dirname, '../setting/src'),
      '@/docs': resolve(__dirname, '../../docs'),
      '@/packages/agent': resolve(__dirname, '../../packages/agent/src'),
      '@/packages/agent-capabilities': resolve(__dirname, '../../packages/agent-capabilities/src'),
      '@/packages/agent-extension-host': resolve(__dirname, '../../packages/agent-extension-host/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src'),
      '@/packages/agent-resources': resolve(__dirname, '../../packages/agent-resources/src'),
      '@/packages/computer-use': resolve(__dirname, '../../packages/computer-use/src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../../packages/computer-use-protocol/src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/main-metrics': resolve(__dirname, '../../packages/services/src/main-metrics/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/packages/stores': resolve(__dirname, '../../packages/stores/src'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
