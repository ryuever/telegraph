import type { RuntimeMessage } from '@/packages/agent-protocol'

export interface CurrentTurnRuntimeMessagesInput {
  runId: string
  message: string
  messages?: RuntimeMessage[]
}

export interface SyntheticUserRuntimeMessageInput {
  id: string
  content: string
  source: string
  runId?: string
  metadata?: Record<string, unknown>
}

export function runtimeMessagesForCurrentTurn(
  input: CurrentTurnRuntimeMessagesInput,
): RuntimeMessage[] | undefined {
  const messages = input.messages?.filter(hasContent) ?? []
  if (messages.length === 0) return undefined

  const current = input.message.trim()
  if (!current) return messages
  const lastMessage = messages.at(-1)
  if (lastMessage?.role === 'user' && lastMessage.content.trim() === current) {
    return messages
  }

  return appendSyntheticUserRuntimeMessage(messages, {
    id: `${input.runId}:user`,
    content: current,
    source: 'runtime-current-turn',
    runId: input.runId,
  })
}

export function appendSyntheticUserRuntimeMessage(
  messages: RuntimeMessage[] | undefined,
  input: SyntheticUserRuntimeMessageInput,
): RuntimeMessage[] | undefined {
  const content = input.content.trim()
  if (!content) return messages
  if (!messages || messages.length === 0) return undefined

  return [
    ...messages,
    {
      id: input.id,
      role: 'user',
      content,
      metadata: {
        ...input.metadata,
        source: input.source,
        ...(input.runId ? { runId: input.runId } : {}),
      },
    },
  ]
}

function hasContent(message: RuntimeMessage): boolean {
  return message.content.trim().length > 0
}
