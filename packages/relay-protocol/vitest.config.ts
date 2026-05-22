import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/relay-protocol': resolve(__dirname, 'src'),
      '@/packages/remote-protocol': resolve(__dirname, '../remote-protocol/src'),
      '@/packages/run-protocol': resolve(__dirname, '../run-protocol/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../agent-protocol/src'),
    },
  },
  test: {
    environment: 'node',
  },
})
