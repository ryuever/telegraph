import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@/apps/design': resolve(__dirname, 'src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  test: {
    environment: 'happy-dom',
  },
})
