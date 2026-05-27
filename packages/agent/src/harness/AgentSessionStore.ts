import type { RuntimeMessage } from '@/packages/agent-protocol'

export interface AgentSessionStore {
  getMessages(sessionId: string): RuntimeMessage[] | Promise<RuntimeMessage[]>
  appendMessages(sessionId: string, messages: RuntimeMessage[]): void | Promise<void>
}

export interface InMemoryAgentSessionStoreOptions {
  maxMessages?: number
}

export class InMemoryAgentSessionStore implements AgentSessionStore {
  private readonly sessions = new Map<string, RuntimeMessage[]>()
  private readonly maxMessages: number

  constructor(options: InMemoryAgentSessionStoreOptions = {}) {
    this.maxMessages = options.maxMessages ?? 80
  }

  getMessages(sessionId: string): RuntimeMessage[] {
    return [...(this.sessions.get(sessionId) ?? [])].map(cloneMessage)
  }

  appendMessages(sessionId: string, messages: RuntimeMessage[]): void {
    if (messages.length === 0) return

    const current = this.sessions.get(sessionId) ?? []
    const order = current.map(message => message.id)
    const byId = new Map(current.map(message => [message.id, cloneMessage(message)]))

    for (const message of messages) {
      if (!byId.has(message.id)) {
        order.push(message.id)
      }
      byId.set(message.id, cloneMessage(message))
    }

    const next = order
      .map(id => byId.get(id))
      .filter((message): message is RuntimeMessage => Boolean(message))
      .slice(-this.maxMessages)
    this.sessions.set(sessionId, next)
  }
}

function cloneMessage(message: RuntimeMessage): RuntimeMessage {
  return {
    ...message,
    metadata: message.metadata ? { ...message.metadata } : undefined,
  }
}
