import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/run-protocol': resolve(__dirname, 'src'),
      '@/packages/agent-protocol': resolve(__dirname, '../agent-protocol/src'),
      '@/packages/remote-protocol': resolve(__dirname, '../remote-protocol/src'),
    },
  },
  test: {
    environment: 'node',
  },
})
