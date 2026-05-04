import type { Message } from '@mariozechner/pi-ai'
import type { AgentBackend, AgentRuntimeSettings, AgentSendInput } from '@telegraph/agent/types'

/**
 * Placeholder backend for future Pi CLI-based execution.
 * M1 only wires the selection channel; implementation lands in M2.
 */
export class PiCliBackend implements AgentBackend {
  readonly kind = 'pi-cli' as const

  constructor(private readonly settings: AgentRuntimeSettings) {}

  get currentSettings(): AgentRuntimeSettings {
    return this.settings
  }

  withSettings(next: AgentRuntimeSettings): PiCliBackend {
    return new PiCliBackend(next)
  }

  async send(input: AgentSendInput): Promise<Message> {
    const cb = input.callbacks ?? {}
    cb.onStart?.()
    const err = new Error('PiCliBackend is not implemented yet')
    cb.onError?.('error', { role: 'assistant', content: [{ type: 'text', text: err.message }] } as unknown as Message)
    throw err
  }
}
