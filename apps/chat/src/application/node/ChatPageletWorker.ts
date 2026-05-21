import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import { createParticipantProxy } from '@x-oasis/async-call-rpc-electron';
import {
  CHAT_PAGELET_SERVICE_PATH,
  type ChatAgentRunEventRecordSnapshot,
  type ChatAgentRunRecordSnapshot,
  type ChatPermissionRequestSnapshot,
  type ChatPermissionResolution,
  type ChatRuntimeCapabilityDescriptorSnapshot,
  type ChatSendRequest,
  type ChatSendResult,
  type ChatRunTraceBundle,
  type ChatRunTraceImportResult,
  type ChatSubagentRecordSnapshot,
  type ChatStreamEvent,
} from '@/apps/chat/application/common';
import { assertChatRunTraceBundle } from '@/apps/chat/application/common/trace-bundle';
import { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime';
import { PiEmbeddedRuntime } from '@/packages/agent/runtime/PiEmbeddedRuntime';
import { listRuntimeCapabilityDescriptors } from '@/packages/agent/runtime/RuntimeCapabilityDescriptor';
import { TelegraphSubagentHarness } from '@/extensions/telegraph-subagents/src/TelegraphSubagentHarness';
import { SubagentManager } from '@/extensions/telegraph-subagents/src/SubagentManager';
import type { SubagentRecord } from '@/extensions/telegraph-subagents/src/types';
import { TELEGRAPH_SUBAGENTS_RUNTIME_ID } from '@/packages/agent/extensions/harness/constants';
import { createDemoOrchestratorRuntime } from '@/packages/agent/runtime/OrchestratorCoreRunner';
import { createAgentHarness, selectRuntimeId } from '@/packages/agent/harness';
import { createPageletRunCapabilities } from '@/packages/agent/harness/node';
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent, type AgentRunRequest } from '@/packages/agent-protocol';
import type { PermissionDecision, PermissionPrompt } from '@/packages/agent/harness/PermissionBroker';
import { FileAgentRunRepository } from '@/packages/agent/persistence/AgentRunRepository';
import type { AgentRunReplaySource, ListAgentRunsOptions } from '@/packages/agent/persistence/AgentRunRepository';

export const ChatPageletWorkerId = createId('ChatPageletWorker');

/**
 * Active run tracking — allows cancellation via AbortController.
 */
const activeRuns = new Map<string, AbortController>();
let permissionRequestCounter = 0;

interface PendingPermissionRequest {
  snapshot: ChatPermissionRequestSnapshot
  resolve: (decision: PermissionDecision) => void
}

@injectable()
export class ChatPageletWorker extends PageletWorker {
  private streamListeners = new Set<(event: ChatStreamEvent) => void>();
  private readonly subagents = new SubagentManager();
  private readonly runs = new FileAgentRunRepository();
  private readonly recoveredRunsReady = this.runs.markRunningRunsRecovered().catch(() => []);
  private readonly pendingPermissions = new Map<string, PendingPermissionRequest>();

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
            this.resolvePendingPermissionsForRun(runId, denyDecision('Run was cancelled before permission was resolved'));
            return true;
          }
          return false;
        },

        listRuns: async (options?: ListAgentRunsOptions): Promise<ChatAgentRunRecordSnapshot[]> => {
          await this.recoveredRunsReady;
          return this.runs.listRuns(options);
        },

        getRun: async (runId: string): Promise<ChatAgentRunRecordSnapshot | null> => {
          await this.recoveredRunsReady;
          return this.runs.getRun(runId);
        },

        listRunEvents: async (runId: string): Promise<ChatAgentRunEventRecordSnapshot[]> => {
          await this.recoveredRunsReady;
          return this.runs.listRunEvents(runId);
        },

        listRuntimeCapabilities: (): Promise<ChatRuntimeCapabilityDescriptorSnapshot[]> =>
          Promise.resolve(listRuntimeCapabilityDescriptors()),

        exportRunTraceBundle: async (runId: string): Promise<ChatRunTraceBundle | null> => {
          await this.recoveredRunsReady;
          const run = await this.runs.getRun(runId);
          if (!run) return null;
          const events = await this.runs.listRunEvents(runId);
          return {
            schemaVersion: 1,
            exportedAt: Date.now(),
            run,
            events,
          };
        },

        importRunTraceBundle: async (bundle: ChatRunTraceBundle): Promise<ChatRunTraceImportResult> => {
          await this.recoveredRunsReady;
          const validBundle = assertChatRunTraceBundle(bundle);
          return this.runs.importRunBundle({
            run: validBundle.run,
            events: validBundle.events,
          });
        },

        listPendingPermissions: (runId?: string): Promise<ChatPermissionRequestSnapshot[]> => {
          const items = Array.from(this.pendingPermissions.values()).map(item => item.snapshot);
          return Promise.resolve(runId ? items.filter(item => item.runId === runId) : items);
        },

        resolvePermissionRequest: (requestId: string, resolution: ChatPermissionResolution): Promise<boolean> =>
          Promise.resolve(this.resolvePermissionRequest(requestId, resolution)),

        listSubagents: (): Promise<ChatSubagentRecordSnapshot[]> =>
          Promise.resolve(this.subagents.listRecords().map(snapshotSubagentRecord)),

        getSubagentResult: (childRunId: string, consume = false): Promise<ChatSubagentRecordSnapshot | null> => {
          const record = this.subagents.getResult(childRunId, { consume });
          return Promise.resolve(record ? snapshotSubagentRecord(record) : null);
        },

        cancelSubagent: (childRunId: string): Promise<boolean> =>
          Promise.resolve(this.subagents.abort(childRunId)),

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
    await this.recoveredRunsReady;

    const abortController = new AbortController();
    activeRuns.set(runId, abortController);

    const runtimeId = selectRuntimeId(settings, 'pi-ai');
    await this.runs.createRun({
      runId,
      sessionId,
      parentRunId: req.parentRunId,
      runtimeId,
      settings,
      input: { message },
      replay: req.replay,
      inputPreview: message,
      workDir: process.cwd(),
    });

    this.emitStreamEvent({ type: 'run_queued', runId });

    try {
      if (req.replay) {
        const event = replayRuntimeLog(runId, req.replay);
        await this.persistRunEvent(runId, event);
        this.emitStreamEvent({ type: 'runtime_event', runId, sessionId, event });
      }

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
      const agentHarness = createAgentHarness({
        defaultRuntimeId: 'pi-ai',
        runtimes: [
          { id: 'pi-ai', create: () => new PiAiRuntime() },
          { id: 'pi-embedded', create: () => new PiEmbeddedRuntime() },
          {
            id: TELEGRAPH_SUBAGENTS_RUNTIME_ID,
            create: () => new TelegraphSubagentHarness({ subagentManager: this.subagents }),
          },
          { id: 'telegraph-orchestrator', aliases: ['orchestrator-core'], create: () => createDemoOrchestratorRuntime() },
        ],
        capabilities: createPageletRunCapabilities({
          runId,
          sessionId,
          pageletId: 'chat',
          pageletKind: 'chat',
          settings,
          feedback: {
            notify: input => {
              if (!input.runId) return;
              const event = feedbackRuntimeLog(input);
              void this.persistRunEvent(input.runId, event);
              this.emitStreamEvent({ type: 'runtime_event', runId: input.runId, sessionId: input.sessionId, event });
            },
          },
          emit: event => {
            void this.persistRunEvent(runId, event);
            this.emitStreamEvent({ type: 'runtime_event', runId, sessionId, event });
          },
          prompt: prompt => this.promptForPermission(prompt),
        }),
      });

      for await (const ev of agentHarness.run(agentRequest, { signal: abortController.signal })) {
        if (abortController.signal.aborted) break;

        await this.persistRunEvent(runId, ev);
        this.emitStreamEvent({ type: 'runtime_event', runId, sessionId, event: ev });

        const chatEvent = this.agentEventToLegacyChatStream(ev, runId, sessionId);
        if (chatEvent) {
          this.emitStreamEvent(chatEvent);
        }
      }

      if (abortController.signal.aborted) {
        const event = cancelledAgentEvent(runId);
        await this.persistRunEvent(runId, event);
        this.emitStreamEvent({ type: 'runtime_event', runId, sessionId, event });
        this.emitStreamEvent({ type: 'run_failed', runId, error: 'Cancelled' });
        activeRuns.delete(runId);
        this.resolvePendingPermissionsForRun(runId, denyDecision('Run was cancelled before permission was resolved'));
        return { runId, status: 'cancelled', error: 'Cancelled' };
      }

      activeRuns.delete(runId);
      this.resolvePendingPermissionsForRun(runId, denyDecision('Run finished before permission was resolved'));
      return { runId, status: 'completed' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      await this.persistRunEvent(runId, failedAgentEvent(runId, errorMsg));
      this.emitStreamEvent({ type: 'run_failed', runId, error: errorMsg });
      activeRuns.delete(runId);
      this.resolvePendingPermissionsForRun(runId, denyDecision('Run failed before permission was resolved'));
      return { runId, status: 'failed', error: errorMsg };
    }
  }

  private promptForPermission(prompt: PermissionPrompt): Promise<PermissionDecision> {
    const requestId = `perm:${prompt.context.runId}:${String(Date.now())}:${String(++permissionRequestCounter)}`;
    const snapshot: ChatPermissionRequestSnapshot = {
      id: requestId,
      runId: prompt.context.runId,
      sessionId: prompt.context.sessionId,
      permission: prompt.permission,
      context: prompt.context,
      proposedDecision: prompt.proposedDecision,
      createdAt: Date.now(),
    };

    return new Promise<PermissionDecision>(resolve => {
      this.pendingPermissions.set(requestId, { snapshot, resolve });
      this.emitStreamEvent({
        type: 'permission_pending',
        runId: snapshot.runId,
        sessionId: snapshot.sessionId,
        permissionRequest: snapshot,
      });
    });
  }

  private resolvePermissionRequest(requestId: string, resolution: ChatPermissionResolution): boolean {
    const pending = this.pendingPermissions.get(requestId);
    if (!pending) return false;
    this.pendingPermissions.delete(requestId);
    pending.resolve({
      granted: resolution.granted,
      source: 'user',
      reason: resolution.reason ?? (resolution.granted ? 'Approved in Chat permission UI' : 'Denied in Chat permission UI'),
    });
    return true;
  }

  private resolvePendingPermissionsForRun(runId: string, decision: PermissionDecision): void {
    for (const [requestId, pending] of this.pendingPermissions) {
      if (pending.snapshot.runId !== runId) continue;
      this.pendingPermissions.delete(requestId);
      pending.resolve(decision);
    }
  }

  private async persistRunEvent(runId: string, event: AgentEvent): Promise<void> {
    try {
      await this.runs.appendEvent(runId, event);
    } catch {
      // Run persistence is observability; it must not break agent streaming.
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

function snapshotSubagentRecord(record: SubagentRecord): ChatSubagentRecordSnapshot {
  return {
    id: record.id,
    parentRunId: record.parentRunId,
    agent: record.agent,
    label: record.label,
    description: record.description,
    task: record.task,
    status: record.status,
    result: record.result,
    error: record.error,
    toolUses: record.toolUses,
    startedAt: record.startedAt,
    completedAt: record.completedAt,
    resultConsumed: record.resultConsumed,
  };
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

function failedAgentEvent(runId: string, message: string): AgentEvent {
  return {
    type: 'run_failed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-chat-pagelet@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'chat-pagelet' },
    runId,
    error: {
      code: 'chat_pagelet_send_error',
      message,
    },
    ts: Date.now(),
  };
}

function replayRuntimeLog(runId: string, replay: AgentRunReplaySource): AgentEvent {
  return {
    type: 'runtime_log',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-chat-pagelet@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'chat-pagelet' },
    runId,
    level: 'info',
    message: `Run started from ${replay.mode} of ${replay.sourceRunId}`,
    raw: replay,
    ts: Date.now(),
  };
}

function denyDecision(reason: string): PermissionDecision {
  return {
    granted: false,
    source: 'default-deny',
    reason,
  };
}
