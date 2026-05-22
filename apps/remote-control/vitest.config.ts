import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/apps/remote-control': resolve(__dirname, 'src'),
      '@/packages/remote-protocol': resolve(__dirname, '../../packages/remote-protocol/src'),
      '@/packages/run-protocol': resolve(__dirname, '../../packages/run-protocol/src'),
    },
  },
  test: {
    environment: 'node',
  },
})
