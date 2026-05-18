import { stream } from '@mariozechner/pi-ai'
import type { Context, Message } from '@mariozechner/pi-ai'
import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { resolveModel } from '@/packages/agent/providers/index'
import type { AgentRuntimeSettings } from '@/packages/agent/types'

const PI_AI_DEFAULT_SYSTEM = 'You are a helpful assistant.'

export const TELEGRAPH_PI_AI_PRODUCER_VERSION = 'telegraph-pi-ai@0.0.0'

function now() {
  return Date.now()
}

/**
 * Pi-ai backend as a versioned `RuntimeEvent` stream (Phase 1 adapter).
 * Mirrors `PiAiBackend` stream handling; callers map legacy `text_delta` from `assistant_delta`.
 */
export async function* streamPiAiRuntimeEvents(opts: {
  runId: string
  settings: AgentRuntimeSettings
  message: string
  signal?: AbortSignal
}): AsyncGenerator<RuntimeEvent, Message | undefined, void> {
  const { runId, settings, message, signal } = opts
  const schemaVersion = RUNTIME_CONTRACT_SCHEMA_VERSION
  const producerVersion = TELEGRAPH_PI_AI_PRODUCER_VERSION
  const requestId = `req-${runId.slice(0, 12)}`

  const model = resolveModel(settings)
  const context: Context = {
    systemPrompt: PI_AI_DEFAULT_SYSTEM,
    messages: [{ role: 'user', content: message } as Context['messages'][number]],
    tools: [],
  } as Context

  yield {
    type: 'model_request',
    schemaVersion,
    producerVersion,
    runId,
    requestId,
    payload: {
      systemPrompt: context.systemPrompt,
      messages: context.messages,
    },
    raw: { context },
    ts: now(),
  }

  const s = stream(model, context, {
    apiKey: settings.apiKey,
    signal,
  } as Parameters<typeof stream>[2])

  try {
    let endedWithStreamError = false
    for await (const event of s as AsyncIterable<Record<string, unknown> & { type: string }>) {
      if (signal?.aborted) break

      yield {
        type: 'model_event',
        schemaVersion,
        producerVersion,
        runId,
        requestId,
        raw: event,
        ts: now(),
      }

      switch (event.type) {
        case 'text_delta': {
          const delta = typeof event.delta === 'string' ? event.delta : ''
          if (delta.length > 0) {
            yield {
              type: 'assistant_delta',
              schemaVersion,
              producerVersion,
              runId,
              requestId,
              text: delta,
              raw: event,
              ts: now(),
            }
          }
          break
        }
        case 'thinking_delta': {
          const delta = typeof event.delta === 'string' ? event.delta : ''
          if (delta.length > 0) {
            yield {
              type: 'runtime_log',
              schemaVersion,
              producerVersion,
              level: 'debug',
              message: 'thinking_delta',
              runId,
              requestId,
              raw: event,
              ts: now(),
            }
          }
          break
        }
        case 'toolcall_start': {
          const tc = event.toolCall as { id?: string; name?: string } | undefined
          yield {
            type: 'tool_call',
            schemaVersion,
            producerVersion,
            runId,
            callId: tc?.id ?? 'unknown',
            toolName: tc?.name ?? 'unknown',
            input: {},
            raw: event,
            ts: now(),
          }
          break
        }
        case 'toolcall_end': {
          const tc = event.toolCall as { id?: string; name?: string; arguments?: unknown } | undefined
          yield {
            type: 'tool_result',
            schemaVersion,
            producerVersion,
            runId,
            callId: tc?.id ?? 'unknown',
            toolName: tc?.name ?? 'unknown',
            output: tc?.arguments,
            raw: event,
            ts: now(),
          }
          break
        }
        case 'error': {
          const reason = typeof event.reason === 'string' ? event.reason : 'error'
          yield {
            type: 'run_failed',
            schemaVersion,
            producerVersion,
            runId,
            error: {
              code: 'pi_ai_stream_error',
              message: reason,
              details: event,
            },
            raw: event,
            ts: now(),
          }
          endedWithStreamError = true
          break
        }
        default:
          break
      }
      if (endedWithStreamError) {
        break
      }
    }

    if (endedWithStreamError) {
      return undefined
    }

    const final = await (s as { result: () => Promise<Message> }).result()
    yield {
      type: 'run_completed',
      schemaVersion,
      producerVersion,
      runId,
      output: final,
      ts: now(),
    }
    return final
  } catch (err) {
    yield {
      type: 'run_failed',
      schemaVersion,
      producerVersion,
      runId,
      error: {
        code: 'pi_ai_stream_throw',
        message: err instanceof Error ? err.message : String(err),
        details: err,
      },
      ts: now(),
    }
    throw err
  }
}
