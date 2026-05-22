import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/computer-use-protocol': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
  },
})
