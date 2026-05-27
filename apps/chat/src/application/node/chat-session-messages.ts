import type { ChatSendRequest } from '@/apps/chat/application/common';
import type { RuntimeMessage } from '@/packages/agent-protocol';

export function resolveChatRunMessages(
  req: Pick<ChatSendRequest, 'runId' | 'sessionId' | 'message' | 'currentMessageId' | 'messages'>,
): RuntimeMessage[] {
  const currentUser = currentUserMessageFromRequest(req);
  const seededMessages = sanitizeRuntimeMessages(req.messages);
  if (seededMessages.length === 0) return [currentUser];
  if (seededMessages.some(message => message.id === currentUser.id)) return seededMessages;
  return [...seededMessages, currentUser];
}

function currentUserMessageFromRequest(
  req: Pick<ChatSendRequest, 'runId' | 'message' | 'currentMessageId' | 'messages'>,
): RuntimeMessage {
  const content = req.message.trim();
  const seededMessages = sanitizeRuntimeMessages(req.messages);
  const explicitCurrent = req.currentMessageId
    ? seededMessages.find(message => message.id === req.currentMessageId && message.role === 'user')
    : undefined;
  if (explicitCurrent) return explicitCurrent;

  const seededCurrent = seededMessages
    .filter(message => message.role === 'user')
    .reverse()
    .find(message => message.content.trim() === content);
  return seededCurrent ?? {
    id: `${req.runId}-user`,
    role: 'user',
    content,
    metadata: {
      source: 'chat-pagelet',
      runId: req.runId,
    },
  };
}

function sanitizeRuntimeMessages(messages: unknown[] | undefined): RuntimeMessage[] {
  return (messages ?? []).flatMap(value => {
    if (!isRecord(value)) return [];
    const id = typeof value.id === 'string' ? value.id : undefined;
    const role = typeof value.role === 'string' && isRuntimeMessageRole(value.role) ? value.role : undefined;
    const rawContent = typeof value.content === 'string' ? value.content : undefined;
    if (!id || !role || rawContent === undefined) return [];
    const content = rawContent.trim();
    if (!content) return [];
    const status = typeof value.status === 'string' ? value.status : undefined;
    if (role === 'assistant' && (status === 'pending' || status === 'streaming')) return [];
    const metadata = isRecord(value.metadata) ? { ...value.metadata } : undefined;
    return [{
      id,
      role,
      content,
      status,
      metadata,
    }];
  });
}

function isRuntimeMessageRole(role: string): role is RuntimeMessage['role'] {
  return role === 'user' || role === 'assistant' || role === 'system' || role === 'tool';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
