import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import { createParticipantProxy } from '@x-oasis/async-call-rpc-electron';
import {
  CHAT_PAGELET_SERVICE_PATH,
  type ChatSendRequest,
  type ChatSendResult,
  type ChatStreamEvent,
} from '@/apps/chat/application/common';
import { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime';
import { PiEmbeddedRuntime } from '@/packages/agent/runtime/PiEmbeddedRuntime';
import { PiSubagentsRuntime } from '@/packages/agent/runtime/piSubagents/PiSubagentsRuntime';
import { createDemoOrchestratorRuntime } from '@/packages/agent/runtime/OrchestratorCoreRunner';
import { chatCapabilities, createAgentHarness } from '@/packages/agent/harness';
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent, type AgentRunRequest } from '@/packages/agent-protocol';

export const ChatPageletWorkerId = createId('ChatPageletWorker');

/**
 * Active run tracking — allows cancellation via AbortController.
 */
const activeRuns = new Map<string, AbortController>();

@injectable()
export class ChatPageletWorker extends PageletWorker {
  private streamListeners = new Set<(event: ChatStreamEvent) => void>();
  private readonly agentHarness = createAgentHarness({
    defaultRuntimeId: 'pi-ai',
    runtimes: [
      { id: 'pi-ai', create: () => new PiAiRuntime() },
      { id: 'pi-embedded', create: () => new PiEmbeddedRuntime() },
      { id: 'pi-subagents', create: () => new PiSubagentsRuntime() },
      { id: 'telegraph-orchestrator', aliases: ['orchestrator-core'], create: () => createDemoOrchestratorRuntime() },
    ],
    capabilities: chatCapabilities({
      feedback: {
        notify: input => {
          if (!input.runId) return;
          this.emitStreamEvent({ type: 'runtime_event', runId: input.runId, sessionId: input.sessionId, event: feedbackRuntimeLog(input) });
        },
      },
    }),
  });

  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  protected override onRendererConnection(channel: ReturnType<ReturnType<typeof createParticipantProxy>['getChannelFor']>): void {
    serviceHost.registerService(CHAT_PAGELET_SERVICE_PATH, {
      channel,
      serviceHost,
      handlers: {
        info: (): string => `chat-pagelet ready (pid=${String(process.pid)})`,

        send: async (req: ChatSendRequest): Promise<ChatSendResult> => {
          return this.handleSend(req);
        },

        cancel: (runId: string): boolean => {
          const ctrl = activeRuns.get(runId);
          if (ctrl) {
            ctrl.abort();
            activeRuns.delete(runId);
            return true;
          }
          return false;
        },

        onStreamEvent: (callback: (event: ChatStreamEvent) => void): { unsubscribe: () => void } => {
          this.streamListeners.add(callback);
          return {
            unsubscribe: () => {
              this.streamListeners.delete(callback);
            },
          };
        },
      },
    });
  }

  private emitStreamEvent(event: ChatStreamEvent): void {
    for (const listener of this.streamListeners) {
      try {
        listener(event);
      } catch {
        this.streamListeners.delete(listener);
      }
    }
  }

  /**
   * Core agent execution: run through the pagelet-local AgentHarness,
   * stream AgentEvents, and forward compatibility ChatStreamEvents.
   */
  private async handleSend(req: ChatSendRequest): Promise<ChatSendResult> {
    const { runId, sessionId, message, settings } = req;

    const abortController = new AbortController();
    activeRuns.set(runId, abortController);

    this.emitStreamEvent({ type: 'run_queued', runId });

    try {
      this.emitStreamEvent({ type: 'run_started', runId });

      const agentRequest: AgentRunRequest = {
        runId,
        sessionId,
        messages: [
          {
            id: `${runId}-user`,
            role: 'user',
            content: message,
          },
        ],
        settings,
      };

      for await (const ev of this.agentHarness.run(agentRequest, { signal: abortController.signal })) {
        if (abortController.signal.aborted) break;

        this.emitStreamEvent({ type: 'runtime_event', runId, sessionId, event: ev });

        const chatEvent = this.agentEventToLegacyChatStream(ev, runId, sessionId);
        if (chatEvent) {
          this.emitStreamEvent(chatEvent);
        }
      }

      if (abortController.signal.aborted) {
        this.emitStreamEvent({ type: 'runtime_event', runId, sessionId, event: cancelledAgentEvent(runId) });
        this.emitStreamEvent({ type: 'run_failed', runId, error: 'Cancelled' });
        activeRuns.delete(runId);
        return { runId, status: 'failed', error: 'Cancelled' };
      }

      activeRuns.delete(runId);
      return { runId, status: 'completed' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emitStreamEvent({ type: 'run_failed', runId, error: errorMsg });
      activeRuns.delete(runId);
      return { runId, status: 'failed', error: errorMsg };
    }
  }

  /**
   * Map an AgentEvent to a legacy ChatStreamEvent for the current renderer UI.
   */
  private agentEventToLegacyChatStream(
    ev: AgentEvent,
    runId: string,
    sessionId?: string,
  ): ChatStreamEvent | null {
    switch (ev.type) {
      case 'run_started':
        return null; // already emitted before the loop

      case 'assistant_delta': {
        const text = 'text' in ev ? (ev as { text: string }).text : ''
        return { type: 'text_delta', runId, sessionId, text };
      }

      case 'run_completed':
        return { type: 'run_completed', runId, sessionId };

      case 'run_failed': {
        const error = 'error' in ev ? (ev as { error: { message?: string } }).error : undefined
        return {
          type: 'run_failed', runId, sessionId,
          error: error?.message ?? 'Unknown error',
        };
      }

      case 'run_cancelled':
        return { type: 'run_failed', runId, sessionId, error: 'Cancelled' };

      // All events are already forwarded as runtime_event before legacy projection.
      default:
        return null;
    }
  }
}

function feedbackRuntimeLog(input: { runId?: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string; raw?: unknown; ts?: number }): AgentEvent {
  return {
    type: 'runtime_log',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-chat-pagelet@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'chat-feedback' },
    runId: input.runId,
    level: input.level,
    message: input.message,
    raw: input.raw,
    ts: input.ts ?? Date.now(),
  };
}

function cancelledAgentEvent(runId: string): AgentEvent {
  return {
    type: 'run_cancelled',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-chat-pagelet@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'chat-pagelet' },
    runId,
    reason: 'Cancelled',
    ts: Date.now(),
  };
}
