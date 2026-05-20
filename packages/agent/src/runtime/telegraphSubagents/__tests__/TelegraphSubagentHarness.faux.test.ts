import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import { describe, expect, it, vi } from 'vitest'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

describe('TelegraphSubagentHarness faux provider integration', () => {
  it('runs the default chain through the real pi-ai stream adapter', async () => {
    vi.resetModules()
    const faux = registerFauxProvider({
      provider: 'telegraph-faux-subagents',
      models: [{ id: 'subagent-test-model' }],
      tokensPerSecond: 10_000,
    })
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('subagent', {}, { id: 'call-subagent-default-chain' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('subagent plan accepted'),
      fauxAssistantMessage('scout findings'),
      fauxAssistantMessage('planner plan'),
      fauxAssistantMessage('worker implementation'),
      fauxAssistantMessage('reviewer final answer'),
    ])

    try {
      vi.doMock('@/packages/agent/providers/index', () => ({
        resolveModel: () => {
          const model = faux.getModel('subagent-test-model')
          if (!model) throw new Error('Missing faux test model')
          return model
        },
      }))
      const { TelegraphSubagentHarness } = await import('../TelegraphSubagentHarness')
      const runtime = new TelegraphSubagentHarness()
      const events = await collect(runtime.run({
        runId: 'run-faux-subagents',
        sessionId: 'session-faux-subagents',
        message: 'Run the default chain',
        settings: {
          provider: 'telegraph-faux-subagents',
          modelId: 'subagent-test-model',
          apiKey: '',
          orchestration: 'telegraph-subagents',
          orchestrationPattern: 'chain',
        },
      }))

      expect(events.map(event => event.type)).toEqual(
        expect.arrayContaining([
          'run_started',
          'child_run_started',
          'model_request',
          'model_event',
          'assistant_delta',
          'child_run_completed',
          'run_completed',
        ]),
      )
      expect(events.filter(event => event.type === 'child_run_completed')).toHaveLength(4)
      expect(events.at(-1)).toMatchObject({
        type: 'run_completed',
        runId: 'run-faux-subagents',
      })
      expect(events.filter(event => event.type === 'assistant_delta' && event.runId === 'run-faux-subagents'))
        .toEqual([
          expect.objectContaining({
            text: 'reviewer final answer',
          }),
        ])
      expect(faux.state.callCount).toBe(6)
    } finally {
      faux.unregister()
      vi.doUnmock('@/packages/agent/providers/index')
      vi.resetModules()
    }
  })

  it('executes subagent read tool calls through the embedded tool loop', async () => {
    vi.resetModules()
    const faux = registerFauxProvider({
      provider: 'telegraph-faux-subagents-tools',
      models: [{ id: 'subagent-tool-test-model' }],
      tokensPerSecond: 10_000,
    })
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('subagent', {}, { id: 'call-subagent-tool-chain' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('subagent plan accepted'),
      fauxAssistantMessage(
        fauxToolCall('read', { path: 'package.json' }, { id: 'call-read-package' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('scout findings after read'),
      fauxAssistantMessage('planner plan'),
      fauxAssistantMessage('worker implementation'),
      fauxAssistantMessage('reviewer final answer'),
    ])

    try {
      vi.doMock('@/packages/agent/providers/index', () => ({
        resolveModel: () => {
          const model = faux.getModel('subagent-tool-test-model')
          if (!model) throw new Error('Missing faux test model')
          return model
        },
      }))
      const { TelegraphSubagentHarness } = await import('../TelegraphSubagentHarness')
      const runtime = new TelegraphSubagentHarness()
      const events = await collect(runtime.run({
        runId: 'run-faux-subagents-tools',
        sessionId: 'session-faux-subagents-tools',
        message: 'Read package.json before planning',
        settings: {
          provider: 'telegraph-faux-subagents-tools',
          modelId: 'subagent-tool-test-model',
          apiKey: '',
          orchestration: 'telegraph-subagents',
          orchestrationPattern: 'chain',
        },
      }))

      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_call',
            runId: 'run-faux-subagents-tools-chain-0-scout',
            callId: 'call-read-package',
            toolName: 'read',
          }),
          expect.objectContaining({
            type: 'tool_result',
            runId: 'run-faux-subagents-tools-chain-0-scout',
            callId: 'call-read-package',
            toolName: 'read',
          }),
          expect.objectContaining({
            type: 'run_completed',
            runId: 'run-faux-subagents-tools',
          }),
        ]),
      )
      expect(events.filter(event => event.type === 'model_request')).toHaveLength(7)
      expect(faux.state.callCount).toBe(7)
    } finally {
      faux.unregister()
      vi.doUnmock('@/packages/agent/providers/index')
      vi.resetModules()
    }
  })
})
