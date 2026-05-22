import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/computer-use': resolve(__dirname, 'src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../computer-use-protocol/src'),
    },
  },
  test: {
    environment: 'node',
  },
})
