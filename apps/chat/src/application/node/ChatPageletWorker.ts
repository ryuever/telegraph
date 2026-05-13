import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { PageletWorker, PageletWorkerConfigId } from '@telegraph/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@telegraph/pagelet-host/node/PageletWorker';
import {
  CHAT_PAGELET_SERVICE_PATH,
  type IChatPageletService,
  type ChatSendRequest,
  type ChatSendResult,
  type ChatStreamEvent,
} from '@telegraph/chat/application/common';

export const ChatPageletWorkerId = createId('ChatPageletWorker');

@injectable()
export class ChatPageletWorker extends PageletWorker {
  private streamListeners = new Set<(event: ChatStreamEvent) => void>();

  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  protected override onRendererConnection(channel: any): void {
    serviceHost.registerService(CHAT_PAGELET_SERVICE_PATH, {
      channel,
      serviceHost,
      handlers: {
        info: (): string => `chat-pagelet ready (pid=${process.pid})`,

        send: async (req: ChatSendRequest): Promise<ChatSendResult> => {
          return this.handleSend(req);
        },

        onStreamEvent: (callback: (event: ChatStreamEvent) => void): (() => void) => {
          this.streamListeners.add(callback);
          return () => {
            this.streamListeners.delete(callback);
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

  private async handleSend(req: ChatSendRequest): Promise<ChatSendResult> {
    const { runId, sessionId, message, settings } = req;

    this.emitStreamEvent({ type: 'run_queued', runId });
    this.emitStreamEvent({ type: 'run_started', runId });

    try {
      this.emitStreamEvent({
        type: 'llm_trace',
        runId,
        sessionId,
        trace: {
          kind: 'telegraph_turn_context',
          messages: [{ id: 'user-msg', role: 'user', content: message }],
          runtimeSettingsSummary: {
            provider: settings.provider,
            modelId: settings.modelId,
            backend: settings.backend ?? 'pi-ai',
            orchestration: settings.orchestration ?? 'none',
            pattern: settings.orchestrationPattern ?? null,
          },
        },
      });

      const tokens = message.split(/(\s+)/);
      for (const token of tokens) {
        this.emitStreamEvent({ type: 'text_delta', runId, text: token });
      }

      this.emitStreamEvent({ type: 'run_completed', runId });

      return {
        runId,
        status: 'completed',
        text: `[chat-pagelet mock] Echo: ${message}`,
      };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.emitStreamEvent({ type: 'run_failed', runId, error: errorMsg });
      return { runId, status: 'failed', error: errorMsg };
    }
  }
}
