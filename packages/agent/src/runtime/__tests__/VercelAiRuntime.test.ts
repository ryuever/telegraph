import { describe, expect, it } from 'vitest'
import { VercelAiRuntime } from '../VercelAiRuntime'
import type { RuntimeEvent } from '@/packages/agent-protocol'

describe('VercelAiRuntime', () => {
  it('fails explicitly instead of simulating assistant output', async () => {
    const runtime = new VercelAiRuntime()
    const events = await collect(runtime.run({
      runId: 'vercel-run',
      sessionId: 'session-1',
      message: 'Hello',
      settings: {
        backend: 'vercel-ai',
      },
    }))

    expect(events.map(event => event.type)).toEqual(['run_started', 'run_failed'])
    expect(events.at(-1)).toMatchObject({
      type: 'run_failed',
      error: {
        code: 'runtime_not_implemented',
      },
    })
    expect(events.some(event => event.type === 'assistant_delta')).toBe(false)
  })
})

async function collect(input: AsyncIterable<RuntimeEvent>): Promise<RuntimeEvent[]> {
  const events: RuntimeEvent[] = []
  for await (const event of input) {
    events.push(event)
  }
  return events
}
