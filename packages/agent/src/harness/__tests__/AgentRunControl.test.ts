import { describe, expect, it } from 'vitest'
import { AgentRunControl } from '../AgentRunControl'

describe('AgentRunControl', () => {
  it('tracks active run abort handles and listener fanout', () => {
    const control = new AgentRunControl<{ type: string; runId: string }>()
    const events: string[] = []
    const subscription = control.subscribe(event => {
      events.push(`${event.runId}:${event.type}`)
    })

    const first = control.startRun({ runId: 'run-1', sessionId: 'session-1' })
    expect(first.signal.aborted).toBe(false)
    expect(first.sessionId).toBe('session-1')
    expect(control.isActive('run-1')).toBe(true)

    control.emit({ type: 'started', runId: 'run-1' })
    expect(control.cancelRun('run-1')).toBe(true)
    expect(first.signal.aborted).toBe(true)

    control.finishRun('run-1')
    expect(control.isActive('run-1')).toBe(false)
    expect(control.cancelRun('run-1')).toBe(false)

    subscription.unsubscribe()
    control.emit({ type: 'ignored', runId: 'run-1' })
    expect(events).toEqual(['run-1:started'])
  })

  it('aborts the previous handle when the same run id restarts', () => {
    const control = new AgentRunControl<unknown>()

    const first = control.startRun({ runId: 'run-1' })
    const second = control.startRun({ runId: 'run-1' })

    expect(first.signal.aborted).toBe(true)
    expect(second.signal.aborted).toBe(false)
  })
})
