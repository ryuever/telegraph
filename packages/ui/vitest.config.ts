import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/ui': resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
