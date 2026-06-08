import { configDefaults, defineConfig } from 'vitest/config'
import { resolve } from 'node:path'

export default defineConfig({
  resolve: {
    alias: {
      '@/packages/agent-capabilities': resolve(__dirname, '../agent-capabilities/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../agent-protocol/src'),
      '@/packages/agent-extensions': resolve(__dirname, '../agent-extensions/src'),
      '@/packages/agent-resources': resolve(__dirname, '../agent-resources/src'),
      '@/packages/agent': resolve(__dirname, 'src'),
      '@/packages/computer-use': resolve(__dirname, '../computer-use/src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../computer-use-protocol/src'),
      '@/packages/orchestrator-core': resolve(__dirname, '../orchestrator-core/src'),
      '@/packages/services/log': resolve(__dirname, '../services/src/log/src'),
    },
  },
  test: {
    environment: 'node',
    exclude: [
      ...configDefaults.exclude,
      'src/runtime/__tests__/PiAiRuntime.test.ts',
      'src/runtime/__tests__/PiEmbeddedRuntime.integration.test.ts',
      'src/runtime/__tests__/RunLifecycleManager.test.ts',
      'src/runtime/__tests__/MultiFrameworkRuntime.integration.test.ts',
      'src/runtime/__tests__/Phase3Integration.test.ts',
      'src/runtime/memory/__tests__/MemoryComponents.test.ts',
      'src/runtime/observability/__tests__/ExecutionTimeline.test.ts',
      'src/runtime/toolCoordination/__tests__/ToolCoordination.test.ts',
    ],
  },
})
