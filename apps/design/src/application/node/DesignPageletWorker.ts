import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import type { ElectronMessagePortMainChannel } from '@x-oasis/async-call-rpc-electron';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import {
  DESIGN_PAGELET_SERVICE_PATH,
  type DesignAgentSendRequest,
  type DesignAgentSendResult,
  type DesignAgentStreamEvent,
} from '@/apps/design/application/common';
import { createAgentHarness } from '@/packages/agent/harness';
import { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime';
import { PiEmbeddedRuntime } from '@/packages/agent/runtime/PiEmbeddedRuntime';
import { PiSubagentsRuntime } from '@/packages/agent/runtime/piSubagents/PiSubagentsRuntime';
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent, type AgentRunRequest } from '@/packages/agent-protocol';

export const DesignPageletWorkerId = createId('DesignPageletWorker');

const activeAgentRuns = new Map<string, AbortController>();

@injectable()
export class DesignPageletWorker extends PageletWorker {
  private agentListeners = new Set<(event: DesignAgentStreamEvent) => void>();
  private readonly agentHarness = createAgentHarness({
    defaultRuntimeId: 'pi-ai',
    runtimes: [
      { id: 'pi-ai', create: () => new PiAiRuntime() },
      { id: 'pi-embedded', create: () => new PiEmbeddedRuntime() },
      { id: 'pi-subagents', create: () => new PiSubagentsRuntime() },
    ],
  });

  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  protected override onRendererConnection(channel: ElectronMessagePortMainChannel): void {
    serviceHost.registerService(DESIGN_PAGELET_SERVICE_PATH, {
      channel,
      handlers: {
        info: (): string => `design-pagelet ready (pid=${String(process.pid)})`,
        ping: (now: number) =>
          Promise.resolve({ pong: now, serverTime: Date.now() }),
        sendAgent: (request: DesignAgentSendRequest): Promise<DesignAgentSendResult> =>
          this.handleSendAgent(request),
        cancelAgent: (runId: string): Promise<boolean> =>
          Promise.resolve(this.cancelAgentRun(runId)),
        onAgentEvent: (callback: (event: DesignAgentStreamEvent) => void): { unsubscribe: () => void } => {
          this.agentListeners.add(callback);
          return {
            unsubscribe: () => {
              this.agentListeners.delete(callback);
            },
          };
        },
      },
    });
  }

  private emitAgentEvent(event: DesignAgentStreamEvent): void {
    for (const listener of this.agentListeners) {
      try {
        listener(event);
      } catch {
        this.agentListeners.delete(listener);
      }
    }
  }

  private cancelAgentRun(runId: string): boolean {
    const ctrl = activeAgentRuns.get(runId);
    if (!ctrl) return false;
    ctrl.abort();
    activeAgentRuns.delete(runId);
    return true;
  }

  private async handleSendAgent(request: DesignAgentSendRequest): Promise<DesignAgentSendResult> {
    const sessionId = request.sessionId ?? `design-${request.runId}`;
    const abortController = new AbortController();
    activeAgentRuns.set(request.runId, abortController);
    this.emitAgentEvent({ type: 'run_queued', runId: request.runId, sessionId });

    const agentRequest: AgentRunRequest = {
      runId: request.runId,
      sessionId,
      messages: [
        {
          id: `${request.runId}-user`,
          role: 'user',
          content: request.prompt,
        },
      ],
      settings: request.settings,
      metadata: {
        pagelet: 'design',
        designContext: request.context ?? {},
      },
    };

    try {
      for await (const event of this.agentHarness.run(agentRequest, { signal: abortController.signal })) {
        if (abortController.signal.aborted) break;
        this.emitAgentEvent({ type: 'agent_event', runId: request.runId, sessionId, event });
      }

      activeAgentRuns.delete(request.runId);
      if (abortController.signal.aborted) {
        this.emitAgentEvent({
          type: 'agent_event',
          runId: request.runId,
          sessionId,
          event: cancelledAgentEvent(request.runId),
        });
        this.emitAgentEvent({ type: 'run_failed', runId: request.runId, sessionId, error: 'Cancelled' });
        return { runId: request.runId, status: 'failed', error: 'Cancelled' };
      }
      return { runId: request.runId, status: 'completed' };
    } catch (error) {
      activeAgentRuns.delete(request.runId);
      const message = error instanceof Error ? error.message : String(error);
      this.emitAgentEvent({ type: 'run_failed', runId: request.runId, sessionId, error: message });
      return { runId: request.runId, status: 'failed', error: message };
    }
  }
}

function cancelledAgentEvent(runId: string): AgentEvent {
  return {
    type: 'run_cancelled',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-design-pagelet@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'design-pagelet' },
    runId,
    reason: 'Cancelled',
    ts: Date.now(),
  };
}
