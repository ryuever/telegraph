import type { ChatMessage } from '@/apps/chat/application/common'

export function upsertToolCall(
  calls: NonNullable<ChatMessage['toolCalls']>,
  nextCall: NonNullable<ChatMessage['toolCalls']>[number],
): NonNullable<ChatMessage['toolCalls']> {
  const index = calls.findIndex(call => call.id === nextCall.id)
  if (index < 0) return [...calls, nextCall]
  return calls.map((call, i) => i === index ? { ...call, ...nextCall } : call)
}
