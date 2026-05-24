import { fauxAssistantMessage, fauxToolCall, registerFauxProvider } from '@mariozechner/pi-ai'
import type { Tool } from '@mariozechner/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import type { PiAiExecutableTool } from '../streamPiAiRuntime'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

function objectSchema(properties: Record<string, unknown>, required: string[]): Tool['parameters'] {
  return {
    type: 'object',
    properties,
    required,
    additionalProperties: false,
  } as Tool['parameters']
}

describe('streamPiAiRuntimeEvents tool loop', () => {
  it('executes a tool call and sends the tool result into the next model request', async () => {
    vi.resetModules()
    const faux = registerFauxProvider({
      provider: 'telegraph-faux-tool-loop',
      models: [{ id: 'tool-loop-test-model' }],
      tokensPerSecond: 10_000,
    })
    faux.setResponses([
      fauxAssistantMessage(
        fauxToolCall('read', { path: 'README.md' }, { id: 'call-read' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage('final answer after tool result'),
    ])

    try {
      vi.doMock('@/packages/agent/providers/index', () => ({
        resolveModel: () => {
          const model = faux.getModel('tool-loop-test-model')
          if (!model) throw new Error('Missing faux test model')
          return model
        },
      }))
      const { streamPiAiRuntimeEvents } = await import('../streamPiAiRuntime')
      const readTool: PiAiExecutableTool = {
        name: 'read',
        description: 'Read a file.',
        parameters: objectSchema({
          path: { type: 'string' },
        }, ['path']),
        execute: async input => ({ path: input.path, content: 'README content' }),
      }

      const events = await collect(streamPiAiRuntimeEvents({
        runId: 'run-tool-loop',
        message: 'Read README.md and answer',
        settings: {
          provider: 'telegraph-faux-tool-loop',
          modelId: 'tool-loop-test-model',
          apiKey: 'test-key',
        },
        tools: [readTool],
      }))

      expect(events.filter(event => event.type === 'model_request')).toHaveLength(2)
      expect(events).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            type: 'tool_call',
            callId: 'call-read',
            toolName: 'read',
            input: { path: 'README.md' },
          }),
          expect.objectContaining({
            type: 'tool_result',
            callId: 'call-read',
            toolName: 'read',
            output: { path: 'README.md', content: 'README content' },
          }),
          expect.objectContaining({
            type: 'run_completed',
            runId: 'run-tool-loop',
          }),
        ]),
      )
      const secondRequest = events.filter(event => event.type === 'model_request')[1]
      expect(secondRequest.raw).toMatchObject({
        context: {
          messages: expect.arrayContaining([
            expect.objectContaining({
              role: 'toolResult',
              toolCallId: 'call-read',
              toolName: 'read',
              isError: false,
            }),
          ]),
        },
      })
      const assistantText = events
        .filter(event => event.type === 'assistant_delta')
        .map(event => event.text)
        .join('')
      expect(assistantText).toContain('final answer after tool result')
      const firstRequest = events.filter(event => event.type === 'model_request')[0]
      expect(firstRequest.raw).toMatchObject({
        context: {
          messages: [
            expect.objectContaining({
              role: 'user',
            }),
          ],
          tools: [
            expect.objectContaining({
              name: 'read',
              description: 'Read a file.',
              parameters: expect.objectContaining({
                type: 'object',
                properties: expect.objectContaining({
                  path: expect.objectContaining({ type: 'string' }),
                }),
              }),
            }),
          ],
        },
      })
      expect(faux.state.callCount).toBe(2)
    } finally {
      faux.unregister()
      vi.doUnmock('@/packages/agent/providers/index')
      vi.resetModules()
    }
  })

  it('fails clearly when model settings are incomplete', async () => {
    const { streamPiAiRuntimeEvents } = await import('../streamPiAiRuntime')

    await expect(collect(streamPiAiRuntimeEvents({
      runId: 'run-missing-settings',
      message: 'hello',
      settings: {
        provider: 'telegraph',
        modelId: 'pi-embedded',
        apiKey: '',
      },
    }))).rejects.toThrow('Chat model settings are required')
  })
})
