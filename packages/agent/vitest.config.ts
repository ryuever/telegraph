import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/agent-protocol': resolve(__dirname, '../agent-protocol/src'),
      '@/packages/agent': resolve(__dirname, 'src'),
      '@/packages/computer-use': resolve(__dirname, '../computer-use/src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../computer-use-protocol/src'),
      '@/packages/orchestrator-core': resolve(__dirname, '../orchestrator-core/src'),
      '@/packages/services/log': resolve(__dirname, '../services/src/log/src'),
    },
  },
  test: {
    environment: 'node',
  },
})
