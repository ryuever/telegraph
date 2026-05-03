import { stream, type Context, type Message } from '@mariozechner/pi-ai'
import type { AgentRuntimeSettings, AgentSendInput } from '@telegraph/agent/types'
import { resolveModel } from '@telegraph/agent/providers/index'

/**
 * Streaming agent built on top of pi-ai. Stateless w.r.t. conversation —
 * the caller passes in messages on each `send`. State (history, tools,
 * loop-on-toolcall, …) is the harness's job; PiAgent is the thin wire.
 */
export class PiAgent {
  constructor(private readonly settings: AgentRuntimeSettings) {}

  get currentSettings(): AgentRuntimeSettings {
    return this.settings
  }

  withSettings(next: AgentRuntimeSettings): PiAgent {
    return new PiAgent(next)
  }

  async send(input: AgentSendInput): Promise<Message> {
    const model = resolveModel(this.settings)

    const context: Context = {
      systemPrompt: input.systemPrompt ?? 'You are a helpful assistant.',
      messages: input.messages.map(m => ({ role: m.role, content: m.content } as Context['messages'][number])),
      tools: input.tools ?? [],
    } as Context

    const cb = input.callbacks ?? {}
    cb.onStart?.()

    const s = stream(model, context, {
      apiKey: this.settings.apiKey,
      signal: input.signal,
    } as Parameters<typeof stream>[2])

    try {
      for await (const event of s as AsyncIterable<any>) {
        if (input.signal?.aborted) break
        switch (event.type) {
          case 'text_delta':
            cb.onTextDelta?.(event.delta)
            break
          case 'thinking_delta':
            cb.onThinkingDelta?.(event.delta)
            break
          case 'toolcall_start':
            cb.onToolCallStart?.({ id: event.toolCall?.id ?? '', name: event.toolCall?.name ?? '' })
            break
          case 'toolcall_end':
            cb.onToolCallEnd?.(event.toolCall)
            break
          case 'done':
            cb.onDone?.(event.reason, event.message)
            break
          case 'error':
            cb.onError?.(event.reason, event.error)
            break
        }
      }
      const final = await (s as { result: () => Promise<Message> }).result()
      return final
    } catch (err) {
      cb.onError?.('error', { role: 'assistant', content: [{ type: 'text', text: String(err) }] } as unknown as Message)
      throw err
    }
  }
}
