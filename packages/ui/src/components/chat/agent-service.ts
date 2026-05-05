import type { AgentSendOptions, AgentService } from './types'

/**
 * Placeholder agent that streams a canned response token-by-token.
 * Swap this out for a real AI agent (Claude, Anthropic SDK, custom backend, etc.)
 * by implementing the {@link AgentService} interface.
 */
export class MockAgentService implements AgentService {
  async send({ conversation, onChunk, signal, onLlmTrace }: AgentSendOptions): Promise<void> {
    const runId = `mock_${Date.now().toString(36)}`
    onLlmTrace?.({
      runId,
      sessionId: conversation.id,
      trace: {
        kind: 'telegraph_turn_context',
        messages: conversation.messages.map(m => ({
          id: m.id,
          role: m.role,
          content: m.content,
          status: m.status,
        })),
        runtimeSettingsSummary: {
          provider: 'mock',
          modelId: '',
          backend: 'mock',
          orchestration: 'none',
          pattern: null,
        },
      },
    })
    const last = conversation.messages
      .filter(m => m.role === 'user')
      .at(-1)
    const echo = last?.content ?? ''

    const reply =
      `I received: "${echo}".\n\n` +
      `This is a mock assistant — wire a real agent into ` +
      `\`MockAgentService\` (see \`packages/ui/src/components/chat/agent-service.ts\`) ` +
      `to get live AI replies.`

    const tokens = reply.split(/(\s+)/)
    for (const token of tokens) {
      if (signal?.aborted) return
      await sleep(18)
      onChunk(token)
    }
  }
}

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms)
    if (typeof t === 'object' && t && 'unref' in t) (t as any).unref?.()
  })
}
