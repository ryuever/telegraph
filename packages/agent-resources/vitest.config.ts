import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/agent-capabilities': resolve(__dirname, '../agent-capabilities/src'),
      '@/packages/agent-extensions': resolve(__dirname, '../agent-extensions/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../agent-protocol/src'),
      '@/packages/agent-resources': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
  },
})
