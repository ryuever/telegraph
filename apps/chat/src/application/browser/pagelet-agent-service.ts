import type { AgentSendOptions, AgentService } from './types'
import type { RuntimeMessage } from '@/packages/agent-protocol'
import {
  type ChatMessage,
  type ChatSendRequest,
  type ChatStreamEvent,
  type ChatAgentRunEventRecordSnapshot,
  type ChatAgentRunRecordSnapshot,
  type ChatPermissionRequestSnapshot,
  type ChatPermissionResolution,
  type ChatRunTraceBundle,
  type ChatRunTraceImportResult,
  type ChatRuntimeCapabilityDescriptorSnapshot,
  type ChatConfiguredModelDescriptorSnapshot,
  type ChatAgentRunStatus,
  type ChatSubagentRecordSnapshot,
  type ChatCommandInvocationResult,
  type ChatDeleteSessionRunsResult,
  chatStreamBelongsToRun,
  isAgentStreamEvent,
  isChatPermissionPendingStreamEvent,
  isChatRunQueuedStreamEvent,
} from '@/apps/chat/application/common'
import { throwIfAborted, waitForPageletReady } from '@/packages/services/pagelet-host/browser/pagelet-ready'
import { getChatPageletClient } from '@/apps/chat/application/browser/getClient'
import { createChatAgentEventProjectionState, projectAgentEventToChat } from './agent-event-projector'
import { loadSettings, toRuntimeSettings } from './model-settings'

const READY_ATTEMPTS = 40
const READY_INTERVAL_MS = 500
const PROBE_TIMEOUT_MS = 3000

/**
 * Wait for the chat pagelet RPC channel to be ready.
 *
 * The chat utility process boots asynchronously after spawn.  During
 * that window the preload bridge hasn't received a MessagePort for the
 * `chat` participant yet.  x-oasis's RPCMessageChannel silently drops
 * sends in that state (warns but never settles the promise), so we
 * probe `info()` with a per-attempt timeout and retry until the call
 * succeeds.
 */
export async function waitForChatPageletReady(signal?: AbortSignal): Promise<void> {
  const client = getChatPageletClient()
  await waitForPageletReady(() => client.info(), {
    attempts: READY_ATTEMPTS,
    intervalMs: READY_INTERVAL_MS,
    probeTimeoutMs: PROBE_TIMEOUT_MS,
    signal,
    notReadyMessage: 'Chat pagelet is not ready. Please try again in a moment.',
  })
}

export class PageletAgentService implements AgentService {
  async send({
    conversation,
    parentRunId,
    replay,
    onChunk,
    onToolCall,
    onSubagentUpdate,
    onPermissionRequest,
    onStatus,
    signal,
    onLlmTrace,
  }: AgentSendOptions): Promise<void> {
    const lastMessage = conversation.messages.filter(m => m.role === 'user').at(-1)
    if (!lastMessage) throw new Error('Last message must be from user')

    const runId = globalThis.crypto.randomUUID()

    const settings = this.getSettings()

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
          provider: settings.provider,
          modelId: settings.modelId,
          backend: settings.backend ?? 'pi-ai',
          orchestration: settings.orchestration ?? 'none',
          pattern: settings.orchestrationPattern ?? null,
        },
      },
    })

    const projectionState = createChatAgentEventProjectionState()
    const streamListener = (event: ChatStreamEvent) => {
      if (signal?.aborted) return
      if (!chatStreamBelongsToRun(event, runId, projectionState.childRunParents)) return

      if (isChatPermissionPendingStreamEvent(event)) {
        onPermissionRequest?.(event.permissionRequest)
        return
      }

      if (isAgentStreamEvent(event)) {
        projectAgentEventToChat(event, {
          sessionId: conversation.id,
          runId,
          onChunk,
          onToolCall,
          onSubagentUpdate,
          onStatus,
          onLlmTrace,
          projectionState,
        })
        return
      }

      if (isChatRunQueuedStreamEvent(event)) {
        onStatus?.('queued')
      }
    }

    try {
      // Wait for the pagelet RPC channel to be bound before sending.
      // The chat utility process boots asynchronously after spawn; the
      // renderer may try to call RPC methods before the channel is ready.
      onStatus?.('queued')
      await waitForChatPageletReady(signal)
      throwIfAborted(signal)

      const client = getChatPageletClient()

      const subscription = client.onStreamEvent(streamListener)
      let removeAbortListener = () => {}
      const abortPromise = new Promise<never>((_resolve, reject) => {
        if (!signal) return
        const handleAbort = () => {
          void client.cancel(runId)
          reject(new Error('Cancelled'))
        }
        if (signal.aborted) {
          handleAbort()
          return
        }
        signal.addEventListener('abort', handleAbort, { once: true })
        removeAbortListener = () => {
          signal.removeEventListener('abort', handleAbort)
        }
      })

      const request: ChatSendRequest = {
        message: lastMessage.content,
        currentMessageId: lastMessage.id,
        messages: toRuntimeMessages(conversation.messages),
        settings,
        runId,
        sessionId: conversation.id,
        parentRunId,
        replay,
      }

      onStatus?.('running')

      try {
        const result = await Promise.race([client.send(request), abortPromise])

        if (result.status === 'completed') {
          onStatus?.('completed')
        } else {
          onStatus?.('failed')
          throw new Error(result.error ?? `Chat run ${result.status}`)
        }
      } finally {
        removeAbortListener()
        subscription.unsubscribe()
      }
    } catch (err) {
      onStatus?.('failed')
      throw err
    }
  }

  async listSubagents(signal?: AbortSignal): Promise<ChatSubagentRecordSnapshot[]> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().listSubagents()
  }

  async listRuns(
    options: {
      sessionId?: string
      status?: ChatAgentRunStatus
      limit?: number
      offset?: number
      signal?: AbortSignal
    } = {},
  ): Promise<ChatAgentRunRecordSnapshot[]> {
    await waitForChatPageletReady(options.signal)
    throwIfAborted(options.signal)
    return getChatPageletClient().listRuns({
      sessionId: options.sessionId,
      status: options.status,
      limit: options.limit,
      offset: options.offset,
    })
  }

  async deleteSessionRuns(sessionId: string, signal?: AbortSignal): Promise<ChatDeleteSessionRunsResult> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().deleteSessionRuns(sessionId)
  }

  async getRun(runId: string, signal?: AbortSignal): Promise<ChatAgentRunRecordSnapshot | null> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().getRun(runId)
  }

  async listRunEvents(runId: string, signal?: AbortSignal): Promise<ChatAgentRunEventRecordSnapshot[]> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().listRunEvents(runId)
  }

  async listRuntimeCapabilities(signal?: AbortSignal): Promise<ChatRuntimeCapabilityDescriptorSnapshot[]> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().listRuntimeCapabilities()
  }

  async listConfiguredModels(signal?: AbortSignal): Promise<ChatConfiguredModelDescriptorSnapshot[]> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().listConfiguredModels()
  }

  async exportRunTraceBundle(runId: string, signal?: AbortSignal): Promise<ChatRunTraceBundle | null> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().exportRunTraceBundle(runId)
  }

  async importRunTraceBundle(bundle: ChatRunTraceBundle, signal?: AbortSignal): Promise<ChatRunTraceImportResult> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().importRunTraceBundle(bundle)
  }

  async listPendingPermissions(runId?: string, signal?: AbortSignal): Promise<ChatPermissionRequestSnapshot[]> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().listPendingPermissions(runId)
  }

  async resolvePermissionRequest(
    requestId: string,
    resolution: ChatPermissionResolution,
    signal?: AbortSignal,
  ): Promise<boolean> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().resolvePermissionRequest(requestId, resolution)
  }

  async subscribeToStreamEvents(
    callback: (event: ChatStreamEvent) => void,
    signal?: AbortSignal,
  ): Promise<import('@/apps/chat/application/common').EventSubscription> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().onStreamEvent(callback)
  }

  async getSubagentResult(
    childRunId: string,
    options: { consume?: boolean; signal?: AbortSignal } = {},
  ): Promise<ChatSubagentRecordSnapshot | null> {
    await waitForChatPageletReady(options.signal)
    throwIfAborted(options.signal)
    return getChatPageletClient().getSubagentResult(childRunId, options.consume)
  }

  async cancelSubagent(childRunId: string, signal?: AbortSignal): Promise<boolean> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().cancelSubagent(childRunId)
  }

  /**
   * Browser-side forwarder for slash-command dispatch (4-pack item B). The
   * pagelet end already wraps thrown errors into the `{ ok: false }` arm,
   * so renderers can rely on the envelope and never see a rejected promise
   * for an extension-author bug. Pre-ready waits piggy-back on the same
   * `waitForChatPageletReady` poll used by every other RPC here.
   */
  async invokeCommand(
    commandId: string,
    args?: unknown,
    signal?: AbortSignal,
  ): Promise<ChatCommandInvocationResult> {
    await waitForChatPageletReady(signal)
    throwIfAborted(signal)
    return getChatPageletClient().invokeCommand(commandId, args)
  }

  private getSettings(): ChatSendRequest['settings'] {
    return toRuntimeSettings(loadSettings())
  }
}

function toRuntimeMessages(messages: ChatMessage[]): RuntimeMessage[] {
  return messages.flatMap(message => {
    const content = message.content.trim()
    if (!content) return []
    if (message.role === 'assistant' && (message.status === 'pending' || message.status === 'streaming')) return []
    return [{
      id: message.id,
      role: message.role,
      content,
      status: message.status,
      metadata: {
        createdAt: message.createdAt,
        source: 'chat-renderer',
      },
    }]
  })
}
