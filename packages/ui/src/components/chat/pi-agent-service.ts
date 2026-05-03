import { PiAgent, type AgentRuntimeSettings, type AgentTextMessage } from '@telegraph/agent'
import type { AgentSendOptions, AgentService } from './types'

/**
 * Adapter that fits a {@link PiAgent} into the chat UI's {@link AgentService}
 * contract. Translates ChatConversation → pi-ai message list and forwards the
 * stream's text deltas into `onChunk`.
 */
export class PiAgentService implements AgentService {
  private agent: PiAgent

  constructor(settings: AgentRuntimeSettings) {
    this.agent = new PiAgent(settings)
  }

  updateSettings(next: AgentRuntimeSettings) {
    this.agent = this.agent.withSettings(next)
  }

  async send({ conversation, onChunk, signal }: AgentSendOptions): Promise<void> {
    const messages: AgentTextMessage[] = conversation.messages
      .filter(m => m.role === 'user' || m.role === 'assistant' || m.role === 'system')
      .map(m => ({ role: m.role as AgentTextMessage['role'], content: m.content }))

    await this.agent.send({
      messages,
      signal,
      callbacks: {
        onTextDelta: delta => onChunk(delta),
      },
    })
  }
}
