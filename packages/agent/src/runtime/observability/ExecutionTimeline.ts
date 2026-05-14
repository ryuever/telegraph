/**
 * ExecutionTimeline for Observability (Phase 3.5)
 *
 * Tracks and records all events in a run execution for debugging and monitoring.
 * Provides timeline visualization, performance metrics, and event correlation.
 *
 * Event types:
 * - run_started / run_completed / run_failed / run_cancelled (lifecycle)
 * - model_event / assistant_message / assistant_delta (model)
 * - tool_call / tool_result / tool_error (tool execution)
 * - step_started / step_completed (workflow steps)
 * - memory_access / memory_update (memory operations)
 */

import type { RuntimeEvent } from '@/packages/runtime-contracts'

/**
 * Timeline entry with timing and context information.
 */
export interface TimelineEntry {
  timestamp: number
  event: RuntimeEvent
  durationMs?: number // How long this event's phase took
  errorCount?: number // Number of errors at this stage
  metadata?: Record<string, unknown>
}

/**
 * Event occurrence statistics.
 */
export interface EventStats {
  eventType: string
  count: number
  firstOccurrence: number
  lastOccurrence: number
  averageDurationMs?: number
  totalDurationMs?: number
}

/**
 * Execution metrics summary.
 */
export interface ExecutionMetrics {
  runId: string
  startTime: number
  endTime?: number
  totalDurationMs?: number
  eventCount: number
  toolCallCount: number
  toolErrorCount: number
  stepCount: number
  stepsCompleted?: number
  averageStepDurationMs?: number
  criticalPath?: string[]
}

/**
 * ExecutionTimeline tracks all events in a run and provides observability.
 */
export class ExecutionTimeline {
  private runId: string
  private entries: TimelineEntry[] = []
  private startTime: number
  private endTime?: number
  private eventStats: Map<string, EventStats> = new Map()
  private toolMetrics: Map<string, { callCount: number; errorCount: number; totalDurationMs: number }> =
    new Map()

  constructor(runId: string) {
    this.runId = runId
    this.startTime = Date.now()
  }

  /**
   * Record an event in the timeline.
   */
  recordEvent(event: RuntimeEvent, durationMs?: number, metadata?: Record<string, unknown>): void {
    const timestamp = Date.now()
    const entry: TimelineEntry = {
      timestamp,
      event,
      durationMs,
      metadata,
    }

    this.entries.push(entry)

    // Update statistics
    this.updateEventStats(event.type, timestamp, durationMs)

    // Track tool metrics
    const eventData = event as any
    if (eventData.type === 'tool_call') {
      const toolName = eventData.data?.name || 'unknown'
      const metrics = this.toolMetrics.get(toolName) || { callCount: 0, errorCount: 0, totalDurationMs: 0 }
      metrics.callCount++
      this.toolMetrics.set(toolName, metrics)
    } else if (eventData.type === 'tool_result' && durationMs) {
      const toolName = eventData.data?.name || 'unknown'
      const metrics = this.toolMetrics.get(toolName)
      if (metrics) {
        metrics.totalDurationMs += durationMs
      }
    } else if (eventData.type === 'tool_error') {
      const toolName = eventData.data?.toolName || 'unknown'
      const metrics = this.toolMetrics.get(toolName) || { callCount: 0, errorCount: 0, totalDurationMs: 0 }
      metrics.errorCount++
      this.toolMetrics.set(toolName, metrics)
    }

    // Mark run end time
    if (eventData.type === 'run_completed' || eventData.type === 'run_failed' || eventData.type === 'run_cancelled') {
      this.endTime = timestamp
    }
  }

  /**
   * Update event statistics.
   */
  private updateEventStats(eventType: string, timestamp: number, durationMs?: number): void {
    let stats = this.eventStats.get(eventType)

    if (!stats) {
      stats = {
        eventType,
        count: 1,
        firstOccurrence: timestamp,
        lastOccurrence: timestamp,
      }
    } else {
      stats.count++
      stats.lastOccurrence = timestamp

      if (durationMs !== undefined) {
        stats.totalDurationMs = (stats.totalDurationMs || 0) + durationMs
        stats.averageDurationMs = stats.totalDurationMs / stats.count
      }
    }

    this.eventStats.set(eventType, stats)
  }

  /**
   * Get all timeline entries.
   */
  getEntries(): TimelineEntry[] {
    return [...this.entries]
  }

  /**
   * Get entries filtered by event type.
   */
  getEntriesByType(eventType: string): TimelineEntry[] {
    return this.entries.filter((entry) => (entry.event as any).type === eventType)
  }

  /**
   * Get the timeline as a sequence of event types (useful for debugging).
   */
  getSequence(): string[] {
    return this.entries.map((entry) => (entry.event as any).type)
  }

  /**
   * Get execution metrics summary.
   */
  getMetrics(): ExecutionMetrics {
    const eventStats = Array.from(this.eventStats.values())
    const toolCalls = eventStats.find((s) => s.eventType === 'tool_call')?.count ?? 0
    const toolErrors = eventStats.find((s) => s.eventType === 'tool_error')?.count ?? 0
    const stepStarted = eventStats.find((s) => s.eventType === 'step_started')?.count ?? 0
    const stepCompleted = eventStats.find((s) => s.eventType === 'step_completed')?.count ?? 0

    let averageStepDurationMs: number | undefined
    const stepStats = this.eventStats.get('step_completed')
    if (stepStats?.averageDurationMs) {
      averageStepDurationMs = stepStats.averageDurationMs
    }

    const totalDurationMs = this.endTime ? this.endTime - this.startTime : undefined

    return {
      runId: this.runId,
      startTime: this.startTime,
      endTime: this.endTime,
      totalDurationMs,
      eventCount: this.entries.length,
      toolCallCount: toolCalls,
      toolErrorCount: toolErrors,
      stepCount: stepStarted,
      stepsCompleted: stepCompleted,
      averageStepDurationMs,
    }
  }

  /**
   * Get event statistics.
   */
  getEventStats(): EventStats[] {
    return Array.from(this.eventStats.values())
  }

  /**
   * Get tool execution metrics.
   */
  getToolMetrics(): Array<{ toolName: string; callCount: number; errorCount: number; averageDurationMs: number }> {
    const metrics = []

    for (const [toolName, data] of this.toolMetrics.entries()) {
      metrics.push({
        toolName,
        callCount: data.callCount,
        errorCount: data.errorCount,
        averageDurationMs: data.callCount > 0 ? data.totalDurationMs / data.callCount : 0,
      })
    }

    return metrics.sort((a, b) => b.callCount - a.callCount)
  }

  /**
   * Find the critical path (longest chain of dependent operations).
   * This indicates where most of the execution time is spent.
   */
  getCriticalPath(): string[] {
    const path: string[] = []
    let previousEvent: string | undefined

    for (const entry of this.entries) {
      const eventType = (entry.event as any).type

      // Build critical path: events that have dependencies
      if (
        (eventType === 'tool_result' && previousEvent === 'tool_call') ||
        (eventType === 'step_completed' && previousEvent === 'step_started') ||
        (eventType === 'run_completed' && previousEvent !== undefined)
      ) {
        path.push(eventType)
      }

      previousEvent = eventType
    }

    return path.length > 0 ? path : []
  }

  /**
   * Find all errors and exceptions in the timeline.
   */
  getErrors(): Array<{ timestamp: number; event: any; message?: string }> {
    const errors = []

    for (const entry of this.entries) {
      const event = entry.event as any
      if (event.type === 'run_failed' || event.type === 'tool_error') {
        errors.push({
          timestamp: entry.timestamp,
          event,
          message: event.data?.error || event.data?.reason,
        })
      }
    }

    return errors
  }

  /**
   * Check for performance issues (slow steps, excessive tool calls, etc).
   */
  findPerformanceIssues(): Array<{ issue: string; severity: 'info' | 'warning' | 'critical'; details?: string }> {
    const issues: Array<{ issue: string; severity: 'info' | 'warning' | 'critical'; details?: string }> = []
    const metrics = this.getMetrics()

    // Check total duration
    if (metrics.totalDurationMs && metrics.totalDurationMs > 30000) {
      issues.push({
        issue: 'Long execution time',
        severity: 'warning',
        details: `Execution took ${metrics.totalDurationMs}ms (>30s)`,
      })
    }

    // Check excessive tool calls
    if (metrics.toolCallCount > 20) {
      issues.push({
        issue: 'Excessive tool calls',
        severity: 'warning',
        details: `${metrics.toolCallCount} tool calls in this run`,
      })
    }

    // Check tool error rate
    if (metrics.toolCallCount > 0) {
      const errorRate = metrics.toolErrorCount / metrics.toolCallCount
      if (errorRate > 0.2) {
        issues.push({
          issue: 'High tool error rate',
          severity: 'warning',
          details: `${Math.round(errorRate * 100)}% of tool calls failed`,
        })
      }
    }

    // Check for slow steps
    const stepStats = this.eventStats.get('step_completed')
    if (stepStats?.averageDurationMs && stepStats.averageDurationMs > 10000) {
      issues.push({
        issue: 'Slow steps',
        severity: 'info',
        details: `Average step takes ${stepStats.averageDurationMs}ms`,
      })
    }

    // Check for errors
    const errors = this.getErrors()
    if (errors.length > 0) {
      issues.push({
        issue: 'Execution errors',
        severity: 'critical',
        details: `${errors.length} error(s) occurred`,
      })
    }

    return issues
  }

  /**
   * Generate a human-readable summary of the execution.
   */
  getSummary(): string {
    const metrics = this.getMetrics()
    const errors = this.getErrors()
    const issues = this.findPerformanceIssues()

    let summary = `Execution Timeline: ${this.runId}\n`
    summary += `Status: ${metrics.endTime ? 'Completed' : 'In Progress'}\n`
    summary += `Duration: ${metrics.totalDurationMs ? `${metrics.totalDurationMs}ms` : 'N/A'}\n`
    summary += `Events: ${metrics.eventCount}\n`
    summary += `Tool Calls: ${metrics.toolCallCount} (${metrics.toolErrorCount} errors)\n`

    if (errors.length > 0) {
      summary += `\nErrors (${errors.length}):\n`
      for (const error of errors) {
        summary += `  - ${error.message}\n`
      }
    }

    if (issues.length > 0) {
      summary += `\nIssues (${issues.length}):\n`
      for (const issue of issues) {
        summary += `  - [${issue.severity.toUpperCase()}] ${issue.issue}\n`
        if (issue.details) {
          summary += `    ${issue.details}\n`
        }
      }
    }

    return summary
  }

  /**
   * Clear the timeline.
   */
  clear(): void {
    this.entries = []
    this.eventStats.clear()
    this.toolMetrics.clear()
    this.endTime = undefined
    this.startTime = Date.now()
  }
}
