/**
 * Phase 3 Comprehensive Integration Test
 *
 * Tests the complete Telegraph Agent Runtime system with:
 * - Multiple framework runtimes (LangGraph, VercelAI)
 * - Tool coordination (dependencies, rate limiting, permissions)
 * - Observability (execution timeline, metrics)
 * - Session management across runs
 *
 * Scenario: Multi-turn agent execution with complex tool orchestration
 */

import { createRuntime } from '../createRuntime'
import { DependencyGraph } from '../toolCoordination/DependencyGraph'
import { RateLimiter, type RateLimitConfig } from '../toolCoordination/RateLimiter'
import { PermissionValidator, type ToolPermissionPolicy } from '../toolCoordination/PermissionValidator'
import { ExecutionTimeline } from '../observability/ExecutionTimeline'
import { ToolRegistry, type ToolDefinition } from '../toolExecution/ToolRegistry'

// Test utilities
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEquals<T>(actual: T, expected: T, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message || 'Values not equal'}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`
    )
  }
}

/**
 * Mock tools for testing
 */
const mockFetchTool: ToolDefinition = {
  id: 'fetch_data',
  name: 'fetch_data',
  description: 'Fetch data from API',
  parameters: {
    type: 'object',
    properties: {
      url: { type: 'string' },
    },
    required: ['url'],
  },
  execute: async (args: Record<string, unknown>) => ({
    status: 200,
    data: { items: [{ id: 1, name: 'Item 1' }] },
  }),
  source: 'builtin',
}

const mockProcessTool: ToolDefinition = {
  id: 'process_data',
  name: 'process_data',
  description: 'Process fetched data',
  parameters: {
    type: 'object',
    properties: {
      data: { type: 'object' },
    },
    required: ['data'],
  },
  execute: async (args: Record<string, unknown>) => ({
    processed: true,
    itemCount: 1,
  }),
  source: 'builtin',
}

const mockStorageTool: ToolDefinition = {
  id: 'store_result',
  name: 'store_result',
  description: 'Store result in storage',
  parameters: {
    type: 'object',
    properties: {
      key: { type: 'string' },
      value: { type: 'object' },
    },
    required: ['key', 'value'],
  },
  execute: async (args: Record<string, unknown>) => ({
    stored: true,
    key: args.key,
  }),
  source: 'builtin',
}

export async function runPhase3IntegrationTest() {
  console.log('Running Phase 3 Comprehensive Integration Test...\n')

  let testCount = 0
  let passCount = 0

  async function test(name: string, fn: () => Promise<void> | void) {
    testCount++
    try {
      await fn()
      passCount++
      console.log(`✓ ${name}`)
    } catch (e) {
      console.error(`✗ ${name}`)
      console.error(`  Error: ${(e as Error).message}`)
    }
  }

  // ============= Scenario 1: Multi-Runtime Support =============

  await test('Phase 3: Multiple runtimes can be created', () => {
    const langGraphRuntime = createRuntime({ backend: 'langgraph' } as any)
    const vercelAiRuntime = createRuntime({ backend: 'vercel-ai' } as any)

    assertEquals(langGraphRuntime.id, 'langgraph')
    assertEquals(vercelAiRuntime.id, 'vercel-ai')
  })

  // ============= Scenario 2: Tool Orchestration with Dependencies =============

  await test('Phase 3: Tool dependency orchestration', () => {
    // Define workflow: fetch_data → process_data → store_result
    const graph = new DependencyGraph()

    graph.addTool('fetch_data')
    graph.addTool('process_data')
    graph.addTool('store_result')

    graph.addDependency('fetch_data', 'process_data')
    graph.addDependency('process_data', 'store_result')

    const sortResult = graph.topologicalSort()
    assert(sortResult.success, 'Topological sort should succeed')

    // Should have 3 levels (linear chain)
    assertEquals(sortResult.order.length, 3, 'Should have 3 execution levels')
    assertEquals(sortResult.order[0], ['fetch_data'], 'fetch_data should be first')
    assertEquals(sortResult.order[2], ['store_result'], 'store_result should be last')
  })

  // ============= Scenario 3: Rate Limiting across Tools =============

  await test('Phase 3: Rate limiting per tool', () => {
    const limiter = new RateLimiter()

    // Configure API-heavy tools with rate limits
    limiter.registerTool({
      toolId: 'fetch_data',
      maxRequestsPerSecond: 2,
      burstSize: 5,
    })
    limiter.registerTool({
      toolId: 'process_data',
      maxRequestsPerSecond: 10,
      burstSize: 20,
    })

    // Can acquire tokens for both
    const fetchResult = limiter.tryAcquire('fetch_data', 1)
    const processResult = limiter.tryAcquire('process_data', 1)

    assert(fetchResult.allowed, 'Should allow fetch request')
    assert(processResult.allowed, 'Should allow process request')

    // Exhaust fetch tokens
    for (let i = 0; i < 4; i++) {
      limiter.tryAcquire('fetch_data', 1)
    }

    // Next fetch should be rejected
    const finalFetch = limiter.tryAcquire('fetch_data', 1)
    assert(!finalFetch.allowed, 'Should rate limit fetch_data')
  })

  // ============= Scenario 4: Permission Control =============

  await test('Phase 3: Permission control for sensitive operations', () => {
    const validator = new PermissionValidator()

    // Define policies
    const policies: ToolPermissionPolicy[] = [
      {
        toolId: 'fetch_data',
        permission: 'allow',
        maxExecutionsPerSession: 100,
      },
      {
        toolId: 'process_data',
        permission: 'allow',
        maxExecutionsPerSession: 50,
      },
      {
        toolId: 'store_result',
        permission: 'prompt', // Requires approval
        maxExecutionsPerSession: 10,
      },
    ]

    validator.registerPolicies(policies)

    // Check permissions
    const fetchCheck = validator.checkPermission({
      toolId: 'fetch_data',
      sessionId: 'session-123',
      parameters: { url: 'https://api.example.com/data' },
    })

    const storeCheck = validator.checkPermission({
      toolId: 'store_result',
      sessionId: 'session-123',
      parameters: { key: 'results', value: {} },
    })

    assert(fetchCheck.allowed, 'Should allow fetch_data')
    assert(storeCheck.allowed, 'Should allow store_result')
    assert(storeCheck.requiresApproval === true, 'store_result should require approval')
  })

  // ============= Scenario 5: Execution Timeline and Observability =============

  await test('Phase 3: Track execution timeline with metrics', () => {
    const timeline = new ExecutionTimeline('multi-step-run')

    // Simulate a multi-step execution
    timeline.recordEvent({
      type: 'run_started',
      runId: 'multi-step-run',
      ts: Date.now(),
      schemaVersion: 1 as any,
    } as any)

    timeline.recordEvent(
      {
        type: 'step_started',
        runId: 'multi-step-run',
        ts: Date.now(),
        data: { step: 1 },
        schemaVersion: 1 as any,
      } as any,
      100
    )

    timeline.recordEvent(
      {
        type: 'tool_call',
        runId: 'multi-step-run',
        ts: Date.now(),
        data: { name: 'fetch_data' },
        schemaVersion: 1 as any,
      } as any,
      50
    )

    timeline.recordEvent(
      {
        type: 'tool_result',
        runId: 'multi-step-run',
        ts: Date.now(),
        data: { success: true },
        schemaVersion: 1 as any,
      } as any,
      100
    )

    timeline.recordEvent(
      {
        type: 'step_completed',
        runId: 'multi-step-run',
        ts: Date.now(),
        data: { step: 1 },
        schemaVersion: 1 as any,
      } as any,
      200
    )

    timeline.recordEvent({
      type: 'run_completed',
      runId: 'multi-step-run',
      ts: Date.now(),
      data: { status: 'success' },
      schemaVersion: 1 as any,
    } as any)

    // Verify timeline
    const metrics = timeline.getMetrics()
    assertEquals(metrics.runId, 'multi-step-run')
    assertEquals(metrics.eventCount, 6)
    assertEquals(metrics.toolCallCount, 1)

    const sequence = timeline.getSequence()
    assert(sequence[0] === 'run_started', 'Should start with run_started')
    assert(sequence[sequence.length - 1] === 'run_completed', 'Should end with run_completed')
  })

  // ============= Scenario 6: Registry and Execution =============

  await test('Phase 3: Tool registry with multi-step execution', () => {
    const registry = new ToolRegistry()

    // Register tools
    registry.register(mockFetchTool)
    registry.register(mockProcessTool)
    registry.register(mockStorageTool)

    // Verify all registered
    assert(registry.has('fetch_data'), 'fetch_data should be registered')
    assert(registry.has('process_data'), 'process_data should be registered')
    assert(registry.has('store_result'), 'store_result should be registered')

    const allTools = registry.list()
    assertEquals(allTools.length, 3, 'Should have 3 tools registered')
  })

  // ============= Scenario 7: Complete Workflow Simulation =============

  await test('Phase 3: Complete workflow with all components', async () => {
    // Setup components
    const dependencyGraph = new DependencyGraph()
    const rateLimiter = new RateLimiter()
    const permissionValidator = new PermissionValidator()
    const timeline = new ExecutionTimeline('complete-workflow')
    const registry = new ToolRegistry()

    // 1. Register tools
    registry.register(mockFetchTool)
    registry.register(mockProcessTool)
    registry.register(mockStorageTool)

    // 2. Define dependencies
    dependencyGraph.addTool('fetch_data')
    dependencyGraph.addTool('process_data')
    dependencyGraph.addTool('store_result')
    dependencyGraph.addDependency('fetch_data', 'process_data')
    dependencyGraph.addDependency('process_data', 'store_result')

    // 3. Setup rate limiting
    rateLimiter.registerTool({
      toolId: 'fetch_data',
      maxRequestsPerSecond: 10,
      burstSize: 20,
    })
    rateLimiter.registerTool({
      toolId: 'process_data',
      maxRequestsPerSecond: 20,
      burstSize: 30,
    })
    rateLimiter.registerTool({
      toolId: 'store_result',
      maxRequestsPerSecond: 5,
      burstSize: 10,
    })

    // 4. Setup permissions
    permissionValidator.registerPolicy({
      toolId: 'fetch_data',
      permission: 'allow',
      maxExecutionsPerSession: 100,
    })
    permissionValidator.registerPolicy({
      toolId: 'process_data',
      permission: 'allow',
      maxExecutionsPerSession: 100,
    })
    permissionValidator.registerPolicy({
      toolId: 'store_result',
      permission: 'prompt',
      maxExecutionsPerSession: 10,
    })

    // 5. Check execution order
    const sortResult = dependencyGraph.topologicalSort()
    assert(sortResult.success, 'Dependency graph should be valid')

    // 6. Simulate execution
    const sessionId = 'workflow-session-1'

    for (const toolGroup of sortResult.order) {
      for (const toolId of toolGroup) {
        // Check rate limit
        const rateCheck = rateLimiter.tryAcquire(toolId, 1)
        assert(rateCheck.allowed, `Should allow ${toolId}`)

        // Check permission
        const permCheck = permissionValidator.checkPermission({
          toolId,
          sessionId,
          parameters: {},
        })
        assert(permCheck.allowed, `Should allow execution of ${toolId}`)

        // Record execution
        permissionValidator.recordExecution(sessionId, toolId)

        // Record in timeline
        timeline.recordEvent({
          type: 'tool_call',
          runId: 'complete-workflow',
          ts: Date.now(),
          data: { name: toolId },
          schemaVersion: 1 as any,
        } as any)
      }
    }

    // 7. Verify final state
    const metrics = timeline.getMetrics()
    assertEquals(metrics.toolCallCount, 3, 'Should have called 3 tools')

    const stats = rateLimiter.getStats()
    assert(stats.length === 3, 'Should have stats for 3 tools')

    const permStats = permissionValidator.getStats()
    assertEquals(permStats.totalPolicies, 3, 'Should have 3 policies')
  })

  // ============= Scenario 8: Runtime Factory Integration =============

  await test('Phase 3: Multiple runtimes execute with same coordination setup', async () => {
    const sessionId = 'multi-runtime-session'
    const message = 'Execute workflow'

    // Create both runtimes
    const langGraphRuntime = createRuntime({ backend: 'langgraph' } as any)
    const vercelAiRuntime = createRuntime({ backend: 'vercel-ai' } as any)

    // Both should be able to execute with the same session context
    const langGraphEvents: any[] = []
    for await (const event of langGraphRuntime.run({
      runId: 'langgraph-run-1',
      sessionId,
      message,
      settings: { provider: 'test', modelId: 'test', apiKey: 'test', backend: 'langgraph' } as any,
    })) {
      langGraphEvents.push(event)
    }

    const vercelAiEvents: any[] = []
    for await (const event of vercelAiRuntime.run({
      runId: 'vercel-ai-run-1',
      sessionId,
      message: 'Follow up',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test', backend: 'vercel-ai' } as any,
    })) {
      vercelAiEvents.push(event)
    }

    // Both should have valid event sequences
    assert(langGraphEvents.length > 0, 'LangGraph should produce events')
    assert(vercelAiEvents.length > 0, 'VercelAI should produce events')

    // Both should have run_started and terminal events
    assert(langGraphEvents[0].type === 'run_started', 'LangGraph should start with run_started')
    assert(vercelAiEvents[0].type === 'run_started', 'VercelAI should start with run_started')

    const langGraphTerminal = langGraphEvents[langGraphEvents.length - 1].type
    const vercelAiTerminal = vercelAiEvents[vercelAiEvents.length - 1].type

    assert(
      langGraphTerminal === 'run_completed' || langGraphTerminal === 'run_failed',
      'LangGraph should end with terminal event'
    )
    assert(
      vercelAiTerminal === 'run_completed' || vercelAiTerminal === 'run_failed',
      'VercelAI should end with terminal event'
    )
  })

  // Summary
  console.log(`\nResults: ${passCount}/${testCount} tests passed`)
  if (passCount === testCount) {
    console.log('✓ All Phase 3 integration tests passed!')
  } else {
    console.log(`✗ ${testCount - passCount} test(s) failed`)
  }

  return passCount === testCount
}

// Export for test runner
if (import.meta.url === `file://${process.argv[1]}`) {
  runPhase3IntegrationTest().then((success) => {
    process.exit(success ? 0 : 1)
  })
}
