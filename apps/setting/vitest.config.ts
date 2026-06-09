import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/apps/setting': resolve(__dirname, 'src'),
      '@/packages/agent': resolve(__dirname, '../../packages/agent/src'),
      '@/packages/agent-capabilities': resolve(__dirname, '../../packages/agent-capabilities/src'),
      '@/packages/agent-extensions': resolve(__dirname, '../../packages/agent-extensions/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src'),
      '@/packages/agent-resources': resolve(__dirname, '../../packages/agent-resources/src'),
      '@/packages/computer-use': resolve(__dirname, '../../packages/computer-use/src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../../packages/computer-use-protocol/src'),
      '@/packages/orchestrator-core': resolve(__dirname, '../../packages/orchestrator-core/src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
})
