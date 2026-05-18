import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@telegraph\/agent-protocol\/(.+)$/,
        replacement: `${resolve(__dirname, '../agent-protocol/src')}/$1.ts`,
      },
      {
        find: '@telegraph/agent-protocol',
        replacement: resolve(__dirname, '../agent-protocol/src/index.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
  },
})
