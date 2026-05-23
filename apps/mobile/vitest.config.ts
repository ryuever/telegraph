import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/apps/mobile': resolve(__dirname, 'src'),
      '@/apps/remote-control': resolve(__dirname, '../remote-control/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src'),
      '@/packages/remote-protocol': resolve(__dirname, '../../packages/remote-protocol/src'),
      '@/packages/run-protocol': resolve(__dirname, '../../packages/run-protocol/src'),
    },
  },
  test: {
    environment: 'node',
  },
})
