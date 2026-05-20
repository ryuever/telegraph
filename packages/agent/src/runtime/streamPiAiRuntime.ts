import { stream } from '@mariozechner/pi-ai'
import type { Context, Message, Tool, ToolCall, ToolResultMessage } from '@mariozechner/pi-ai'
import type { RuntimeEvent } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { resolveModel } from '@/packages/agent/providers/index'
import type { AgentRuntimeSettings } from '@/packages/agent/types'

const PI_AI_DEFAULT_SYSTEM = 'You are a helpful assistant.'
const DEFAULT_MAX_TOOL_ITERATIONS = 8

export const TELEGRAPH_PI_AI_PRODUCER_VERSION = 'telegraph-pi-ai@0.0.0'

export interface PiAiExecutableTool extends Tool {
  execute(input: Record<string, unknown>, context: PiAiToolExecutionContext): Promise<unknown>
}

export interface PiAiToolExecutionContext {
  runId: string
  callId: string
  toolName: string
  signal?: AbortSignal
}

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
  tools?: PiAiExecutableTool[]
  maxToolIterations?: number
  systemPrompt?: string
}): AsyncGenerator<RuntimeEvent, Message | undefined, void> {
  const { runId, settings, message, signal } = opts
  const schemaVersion = RUNTIME_CONTRACT_SCHEMA_VERSION
  const producerVersion = TELEGRAPH_PI_AI_PRODUCER_VERSION
  const requestIdPrefix = `req-${runId.slice(0, 12)}`

  const model = resolveModel(settings)
  const tools = opts.tools ?? []
  const toolsByName = new Map(tools.map(tool => [tool.name, tool]))
  const context: Context = {
    systemPrompt: opts.systemPrompt ?? PI_AI_DEFAULT_SYSTEM,
    messages: [{
      role: 'user',
      content: message,
      timestamp: now(),
    } as Context['messages'][number]],
    tools: tools.map(toPiAiToolDescriptor),
  } as Context

  try {
    const maxToolIterations = opts.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS
    for (let turnIndex = 0; ; turnIndex++) {
      const requestId = turnIndex === 0 ? requestIdPrefix : `${requestIdPrefix}-${String(turnIndex + 1)}`
      const toolCalls: ToolCall[] = []

      const contextSnapshot = snapshotContext(context)
      yield {
        type: 'model_request',
        schemaVersion,
        producerVersion,
        runId,
        requestId,
        payload: {
          systemPrompt: contextSnapshot.systemPrompt,
          messages: contextSnapshot.messages,
          tools: contextSnapshot.tools,
        },
        raw: { context: contextSnapshot },
        ts: now(),
      }

      const s = stream(model, context, {
        apiKey: settings.apiKey,
        signal,
      } as Parameters<typeof stream>[2])

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
          case 'toolcall_end': {
            const tc = normalizeToolCall(event.toolCall)
            if (tc) {
              toolCalls.push(tc)
              yield {
                type: 'tool_call',
                schemaVersion,
                producerVersion,
                runId,
                callId: tc.id,
                toolName: tc.name,
                input: tc.arguments,
                raw: event,
                ts: now(),
              }
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
      if (final.role !== 'assistant' || final.stopReason !== 'toolUse' || toolCalls.length === 0) {
        yield {
          type: 'run_completed',
          schemaVersion,
          producerVersion,
          runId,
          output: final,
          ts: now(),
        }
        return final
      }
      if (turnIndex >= maxToolIterations) {
        yield {
          type: 'run_failed',
          schemaVersion,
          producerVersion,
          runId,
          error: {
            code: 'pi_ai_tool_loop_exhausted',
            message: `Tool loop exceeded ${String(maxToolIterations)} iterations`,
          },
          ts: now(),
        }
        return undefined
      }

      context.messages.push(final)
      const toolResults: ToolResultMessage[] = []
      for (const toolCall of toolCalls) {
        const tool = toolsByName.get(toolCall.name)
        if (!tool) {
          const error = {
            code: 'tool_not_found',
            message: `Tool "${toolCall.name}" is not available in this run`,
          }
          yield {
            type: 'tool_error',
            schemaVersion,
            producerVersion,
            runId,
            callId: toolCall.id,
            toolName: toolCall.name,
            error,
            raw: { toolCall },
            ts: now(),
          }
          toolResults.push(toToolResultMessage(toolCall, error.message, true))
          continue
        }

        try {
          const output = await tool.execute(toolCall.arguments, {
            runId,
            callId: toolCall.id,
            toolName: toolCall.name,
            signal,
          })
          yield {
            type: 'tool_result',
            schemaVersion,
            producerVersion,
            runId,
            callId: toolCall.id,
            toolName: toolCall.name,
            output,
            raw: { toolCall },
            ts: now(),
          }
          toolResults.push(toToolResultMessage(toolCall, stringifyToolOutput(output), false, output))
        } catch (error) {
          const runtimeError = {
            code: error instanceof Error ? error.name : 'tool_execution_error',
            message: error instanceof Error ? error.message : String(error),
          }
          yield {
            type: 'tool_error',
            schemaVersion,
            producerVersion,
            runId,
            callId: toolCall.id,
            toolName: toolCall.name,
            error: runtimeError,
            raw: { toolCall },
            ts: now(),
          }
          toolResults.push(toToolResultMessage(toolCall, runtimeError.message, true))
        }
      }

      context.messages.push(...toolResults)
    }
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

function toPiAiToolDescriptor(tool: PiAiExecutableTool): Tool {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  }
}

function normalizeToolCall(value: unknown): ToolCall | undefined {
  if (!value || typeof value !== 'object') return undefined
  const candidate = value as Partial<ToolCall>
  if (candidate.type !== 'toolCall') return undefined
  if (typeof candidate.id !== 'string' || candidate.id.length === 0) return undefined
  if (typeof candidate.name !== 'string' || candidate.name.length === 0) return undefined
  const args = candidate.arguments
  return {
    type: 'toolCall',
    id: candidate.id,
    name: candidate.name,
    arguments: args && typeof args === 'object' && !Array.isArray(args) ? args as Record<string, unknown> : {},
    thoughtSignature: candidate.thoughtSignature,
  }
}

function toToolResultMessage(
  toolCall: ToolCall,
  text: string,
  isError: boolean,
  details?: unknown,
): ToolResultMessage {
  return {
    role: 'toolResult',
    toolCallId: toolCall.id,
    toolName: toolCall.name,
    content: [{ type: 'text', text }],
    details,
    isError,
    timestamp: now(),
  }
}

function stringifyToolOutput(output: unknown): string {
  if (typeof output === 'string') return output
  return JSON.stringify(output, null, 2)
}

function snapshotContext(context: Context): Context {
  if (typeof structuredClone === 'function') {
    return structuredClone(context) as Context
  }
  return JSON.parse(JSON.stringify(context)) as Context
}
