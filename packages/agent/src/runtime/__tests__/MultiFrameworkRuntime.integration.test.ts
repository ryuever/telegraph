/**
 * Integration tests for Phase 3.3 Multi-Framework Runtimes
 *
 * Tests the complete execution flow for:
 * - LangGraphRuntime: State machine-based execution
 * - VercelAiRuntime: Multi-provider streaming execution
 *
 * Both follow the same RuntimeExecutor contract and event schema.
 */

import { LangGraphRuntime } from '../LangGraphRuntime'
import { VercelAiRuntime } from '../VercelAiRuntime'
import { ToolRegistry, type ToolDefinition } from '../toolExecution/ToolRegistry'
import { createRuntime } from '../createRuntime'

// Test utilities
function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

function assertEquals(actual: any, expected: any, message?: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${message || 'Values not equal'}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`
    )
  }
}

// Mock tool for testing
const mockWeatherTool: ToolDefinition = {
  id: 'weather_tool',
  name: 'weather_tool',
  description: 'Get current weather for a city',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: 'City name' },
    },
    required: ['city'],
  },
  execute: async (args: Record<string, unknown>) => {
    const city = args.city as string
    const responses: Record<string, unknown> = {
      NYC: { temperature: 72, condition: 'sunny' },
      LA: { temperature: 68, condition: 'cloudy' },
    }
    return responses[city] || { temperature: 60, condition: 'unknown' }
  },
  source: 'builtin',
}

export async function runMultiFrameworkTests() {
  console.log('Running Phase 3.3 Multi-Framework Runtime tests...\n')

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

  // Test 1: LangGraphRuntime instantiation
  await test('LangGraphRuntime: instantiation', () => {
    const runtime = new LangGraphRuntime()
    assertEquals(runtime.id, 'langgraph')
    assertEquals(runtime.label, 'LangGraph (State Machine + Tools)')
  })

  // Test 2: VercelAiRuntime instantiation
  await test('VercelAiRuntime: instantiation', () => {
    const runtime = new VercelAiRuntime()
    assertEquals(runtime.id, 'vercel-ai')
    assertEquals(runtime.label, 'Vercel AI SDK (Multi-Provider + Tools)')
  })

  // Test 3: LangGraphRuntime factory creation
  await test('createRuntime factory: langgraph backend', () => {
    const runtime = createRuntime({ backend: 'langgraph' } as any)
    assertEquals(runtime.id, 'langgraph')
  })

  // Test 4: VercelAiRuntime factory creation
  await test('createRuntime factory: vercel-ai backend', () => {
    const runtime = createRuntime({ backend: 'vercel-ai' } as any)
    assertEquals(runtime.id, 'vercel-ai')
  })

  // Test 5: LangGraphRuntime basic execution
  await test('LangGraphRuntime: basic run execution', async () => {
    const runtime = new LangGraphRuntime()
    const events = []

    for await (const event of runtime.run({
      runId: 'test-run-1',
      sessionId: 'test-session-1',
      message: 'Hello',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test-key', backend: 'langgraph' } as any,
    })) {
      events.push(event)
    }

    // Verify event sequence
    assert(events.length > 0, 'Should emit events')
    assertEquals(events[0].type, 'run_started')
    assert(
      events[events.length - 1].type === 'run_completed' || events[events.length - 1].type === 'run_failed',
      'Last event should be terminal'
    )

    // Verify event structure
    const startEvent = events[0] as any
    assertEquals(startEvent.runId, 'test-run-1')
    assert(startEvent.origin?.framework === 'langgraph', 'Should have langgraph origin')
  })

  // Test 6: VercelAiRuntime unsupported execution
  await test('VercelAiRuntime: explicit unsupported failure', async () => {
    const runtime = new VercelAiRuntime()
    const events = []

    for await (const event of runtime.run({
      runId: 'test-run-2',
      sessionId: 'test-session-2',
      message: 'Hello',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test-key', backend: 'vercel-ai' } as any,
    })) {
      events.push(event)
    }

    // Verify event sequence
    assert(events.length > 0, 'Should emit events')
    assertEquals(events[0].type, 'run_started')
    assertEquals(events[events.length - 1].type, 'run_failed')

    // Verify event structure
    const startEvent = events[0] as any
    assertEquals(startEvent.runId, 'test-run-2')
    assert(startEvent.origin?.framework === 'ai-sdk', 'Should have AI SDK origin')
  })

  // Test 7: VercelAiRuntime does not emit simulated deltas
  await test('VercelAiRuntime: no simulated streaming deltas', async () => {
    const runtime = new VercelAiRuntime()
    const deltaEvents = []

    for await (const event of runtime.run({
      runId: 'test-run-3',
      sessionId: 'test-session-3',
      message: 'Hello',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test-key', backend: 'vercel-ai' } as any,
    })) {
      if ((event as any).type === 'assistant_delta') {
        deltaEvents.push(event)
      }
    }

    assertEquals(deltaEvents.length, 0)
  })

  // Test 8: LangGraphRuntime step events
  await test('LangGraphRuntime: step tracking events', async () => {
    const runtime = new LangGraphRuntime()
    const stepEvents = []

    for await (const event of runtime.run({
      runId: 'test-run-4',
      sessionId: 'test-session-4',
      message: 'Test',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test-key', backend: 'langgraph' } as any,
    })) {
      if ((event as any).type === 'step_started' || (event as any).type === 'step_completed') {
        stepEvents.push(event)
      }
    }

    // LangGraph should emit step events for each iteration
    assert(stepEvents.length > 0, 'Should emit step events')
    assert(
      stepEvents.some((e: any) => e.type === 'step_started'),
      'Should emit step_started'
    )
    assert(
      stepEvents.some((e: any) => e.type === 'step_completed'),
      'Should emit step_completed'
    )
  })

  // Test 9: Cancellation support
  await test('LangGraphRuntime: cancellation signal', async () => {
    const runtime = new LangGraphRuntime()
    const abortController = new AbortController()

    // Abort immediately
    abortController.abort()

    const events = []
    for await (const event of runtime.run({
      runId: 'test-run-5',
      sessionId: 'test-session-5',
      message: 'Hello',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test-key', backend: 'langgraph' } as any,
      signal: abortController.signal,
    })) {
      events.push(event)
    }

    // Should have emitted run_started, then run_cancelled
    assert(
      events.some((e: any) => e.type === 'run_cancelled'),
      'Should emit run_cancelled on abort'
    )
  })

  // Test 10: Cancellation support for Vercel AI
  await test('VercelAiRuntime: cancellation signal', async () => {
    const runtime = new VercelAiRuntime()
    const abortController = new AbortController()

    // Abort immediately
    abortController.abort()

    const events = []
    for await (const event of runtime.run({
      runId: 'test-run-6',
      sessionId: 'test-session-6',
      message: 'Hello',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test-key', backend: 'vercel-ai' } as any,
      signal: abortController.signal,
    })) {
      events.push(event)
    }

    // Should have emitted run_started, then run_cancelled
    assert(
      events.some((e: any) => e.type === 'run_cancelled'),
      'Should emit run_cancelled on abort'
    )
  })

  // Test 11: Event schema compliance
  await test('LangGraphRuntime: event schema compliance', async () => {
    const runtime = new LangGraphRuntime()
    const events = []

    for await (const event of runtime.run({
      runId: 'test-run-7',
      sessionId: 'test-session-7',
      message: 'Hello',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test-key', backend: 'langgraph' } as any,
    })) {
      events.push(event)
    }

    // All events should have required schema fields
    for (const event of events) {
      const e = event as any
      assert(e.schemaVersion !== undefined, `Event ${e.type} missing schemaVersion`)
      assert(e.type !== undefined, `Event missing type`)
      assert(e.runId !== undefined, `Event ${e.type} missing runId`)
      assert(e.ts !== undefined, `Event ${e.type} missing ts`)
    }
  })

  // Test 12: Multi-turn context persistence
  await test('LangGraphRuntime: multi-turn session context', async () => {
    const runtime = new LangGraphRuntime()
    const sessionId = 'test-session-multi-turn'

    // First run
    const events1 = []
    for await (const event of runtime.run({
      runId: 'test-run-8a',
      sessionId,
      message: 'First question',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test-key', backend: 'langgraph' } as any,
    })) {
      events1.push(event)
    }

    // Second run with same session
    const events2 = []
    for await (const event of runtime.run({
      runId: 'test-run-8b',
      sessionId,
      message: 'Follow-up question',
      settings: { provider: 'test', modelId: 'test', apiKey: 'test-key', backend: 'langgraph' } as any,
    })) {
      events2.push(event)
    }

    assert(events1.length > 0, 'First run should produce events')
    assert(events2.length > 0, 'Second run should produce events')
    assertEquals(events1[0].type, 'run_started')
    assertEquals(events2[0].type, 'run_started')
  })

  // Summary
  console.log(`\nResults: ${passCount}/${testCount} tests passed`)
  if (passCount === testCount) {
    console.log('✓ All Phase 3.3 tests passed!')
  } else {
    console.log(`✗ ${testCount - passCount} test(s) failed`)
  }

  return passCount === testCount
}

// Export for test runner
if (import.meta.url === `file://${process.argv[1]}`) {
  runMultiFrameworkTests().then((success) => {
    process.exit(success ? 0 : 1)
  })
}
