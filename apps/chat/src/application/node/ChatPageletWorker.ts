import { join } from 'node:path';
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
import type { AgentSessionStore } from '@/packages/agent/harness';
import { createPageletRunCapabilities, FileAgentSessionStore } from '@/packages/agent/harness/node';
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent, type AgentRunRequest, type PermissionRequest, type RuntimeMessage } from '@/packages/agent-protocol';
import type { PermissionDecision, PermissionPrompt } from '@/packages/agent/harness/PermissionBroker';
import { BufferedAgentRunEventWriter } from '@/packages/agent/persistence/BufferedAgentRunEventWriter';
import { FileAgentRunRepository } from '@/packages/agent/persistence/AgentRunRepository';
import type {
  AgentRunEventRecord,
  AgentRunRecord,
  AgentRunReplaySource,
  ListAgentRunsOptions,
} from '@/packages/agent/persistence/AgentRunRepository';
import type {
  ClaimRunIntentInput,
  ApprovalRequestChangeEvent,
  ListRunIntentsOptions,
  RegisterRunProjectionInput,
  RunControlCommandChangeEvent,
  RunIntentRecord,
  RunProjectionRecord,
  RunProjectionStatus,
} from '@/packages/run-protocol';
import type { RemoteArtifactRef } from '@/packages/remote-protocol';
import { resolveChatRunMessages } from './chat-session-messages';

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

interface ChatRunBrokerService {
  registerRunProjection(input: RegisterRunProjectionInput): Promise<RunProjectionRecord>;
  listRunIntents(options?: ListRunIntentsOptions): Promise<RunIntentRecord[]>;
  claimRunIntent(intentId: string, input: ClaimRunIntentInput): Promise<RunIntentRecord | null>;
  subscribeApprovals(callback: (event: ApprovalRequestChangeEvent) => void): { unsubscribe(): void };
  subscribeRunControlCommands(callback: (event: RunControlCommandChangeEvent) => void): { unsubscribe(): void };
  markRunControlCommandApplied(commandId: string, now?: number): Promise<unknown>;
}

@injectable()
export class ChatPageletWorker extends PageletWorker<ChatRunBrokerService> {
  private streamListeners = new Set<(event: ChatStreamEvent) => void>();
  private readonly subagents = new SubagentManager();
  private readonly agentSessions = new FileAgentSessionStore(join(process.cwd(), '.telegraph', 'chat-sessions'));
  private readonly runs = new FileAgentRunRepository();
  private readonly runEvents = new BufferedAgentRunEventWriter(this.runs, {
    onFlush: async (_runId, records) => {
      const last = records[records.length - 1];
      const record = await this.runs.getRun(last.runId);
      if (record) await this.publishRunProjection(record, last);
    },
  });
  private readonly recoveredRunsReady = this.runs.markRunningRunsRecovered().catch(() => []);
  private readonly pendingPermissions = new Map<string, PendingPermissionRequest>();
  private readonly sourceIntentIds = new Map<string, string>();
  private intentPollTimer: ReturnType<typeof setInterval> | null = null;
  private recoveredRunProjectionPublishStarted = false;
  private approvalSubscription: { unsubscribe(): void } | null = null;
  private runControlSubscription: { unsubscribe(): void } | null = null;
  private readonly ledgeredApprovalChangeKeys = new Set<string>();
  private readonly ledgeredRunControlKeys = new Set<string>();

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
          await this.runEvents.flushAll();
          return this.runs.listRuns(options);
        },

        getRun: async (runId: string): Promise<ChatAgentRunRecordSnapshot | null> => {
          await this.recoveredRunsReady;
          await this.runEvents.flushRun(runId);
          return this.runs.getRun(runId);
        },

        listRunEvents: async (runId: string): Promise<ChatAgentRunEventRecordSnapshot[]> => {
          await this.recoveredRunsReady;
          await this.runEvents.flushRun(runId);
          return this.runs.listRunEvents(runId);
        },

        listRuntimeCapabilities: (): Promise<ChatRuntimeCapabilityDescriptorSnapshot[]> =>
          Promise.resolve(listRuntimeCapabilityDescriptors()),

        exportRunTraceBundle: async (runId: string): Promise<ChatRunTraceBundle | null> => {
          await this.recoveredRunsReady;
          await this.runEvents.flushRun(runId);
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

        getSubagentResult: (childRunId: string, consume: boolean = false): Promise<ChatSubagentRecordSnapshot | null> => {
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

  protected override onSharedClientReady(): void {
    void this.publishRecoveredRunProjections();
    this.subscribeApprovalLedgerBridge();
    this.subscribeRunControlBridge();
    if (this.intentPollTimer) return;
    void this.consumeQueuedRunIntents();
    this.intentPollTimer = setInterval(() => {
      void this.consumeQueuedRunIntents();
    }, 1_500);
    this.intentPollTimer.unref();
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
    if (req.sourceIntentId) {
      this.sourceIntentIds.set(runId, req.sourceIntentId);
    }

    const abortController = new AbortController();
    activeRuns.set(runId, abortController);

    const runtimeId = selectRuntimeId(settings, 'pi-ai');
    const createdRun = await this.runs.createRun({
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
    void this.publishRunProjection(createdRun);

    this.emitStreamEvent({
      type: 'run_queued',
      runId,
      sessionId,
      sourceIntentId: req.sourceIntentId,
      message,
    });

    try {
      if (req.replay) {
        const event = replayRuntimeLog(runId, req.replay);
        await this.persistRunEvent(runId, event);
        this.emitStreamEvent({ type: 'runtime_event', runId, sessionId, event });
      }

      const agentRequest: AgentRunRequest = {
        runId,
        sessionId,
        messages: this.messagesForRun(req),
        settings,
      };
      const agentHarness = createAgentHarness({
        defaultRuntimeId: 'pi-ai',
        sessionStore: this.sessionStoreForRun(req),
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

  private messagesForRun(req: ChatSendRequest): RuntimeMessage[] {
    return resolveChatRunMessages(req);
  }

  private sessionStoreForRun(req: ChatSendRequest): AgentSessionStore {
    return hasAuthoritativeRendererTranscript(req)
      ? new RendererTranscriptSessionStore(this.agentSessions)
      : this.agentSessions;
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
      await this.runEvents.append(runId, event);
    } catch {
      // Run persistence is observability; it must not break agent streaming.
    }
  }

  private async publishRunProjection(record: AgentRunRecord, event?: AgentRunEventRecord): Promise<void> {
    try {
      const artifactRefs = remoteArtifactRefs(record.artifactRefs, await this.runs.listRunEvents(record.runId));
      await this.shared.registerRunProjection({
        runId: record.runId,
        sessionId: record.sessionId,
        pageletId: 'chat',
        status: runProjectionStatus(record),
        title: record.inputPreview,
        promptPreview: record.inputPreview,
        cursor: event?.seq ?? record.eventCount,
        eventCount: record.eventCount,
        artifactCount: record.artifactRefs.length,
        artifactRefs,
        activeArtifactTitle: artifactRefs.at(-1)?.title ?? record.artifactRefs.at(-1),
        error: record.failureMessage,
        sourceIntentId: this.sourceIntentIds.get(record.runId),
        updatedAt: record.lastEventAt ?? record.completedAt ?? record.startedAt ?? record.createdAt,
        metadata: {
          runtimeId: record.runtimeId,
          failureReason: record.failureReason,
        },
      });
    } catch {
      // RunBroker projection is a control-plane cache; the pagelet ledger remains authoritative.
    }
  }

  private async publishRecoveredRunProjections(): Promise<void> {
    if (this.recoveredRunProjectionPublishStarted) return;
    this.recoveredRunProjectionPublishStarted = true;
    try {
      const recoveredRuns = await this.recoveredRunsReady;
      for (const record of recoveredRuns) {
        await this.publishRunProjection(record);
      }
    } catch {
      // Projection recovery is best-effort; pagelet-local ledger remains authoritative.
    }
  }

  private subscribeApprovalLedgerBridge(): void {
    if (this.approvalSubscription) return;
    try {
      this.approvalSubscription = this.shared.subscribeApprovals(event => {
        void this.persistApprovalChangeEvent(event);
      });
    } catch {
      this.approvalSubscription = null;
    }
  }

  private async persistApprovalChangeEvent(event: ApprovalRequestChangeEvent): Promise<void> {
    if (event.approval.status === 'pending') return;
    const key = `${event.approvalId}:${String(event.cursor)}`;
    if (this.ledgeredApprovalChangeKeys.has(key)) return;
    this.ledgeredApprovalChangeKeys.add(key);

    const run = await this.runs.getRun(event.runId);
    if (!run) return;
    await this.persistRunEvent(event.runId, approvalChangeRuntimeEvent(event));
    await this.runEvents.flushRun(event.runId);
  }

  private subscribeRunControlBridge(): void {
    if (this.runControlSubscription) return;
    try {
      this.runControlSubscription = this.shared.subscribeRunControlCommands(event => {
        void this.handleRunControlCommand(event);
      });
    } catch {
      this.runControlSubscription = null;
    }
  }

  private async handleRunControlCommand(event: RunControlCommandChangeEvent): Promise<void> {
    if (event.command.status !== 'accepted') return;
    const key = `${event.commandId}:${String(event.cursor)}`;
    if (this.ledgeredRunControlKeys.has(key)) return;
    this.ledgeredRunControlKeys.add(key);

    const run = await this.runs.getRun(event.runId);
    if (!run) return;

    await this.persistRunEvent(event.runId, runControlRuntimeLogEvent(event));
    await this.runEvents.flushRun(event.runId);

    if (event.command.kind === 'pause') {
      await this.persistRunEvent(event.runId, runControlUnsupportedPauseEvent(event));
      await this.runEvents.flushRun(event.runId);
      return;
    }

    const controller = activeRuns.get(event.runId);
    if (!controller) return;
    controller.abort();
    activeRuns.delete(event.runId);
    this.resolvePendingPermissionsForRun(event.runId, denyDecision(`Run ${event.command.kind} requested remotely`));
    await this.shared.markRunControlCommandApplied(event.commandId);
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
        return null;

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

  private async consumeQueuedRunIntents(): Promise<void> {
    try {
      const intents = await this.shared.listRunIntents({
        status: 'queued',
        targetPagelet: 'chat',
        limit: 5,
      });
      if (!Array.isArray(intents)) return;

      for (const intent of intents) {
        if (activeRuns.has(intentRunId(intent))) continue;
        await this.claimAndRunIntent(intent);
      }
    } catch {
      // Intent consumption is opportunistic; direct renderer chat sends must keep working.
    }
  }

  private async claimAndRunIntent(intent: RunIntentRecord): Promise<void> {
    const runId = intentRunId(intent);
    const claimed = await this.shared.claimRunIntent(intent.intentId, {
      claimedBy: this.config.selfId,
      runId,
    });
    if (!claimed || claimed.runId !== runId || claimed.claimedBy !== this.config.selfId) return;

    void this.handleSend({
      runId,
      sessionId: intent.sessionId ?? `chat-${intent.intentId}`,
      message: intent.prompt,
      settings: settingsFromIntent(intent),
      sourceIntentId: intent.intentId,
    });
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

function runProjectionStatus(record: AgentRunRecord): RunProjectionStatus {
  if (record.failureReason === 'runtime_recovery') return 'recovered';
  return record.status;
}

function intentRunId(intent: RunIntentRecord): string {
  return intent.runId ?? `chat-${intent.intentId}`;
}

function settingsFromIntent(intent: RunIntentRecord): ChatSendRequest['settings'] {
  const metadataSettings = metadataChatSettings(intent.metadata);
  return {
    provider: metadataSettings.provider ?? 'telegraph',
    modelId: metadataSettings.modelId ?? 'pi-embedded',
    apiKey: metadataSettings.apiKey ?? '',
    backend: metadataSettings.backend ?? 'pi-embedded',
    orchestration: metadataSettings.orchestration ?? 'none',
    orchestrationPattern: metadataSettings.orchestrationPattern,
    worktreeIsolation: metadataSettings.worktreeIsolation,
    extensionBlocklist: metadataSettings.extensionBlocklist,
    taskCapabilityProfile: metadataSettings.taskCapabilityProfile,
  };
}

class RendererTranscriptSessionStore implements AgentSessionStore {
  constructor(private readonly delegate: AgentSessionStore) {}

  getMessages(): RuntimeMessage[] {
    return [];
  }

  appendMessages(sessionId: string, messages: RuntimeMessage[]): void | Promise<void> {
    return this.delegate.appendMessages(sessionId, messages.filter(shouldPersistChatSessionMessage));
  }
}

function shouldPersistChatSessionMessage(message: RuntimeMessage): boolean {
  return !(message.role === 'assistant' && message.metadata?.source === 'chat-renderer');
}

function hasAuthoritativeRendererTranscript(req: ChatSendRequest): boolean {
  return Array.isArray(req.messages) &&
    req.messages.some(message => message.role === 'assistant' && message.content.trim().length > 0);
}

function metadataChatSettings(metadata: Record<string, unknown> | undefined): Partial<ChatSendRequest['settings']> {
  const settings = metadata?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  return settings;
}

function remoteArtifactRefs(uris: string[], events: AgentRunEventRecord[] = []): RemoteArtifactRef[] {
  const refs = new Map<string, RemoteArtifactRef>();
  for (const event of events) {
    for (const ref of extractRemoteArtifactRefs(event.event)) {
      refs.set(ref.uri, mergeRemoteArtifactRef(refs.get(ref.uri), ref));
    }
  }
  for (const uri of uris) {
    refs.set(uri, mergeRemoteArtifactRef(refs.get(uri), fallbackRemoteArtifactRef(uri)));
  }
  return uris
    .map(uri => refs.get(uri) ?? fallbackRemoteArtifactRef(uri))
    .concat(Array.from(refs.values()).filter(ref => !uris.includes(ref.uri)));
}

function extractRemoteArtifactRefs(value: unknown): RemoteArtifactRef[] {
  if (!value || typeof value !== 'object') return [];
  const refs: RemoteArtifactRef[] = [];
  const record = value as Record<string, unknown>;
  collectRemoteArtifactRefsFromRecord(record, refs);
  if (isRecord(record.output)) collectRemoteArtifactRefsFromRecord(record.output, refs);
  return refs;
}

function collectRemoteArtifactRefsFromRecord(record: Record<string, unknown>, refs: RemoteArtifactRef[]): void {
  if (Array.isArray(record.artifactRefs)) {
    for (const item of record.artifactRefs) {
      const ref = toRemoteArtifactRef(item);
      if (ref) refs.push(ref);
    }
  }

  const artifactRef = toRemoteArtifactRef(record.artifactRef);
  if (artifactRef) refs.push(artifactRef);

  if (!Array.isArray(record.observations)) return;
  for (const observation of record.observations) {
    if (!isRecord(observation)) continue;
    const ref = toRemoteArtifactRef(observation.artifactRef);
    if (ref) refs.push(ref);
  }
}

function toRemoteArtifactRef(value: unknown): RemoteArtifactRef | null {
  if (typeof value === 'string') return fallbackRemoteArtifactRef(value);
  if (!isRecord(value) || typeof value.uri !== 'string') return null;
  return {
    artifactId: typeof value.artifactId === 'string' ? value.artifactId : artifactIdFromUri(value.uri),
    uri: value.uri,
    mediaType: typeof value.mediaType === 'string' ? value.mediaType : undefined,
    title: typeof value.title === 'string' ? value.title : value.uri.split('/').pop(),
    sizeBytes: typeof value.sizeBytes === 'number' ? value.sizeBytes : undefined,
    sha256: typeof value.sha256 === 'string' ? value.sha256 : undefined,
  };
}

function fallbackRemoteArtifactRef(uri: string): RemoteArtifactRef {
  return {
    artifactId: artifactIdFromUri(uri),
    uri,
    title: uri.split('/').pop(),
  };
}

function mergeRemoteArtifactRef(current: RemoteArtifactRef | undefined, next: RemoteArtifactRef): RemoteArtifactRef {
  return {
    ...next,
    ...current,
    mediaType: current?.mediaType ?? next.mediaType,
    title: current?.title ?? next.title,
    sizeBytes: current?.sizeBytes ?? next.sizeBytes,
    sha256: current?.sha256 ?? next.sha256,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function approvalChangeRuntimeEvent(event: ApprovalRequestChangeEvent): AgentEvent {
  const permission = permissionFromApproval(event.approval.proposedAction);
  if (permission) {
    return {
      type: 'permission_resolved',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: 'telegraph-run-broker-approval@0.0.0',
      origin: { framework: 'telegraph', runtimeId: 'run-broker-approval' },
      runId: event.runId,
      permission,
      granted: event.approval.status === 'approved',
      raw: event.approval,
      ts: event.approval.decidedAt ?? event.approval.updatedAt,
    };
  }

  return {
    type: 'runtime_log',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-run-broker-approval@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'run-broker-approval' },
    runId: event.runId,
    level: event.approval.status === 'approved' ? 'info' : 'warn',
    message: `Approval ${event.approval.status}: ${event.approval.title}`,
    raw: event.approval,
    ts: event.approval.decidedAt ?? event.approval.updatedAt,
  };
}

function runControlRuntimeLogEvent(event: RunControlCommandChangeEvent): AgentEvent {
  return {
    type: 'runtime_log',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-run-broker-control@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'run-broker-control' },
    runId: event.runId,
    level: 'warn',
    message: `Remote run control requested: ${event.command.kind}`,
    raw: event.command,
    ts: event.command.updatedAt,
  };
}

function runControlUnsupportedPauseEvent(event: RunControlCommandChangeEvent): AgentEvent {
  return {
    type: 'runtime_log',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-run-broker-control@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'run-broker-control' },
    runId: event.runId,
    level: 'warn',
    message: 'Remote pause requested, but this runtime has no checkpoint pause capability yet.',
    raw: event.command,
    ts: Date.now(),
  };
}

function permissionFromApproval(proposedAction: Record<string, unknown> | undefined): PermissionRequest | null {
  const permission = proposedAction?.permission;
  if (!isRecord(permission)) return null;
  if (permission.type === 'filesystem' &&
    isFilesystemScope(permission.scope) &&
    isFilesystemAccess(permission.access)) {
    return {
      type: 'filesystem',
      scope: permission.scope,
      access: permission.access,
    };
  }
  if (permission.type === 'process') {
    return {
      type: 'process',
      commands: Array.isArray(permission.commands)
        ? permission.commands.filter((item): item is string => typeof item === 'string')
        : undefined,
    };
  }
  if (permission.type === 'network') {
    return {
      type: 'network',
      hosts: Array.isArray(permission.hosts)
        ? permission.hosts.filter((item): item is string => typeof item === 'string')
        : undefined,
    };
  }
  if (permission.type === 'shell' && isShellRisk(permission.risk)) {
    return { type: 'shell', risk: permission.risk };
  }
  if (permission.type === 'secrets') {
    return {
      type: 'secrets',
      keys: Array.isArray(permission.keys)
        ? permission.keys.filter((item): item is string => typeof item === 'string')
        : undefined,
    };
  }
  return null;
}

function isFilesystemScope(value: unknown): value is Extract<PermissionRequest, { type: 'filesystem' }>['scope'] {
  return value === 'workspace' || value === 'user-selected' || value === 'home' || value === 'any';
}

function isFilesystemAccess(value: unknown): value is Extract<PermissionRequest, { type: 'filesystem' }>['access'] {
  return value === 'read' || value === 'write' || value === 'readwrite';
}

function isShellRisk(value: unknown): value is Extract<PermissionRequest, { type: 'shell' }>['risk'] {
  return value === 'low' || value === 'medium' || value === 'high';
}

function artifactIdFromUri(uri: string): string {
  const segment = uri.split('/').filter(Boolean).pop();
  return segment || uri;
}

function denyDecision(reason: string): PermissionDecision {
  return {
    granted: false,
    source: 'default-deny',
    reason,
  };
}
