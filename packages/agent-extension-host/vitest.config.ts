import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/agent-extension-host': resolve(__dirname, 'src'),
      '@/packages/agent-extensions': resolve(__dirname, '../agent-extensions/src'),
      '@/packages/agent-capabilities': resolve(__dirname, '../agent-capabilities/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../agent-protocol/src'),
    },
  },
  test: {
    environment: 'node',
  },
})
