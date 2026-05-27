import { fauxAssistantMessage, registerFauxProvider } from '@mariozechner/pi-ai'
import { describe, expect, it, vi } from 'vitest'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

describe('PiEmbeddedRuntime', () => {
  it('passes the current chat transcript to the model request', async () => {
    vi.resetModules()
    const faux = registerFauxProvider({
      provider: 'telegraph-faux-pi-embedded-transcript',
      models: [{ id: 'pi-embedded-transcript-model' }],
      tokensPerSecond: 10_000,
    })
    faux.setResponses([
      fauxAssistantMessage('continued answer'),
    ])

    try {
      vi.doMock('@/packages/agent/providers/index', () => ({
        resolveModel: () => {
          const model = faux.getModel('pi-embedded-transcript-model')
          if (!model) throw new Error('Missing faux pi-embedded transcript model')
          return model
        },
      }))

      const { PiEmbeddedRuntime } = await import('../PiEmbeddedRuntime')
      const runtime = new PiEmbeddedRuntime()
      const events = await collect(runtime.run({
        runId: 'run-pi-embedded-transcript',
        sessionId: 'session-pi-embedded-transcript',
        message: 'second prompt',
        messages: [
          { id: 'm-first', role: 'user', content: 'first prompt' },
          { id: 'm-assistant', role: 'assistant', content: 'first answer' },
          { id: 'm-second', role: 'user', content: 'second prompt' },
        ],
        settings: {
          provider: 'telegraph-faux-pi-embedded-transcript',
          modelId: 'pi-embedded-transcript-model',
          apiKey: 'test-key',
          backend: 'pi-embedded',
        },
      }))

      const request = events.find(event => event.type === 'model_request')
      expect(request?.raw).toMatchObject({
        context: {
          messages: [
            expect.objectContaining({ role: 'user', content: 'first prompt' }),
            expect.objectContaining({ role: 'assistant' }),
            expect.objectContaining({ role: 'user', content: 'second prompt' }),
          ],
        },
      })
    } finally {
      faux.unregister()
      vi.doUnmock('@/packages/agent/providers/index')
      vi.resetModules()
    }
  })
})
