import { listRuntimeCapabilityDescriptors } from '@/packages/agent/runtime/RuntimeCapabilityDescriptor'
import type {
  AgentSendOptions,
  AgentService,
  ChatRuntimeCapabilityDescriptorSnapshot,
  ChatPermissionRequestSnapshot,
  ChatPermissionResolution,
  ChatRunTraceBundle,
  ChatRunTraceImportResult,
  ChatSubagentRecordSnapshot,
} from './types'

export class MockAgentService implements AgentService {
  async send({ conversation, onChunk, onSubagentUpdate, signal, onLlmTrace }: AgentSendOptions): Promise<void> {
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
    const shouldDemoSubagents = /subagent|子代理|并行|delegate|delegation/i.test(echo)

    if (shouldDemoSubagents) {
      onSubagentUpdate?.({
        parentRunId: runId,
        childRunId: `${runId}-scout`,
        name: 'Scout',
        status: 'running',
        lastUpdate: 'Reading the requested area',
        startedAt: Date.now(),
      })
      onSubagentUpdate?.({
        parentRunId: runId,
        childRunId: `${runId}-reviewer`,
        name: 'Reviewer',
        status: 'running',
        lastUpdate: 'Checking product risks',
        startedAt: Date.now(),
      })
    }

    const reply =
      `I received: "${echo}".\n\n` +
      `This is a mock assistant — wire a real agent via the chat pagelet RPC ` +
      `to get live AI replies.`

    const tokens = reply.split(/(\s+)/)
    for (const token of tokens) {
      if (signal?.aborted) return
      await sleep(18)
      onChunk(token)
    }

    if (shouldDemoSubagents) {
      onSubagentUpdate?.({
        parentRunId: runId,
        childRunId: `${runId}-scout`,
        name: 'Scout',
        status: 'completed',
        summary: 'Confirmed the chat surface can render child-run progress independently from assistant text.',
        elapsedMs: 1260,
        completedAt: Date.now(),
      })
      onSubagentUpdate?.({
        parentRunId: runId,
        childRunId: `${runId}-reviewer`,
        name: 'Reviewer',
        status: 'completed',
        summary: 'Recommended keeping Pi-specific details in trace while showing generic subagent cards in chat.',
        elapsedMs: 1480,
        completedAt: Date.now(),
      })
    }
  }

  async listSubagents(): Promise<ChatSubagentRecordSnapshot[]> {
    return []
  }

  async listRuntimeCapabilities(): Promise<ChatRuntimeCapabilityDescriptorSnapshot[]> {
    return listRuntimeCapabilityDescriptors()
  }

  async listPendingPermissions(): Promise<ChatPermissionRequestSnapshot[]> {
    return []
  }

  async resolvePermissionRequest(_requestId: string, _resolution: ChatPermissionResolution): Promise<boolean> {
    return false
  }

  async exportRunTraceBundle(): Promise<ChatRunTraceBundle | null> {
    return null
  }

  async importRunTraceBundle(bundle: ChatRunTraceBundle): Promise<ChatRunTraceImportResult> {
    return {
      status: 'existing',
      record: bundle.run,
    }
  }

  async getSubagentResult(): Promise<ChatSubagentRecordSnapshot | null> {
    return null
  }

  async cancelSubagent(): Promise<boolean> {
    return false
  }
}

function sleep(ms: number) {
  return new Promise<void>(resolve => {
    const t = setTimeout(resolve, ms)
    if ('unref' in (t as object)) (t as ReturnType<typeof setTimeout> & { unref(): void }).unref()
  })
}
