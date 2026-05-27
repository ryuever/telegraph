import { describe, expect, it } from 'vitest';
import { resolveChatRunMessages } from '../chat-session-messages';

describe('resolveChatRunMessages', () => {
  it('uses the renderer transcript to seed an empty pagelet session', () => {
    expect(resolveChatRunMessages({
      runId: 'run-1',
      sessionId: 'session-1',
      message: 'second question',
      messages: [
        { id: 'msg-user-1', role: 'user', content: 'first question' },
        { id: 'msg-assistant-1', role: 'assistant', content: 'first answer' },
        { id: 'msg-draft', role: 'assistant', content: 'draft', status: 'streaming' },
        { id: 'msg-user-2', role: 'user', content: 'second question' },
      ],
    })).toEqual([
      { id: 'msg-user-1', role: 'user', content: 'first question' },
      { id: 'msg-assistant-1', role: 'assistant', content: 'first answer' },
      { id: 'msg-user-2', role: 'user', content: 'second question' },
    ]);
  });

  it('keeps the renderer transcript authoritative even when durable history also exists', () => {
    expect(resolveChatRunMessages({
      runId: 'run-2',
      sessionId: 'session-1',
      message: 'second question',
      currentMessageId: 'msg-user-2',
      messages: [
        { id: 'msg-user-1', role: 'user', content: 'first question' },
        { id: 'msg-assistant-ui', role: 'assistant', content: 'first answer' },
        { id: 'msg-user-2', role: 'user', content: 'second question' },
      ],
    })).toEqual([
      { id: 'msg-user-1', role: 'user', content: 'first question' },
      { id: 'msg-assistant-ui', role: 'assistant', content: 'first answer' },
      { id: 'msg-user-2', role: 'user', content: 'second question' },
    ]);
  });

  it('uses the explicit current message id when prior turns have the same text', () => {
    expect(resolveChatRunMessages({
      runId: 'run-2',
      sessionId: 'session-1',
      message: 'again',
      currentMessageId: 'msg-user-2',
      messages: [
        { id: 'msg-user-1', role: 'user', content: 'again' },
        { id: 'msg-assistant-1', role: 'assistant', content: 'first answer' },
        { id: 'msg-user-2', role: 'user', content: 'again' },
      ],
    })).toEqual([
      { id: 'msg-user-1', role: 'user', content: 'again' },
      { id: 'msg-assistant-1', role: 'assistant', content: 'first answer' },
      { id: 'msg-user-2', role: 'user', content: 'again' },
    ]);
  });

  it('falls back to a run-scoped current user message without renderer history', () => {
    expect(resolveChatRunMessages({
      runId: 'run-1',
      sessionId: 'session-1',
      message: 'hello',
    })).toEqual([
      {
        id: 'run-1-user',
        role: 'user',
        content: 'hello',
        metadata: {
          source: 'chat-pagelet',
          runId: 'run-1',
        },
      },
    ]);
  });
});
