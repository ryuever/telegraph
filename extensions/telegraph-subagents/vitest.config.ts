import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/extensions/telegraph-subagents': resolve(__dirname),
      '@/packages/agent': resolve(__dirname, '../../packages/agent/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src/index.ts'),
      '@/packages/orchestrator-core': resolve(__dirname, '../../packages/orchestrator-core/src'),
    },
  },
})
