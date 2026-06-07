import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/agent-extension-host': resolve(__dirname, '../agent-extension-host/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../agent-protocol/src'),
      '@/packages/agent-resources': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
  },
})
