import { defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/agent-protocol': resolve(__dirname, '../agent-protocol/src'),
      '@/packages/agent': resolve(__dirname, 'src'),
      '@/packages/services/log': resolve(__dirname, '../services/src/log/src'),
    },
  },
  test: {
    environment: 'node',
  },
})
