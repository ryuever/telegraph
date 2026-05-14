/**
 * Test suite for Phase 3.5 ExecutionTimeline (Observability)
 *
 * Tests:
 * - Event recording and statistics
 * - Metrics collection and analysis
 * - Performance issue detection
 * - Critical path analysis
 */

import { ExecutionTimeline } from '../ExecutionTimeline'
import type { RuntimeEvent } from '@/packages/runtime-contracts'

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

function createMockEvent(type: string, runId: string = 'test-run'): any {
  return {
    schemaVersion: '1.0',
    type,
    runId,
    ts: Date.now(),
  }
}

export async function runExecutionTimelineTests() {
  console.log('Running Phase 3.5 ExecutionTimeline tests...\n')

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

  // ============= Basic Recording Tests =============

  await test('ExecutionTimeline: instantiation', () => {
    const timeline = new ExecutionTimeline('run-123')
    const entries = timeline.getEntries()
    assert(entries.length === 0, 'Should start with no entries')
  })

  await test('ExecutionTimeline: record single event', () => {
    const timeline = new ExecutionTimeline('run-001')
    const event = createMockEvent('run_started')

    timeline.recordEvent(event)
    const entries = timeline.getEntries()

    assert(entries.length === 1, 'Should have 1 entry')
    assertEquals(entries[0].event, event, 'Event should match')
  })

  await test('ExecutionTimeline: record multiple events', () => {
    const timeline = new ExecutionTimeline('run-002')

    timeline.recordEvent(createMockEvent('run_started'))
    timeline.recordEvent(createMockEvent('model_event'))
    timeline.recordEvent(createMockEvent('tool_call'))
    timeline.recordEvent(createMockEvent('tool_result'))
    timeline.recordEvent(createMockEvent('run_completed'))

    const entries = timeline.getEntries()
    assert(entries.length === 5, 'Should have 5 entries')
  })

  // ============= Event Statistics Tests =============

  await test('ExecutionTimeline: get event statistics', () => {
    const timeline = new ExecutionTimeline('run-003')

    timeline.recordEvent(createMockEvent('tool_call'), 100)
    timeline.recordEvent(createMockEvent('tool_call'), 150)
    timeline.recordEvent(createMockEvent('tool_result'), 200)

    const stats = timeline.getEventStats()
    const toolCallStats = stats.find((s) => s.eventType === 'tool_call')

    assert(toolCallStats !== undefined, 'Should have tool_call stats')
    assertEquals(toolCallStats!.count, 2, 'Should have 2 tool_call events')
    assert(toolCallStats!.averageDurationMs === 125, 'Average should be 125ms')
  })

  await test('ExecutionTimeline: filter entries by type', () => {
    const timeline = new ExecutionTimeline('run-004')

    timeline.recordEvent(createMockEvent('tool_call'))
    timeline.recordEvent(createMockEvent('tool_result'))
    timeline.recordEvent(createMockEvent('tool_call'))

    const toolCalls = timeline.getEntriesByType('tool_call')
    assert(toolCalls.length === 2, 'Should have 2 tool_call entries')
  })

  // ============= Metrics Tests =============

  await test('ExecutionTimeline: execution metrics', async () => {
    const timeline = new ExecutionTimeline('run-005')

    timeline.recordEvent(createMockEvent('run_started'))
    timeline.recordEvent(createMockEvent('tool_call'))
    timeline.recordEvent(createMockEvent('tool_result'))
    timeline.recordEvent(createMockEvent('tool_error'))
    timeline.recordEvent(createMockEvent('run_completed'))

    // Small delay to ensure end time is set
    await new Promise((resolve) => setTimeout(resolve, 10))

    const metrics = timeline.getMetrics()
    assertEquals(metrics.runId, 'run-005')
    assertEquals(metrics.eventCount, 5)
    assertEquals(metrics.toolCallCount, 1)
    assertEquals(metrics.toolErrorCount, 1)
    assert(metrics.totalDurationMs !== undefined, 'Should have total duration')
  })

  await test('ExecutionTimeline: tool metrics', () => {
    const timeline = new ExecutionTimeline('run-006')

    // Record API calls
    timeline.recordEvent(
      {
        ...createMockEvent('tool_call'),
        data: { name: 'api_call' },
      } as any,
      100
    )
    timeline.recordEvent(
      {
        ...createMockEvent('tool_result'),
        data: { name: 'api_call' },
      } as any,
      150
    )
    timeline.recordEvent(
      {
        ...createMockEvent('tool_call'),
        data: { name: 'api_call' },
      } as any,
      100
    )
    timeline.recordEvent(
      {
        ...createMockEvent('tool_error'),
        data: { toolName: 'api_call' },
      } as any,
      50
    )

    const toolMetrics = timeline.getToolMetrics()
    const apiMetric = toolMetrics.find((m) => m.toolName === 'api_call')

    assert(apiMetric !== undefined, 'Should have api_call metrics')
    assertEquals(apiMetric!.callCount, 2, 'Should have 2 calls')
    assertEquals(apiMetric!.errorCount, 1, 'Should have 1 error')
    assert(apiMetric!.averageDurationMs === 125, 'Average should be 125ms')
  })

  // ============= Critical Path Analysis =============

  await test('ExecutionTimeline: get critical path', () => {
    const timeline = new ExecutionTimeline('run-007')

    timeline.recordEvent(createMockEvent('run_started'))
    timeline.recordEvent(createMockEvent('step_started'))
    timeline.recordEvent(createMockEvent('tool_call'))
    timeline.recordEvent(createMockEvent('tool_result'))
    timeline.recordEvent(createMockEvent('step_completed'))
    timeline.recordEvent(createMockEvent('run_completed'))

    const criticalPath = timeline.getCriticalPath()
    assert(criticalPath.length > 0, 'Should identify critical path')
  })

  // ============= Error Tracking =============

  await test('ExecutionTimeline: collect errors', () => {
    const timeline = new ExecutionTimeline('run-008')

    timeline.recordEvent(createMockEvent('run_started'))
    timeline.recordEvent(
      {
        ...createMockEvent('tool_error'),
        data: { error: 'Connection timeout' },
      } as any
    )
    timeline.recordEvent(
      {
        ...createMockEvent('run_failed'),
        data: { reason: 'Max retries exceeded' },
      } as any
    )

    const errors = timeline.getErrors()
    assert(errors.length === 2, 'Should have 2 errors')
    assert(errors[0].message === 'Connection timeout', 'Should capture error message')
  })

  // ============= Performance Issue Detection =============

  await test('ExecutionTimeline: detect long execution', () => {
    const timeline = new ExecutionTimeline('run-009')

    timeline.recordEvent(createMockEvent('run_started') as any)
    // Simulate 40 second execution
    timeline.recordEvent(createMockEvent('run_completed') as any, 40000)

    const issues = timeline.findPerformanceIssues()
    const longExecution = issues.find((i) => i.issue === 'Long execution time')

    assert(longExecution !== undefined, 'Should detect long execution')
    assertEquals(longExecution!.severity, 'warning')
  })

  await test('ExecutionTimeline: detect excessive tool calls', () => {
    const timeline = new ExecutionTimeline('run-010')

    timeline.recordEvent(createMockEvent('run_started'))

    // Record 25 tool calls
    for (let i = 0; i < 25; i++) {
      timeline.recordEvent(createMockEvent('tool_call'))
    }

    timeline.recordEvent(createMockEvent('run_completed'))

    const issues = timeline.findPerformanceIssues()
    const excessiveCalls = issues.find((i) => i.issue === 'Excessive tool calls')

    assert(excessiveCalls !== undefined, 'Should detect excessive tool calls')
    assertEquals(excessiveCalls!.severity, 'warning')
  })

  await test('ExecutionTimeline: detect high error rate', () => {
    const timeline = new ExecutionTimeline('run-011')

    timeline.recordEvent(createMockEvent('run_started'))

    // Record 5 tool calls and 2 errors
    timeline.recordEvent(createMockEvent('tool_call'))
    timeline.recordEvent(createMockEvent('tool_error'))
    timeline.recordEvent(createMockEvent('tool_call'))
    timeline.recordEvent(createMockEvent('tool_error'))
    timeline.recordEvent(createMockEvent('tool_call'))

    timeline.recordEvent(createMockEvent('run_completed'))

    const issues = timeline.findPerformanceIssues()
    const highErrorRate = issues.find((i) => i.issue === 'High tool error rate')

    assert(highErrorRate !== undefined, 'Should detect high error rate')
    assertEquals(highErrorRate!.severity, 'warning')
  })

  await test('ExecutionTimeline: detect execution errors', () => {
    const timeline = new ExecutionTimeline('run-012')

    timeline.recordEvent(createMockEvent('run_started'))
    timeline.recordEvent(createMockEvent('run_failed'))

    const issues = timeline.findPerformanceIssues()
    const errors = issues.find((i) => i.issue === 'Execution errors')

    assert(errors !== undefined, 'Should detect execution errors')
    assertEquals(errors!.severity, 'critical')
  })

  // ============= Summary Generation =============

  await test('ExecutionTimeline: generate summary', () => {
    const timeline = new ExecutionTimeline('run-013')

    timeline.recordEvent(createMockEvent('run_started') as any)
    timeline.recordEvent(createMockEvent('tool_call') as any)
    timeline.recordEvent(
      {
        ...createMockEvent('tool_error'),
        data: { error: 'API error' },
      } as any
    )
    timeline.recordEvent(createMockEvent('run_completed') as any)

    const summary = timeline.getSummary()
    assert(summary.includes('run-013'), 'Summary should include run ID')
    assert(summary.includes('Tool Calls: 1'), 'Summary should include tool call count')
    assert(summary.includes('Errors'), 'Summary should include errors section')
  })

  // ============= Sequence Tracking =============

  await test('ExecutionTimeline: get event sequence', () => {
    const timeline = new ExecutionTimeline('run-014')

    timeline.recordEvent(createMockEvent('run_started'))
    timeline.recordEvent(createMockEvent('model_event'))
    timeline.recordEvent(createMockEvent('tool_call'))
    timeline.recordEvent(createMockEvent('run_completed'))

    const sequence = timeline.getSequence()
    assertEquals(sequence, ['run_started', 'model_event', 'tool_call', 'run_completed'])
  })

  // ============= Metadata Recording =============

  await test('ExecutionTimeline: record event with metadata', () => {
    const timeline = new ExecutionTimeline('run-015')
    const event = createMockEvent('tool_call')
    const metadata = { duration: 100, retries: 2 }

    timeline.recordEvent(event, 100, metadata)
    const entries = timeline.getEntries()

    assert(entries.length === 1, 'Should have 1 entry')
    assertEquals(entries[0].metadata, metadata, 'Metadata should be preserved')
  })

  // ============= Clear Functionality =============

  await test('ExecutionTimeline: clear timeline', () => {
    const timeline = new ExecutionTimeline('run-016')

    timeline.recordEvent(createMockEvent('run_started'))
    timeline.recordEvent(createMockEvent('run_completed'))

    assert(timeline.getEntries().length === 2, 'Should have 2 entries before clear')

    timeline.clear()

    assert(timeline.getEntries().length === 0, 'Should have 0 entries after clear')
    assert(timeline.getEventStats().length === 0, 'Stats should be cleared')
  })

  // Summary
  console.log(`\nResults: ${passCount}/${testCount} tests passed`)
  if (passCount === testCount) {
    console.log('✓ All Phase 3.5 ExecutionTimeline tests passed!')
  } else {
    console.log(`✗ ${testCount - passCount} test(s) failed`)
  }

  return passCount === testCount
}

// Export for test runner
if (import.meta.url === `file://${process.argv[1]}`) {
  runExecutionTimelineTests().then((success) => {
    process.exit(success ? 0 : 1)
  })
}
