import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/extensions/telegraph-todo': resolve(__dirname),
      '@/packages/agent-capabilities': resolve(__dirname, '../../packages/agent-capabilities/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src/index.ts'),
    },
  },
})
