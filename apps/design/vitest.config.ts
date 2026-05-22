import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/apps/design': resolve(__dirname, 'src'),
      '@/extensions/telegraph-subagents': resolve(__dirname, '../../extensions/telegraph-subagents'),
      '@/packages/agent': resolve(__dirname, '../../packages/agent/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/stores': resolve(__dirname, '../../packages/stores/src'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
