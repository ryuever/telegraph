import { join } from 'node:path';
import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import type { ElectronMessagePortMainChannel } from '@x-oasis/async-call-rpc-electron';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import {
  DESIGN_PAGELET_SERVICE_PATH,
  type DesignAgentSendRequest,
  type DesignAgentSendResult,
  type DesignAgentRunEventRecordSnapshot,
  type DesignAgentStreamEvent,
  type DesignAgentRunRecordSnapshot,
  type DesignDeleteSessionRunsResult,
  type DesignArtifactPatchApplyResult,
  type DesignArtifactExportRequest,
  type DesignArtifactExportResult,
  type DesignArtifactPatchPreviewResult,
  type DesignArtifactPatchRequest,
  type DesignExportablePatchArtifact,
  type DesignConfiguredModelDescriptorSnapshot,
  type DesignSubagentRecordSnapshot,
} from '@/apps/design/application/common';
import { createDemoOrchestratorRuntime } from '@/packages/agent/runtime/OrchestratorCoreRunner';
import { createAgentHarness, InMemoryAgentSessionStore } from '@/packages/agent/harness';
import { PermissionBroker } from '@/packages/agent/harness/PermissionBroker';
import {
  createPageletRunCapabilities,
  PermissionedNodePatchCapability,
} from '@/packages/agent/harness/node';
import { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime';
import { PiEmbeddedRuntime } from '@/packages/agent/runtime/PiEmbeddedRuntime';
import { listPiConfiguredModels } from '@/packages/agent/runtime/pi-ai-provider-config';
import { TelegraphSubagentHarness } from '@/extensions/telegraph-subagents/src/TelegraphSubagentHarness';
import { TELEGRAPH_SUBAGENTS_RUNTIME_ID } from '@/packages/agent-extension-host';
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent, type AgentRunRequest } from '@/packages/agent-protocol';
import type { PermissionRequest, RuntimeSettings } from '@/packages/agent-protocol';
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build';
import { BufferedAgentRunEventWriter } from '@/packages/agent/persistence/BufferedAgentRunEventWriter';
import { FileAgentRunRepository } from '@/packages/agent/persistence/AgentRunRepository';
import type { AgentRunEventRecord, AgentRunRecord } from '@/packages/agent/persistence/AgentRunRepository';
import type {
  ApprovalRequestChangeEvent,
  ISharedService,
  RunControlCommandChangeEvent,
  RunIntentRecord,
  RunProjectionStatus,
} from '@/apps/shared/application/common';
import type { RemoteArtifactRef } from '@/packages/remote-protocol';
import { DesignBuildRuntime } from './design-build/DesignBuildRuntime';
import { DesignExportPipeline } from './design-build/DesignExportPipeline';
import { DesignHarnessRunController } from './DesignHarnessRunController';
import {
  designRunSnapshotFromLedger,
  designRunSnapshotFromRecord,
} from './DesignRunStore';

export const DesignPageletWorkerId = createId('DesignPageletWorker');

@injectable()
export class DesignPageletWorker extends PageletWorker<ISharedService> {
  private readonly runControl = new DesignHarnessRunController();
  private readonly agentSessions = new InMemoryAgentSessionStore();
  private readonly runs = new FileAgentRunRepository(join(process.cwd(), '.telegraph', 'design-runs'));
  private readonly runEvents = new BufferedAgentRunEventWriter(this.runs, {
    onFlush: async (_runId, records) => {
      const last = records[records.length - 1];
      const record = await this.runs.getRun(last.runId);
      if (record) await this.publishRunProjection(record, last);
    },
  });
  private readonly recoveredRunsReady = this.runs.markRunningRunsRecovered().catch(() => []);
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

  protected override onRendererConnection(channel: ElectronMessagePortMainChannel): void {
    serviceHost.registerService(DESIGN_PAGELET_SERVICE_PATH, {
      channel,
      handlers: {
        info: (): string => `design-pagelet ready (pid=${String(process.pid)})`,
        ping: (now: number) =>
          Promise.resolve({ pong: now, serverTime: Date.now() }),
        listConfiguredModels: async (): Promise<DesignConfiguredModelDescriptorSnapshot[]> =>
          listPiConfiguredModels(),
        sendAgent: (request: DesignAgentSendRequest): Promise<DesignAgentSendResult> =>
          this.handleSendAgent(request),
        cancelAgent: (runId: string): Promise<boolean> =>
          Promise.resolve(this.runControl.cancelRun(runId)),
        listAgentRuns: async (): Promise<DesignAgentRunRecordSnapshot[]> => {
          await this.recoveredRunsReady;
          await this.runEvents.flushAll();
          const records = await this.runs.listRuns();
          return records.map(record => designRunSnapshotFromRecord(record));
        },
        deleteAgentSessionRuns: async (sessionId: string): Promise<DesignDeleteSessionRunsResult> => {
          return this.deleteAgentSessionRuns(sessionId);
        },
        getAgentRun: async (runId: string): Promise<DesignAgentRunRecordSnapshot | null> => {
          await this.recoveredRunsReady;
          await this.runEvents.flushRun(runId);
          const record = await this.runs.getRun(runId);
          if (!record) return null;
          return designRunSnapshotFromLedger(record, await this.runs.listRunEvents(runId));
        },
        listAgentRunEvents: async (runId: string): Promise<DesignAgentRunEventRecordSnapshot[]> => {
          await this.recoveredRunsReady;
          await this.runEvents.flushRun(runId);
          return this.runs.listRunEvents(runId);
        },
        listSubagents: (): Promise<DesignSubagentRecordSnapshot[]> =>
          Promise.resolve(this.runControl.listSubagents()),
        getSubagentResult: (childRunId: string, consume?: boolean): Promise<DesignSubagentRecordSnapshot | null> =>
          Promise.resolve(this.runControl.getSubagentResult(childRunId, consume === true)),
        cancelSubagent: (childRunId: string): Promise<boolean> =>
          Promise.resolve(this.runControl.cancelSubagent(childRunId)),
        previewArtifactPatch: (request: DesignArtifactPatchRequest): Promise<DesignArtifactPatchPreviewResult> =>
          this.handlePreviewArtifactPatch(request),
        applyArtifactPatch: (request: DesignArtifactPatchRequest): Promise<DesignArtifactPatchApplyResult> =>
          this.handleApplyArtifactPatch(request),
        exportArtifact: (request: DesignArtifactExportRequest): Promise<DesignArtifactExportResult> =>
          this.handleExportArtifact(request),
        onAgentEvent: (callback: (event: DesignAgentStreamEvent) => void): { unsubscribe: () => void } => {
          return this.runControl.subscribe(callback);
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

  private async handleSendAgent(request: DesignAgentSendRequest): Promise<DesignAgentSendResult> {
    const sessionId = request.sessionId ?? `design-${request.runId}`;
    await this.recoveredRunsReady;
    const sourceIntentId = sourceIntentIdFromContext(request.context);
    if (sourceIntentId) {
      this.sourceIntentIds.set(request.runId, sourceIntentId);
    }

    const createdRun = await this.runs.createRun({
      runId: request.runId,
      sessionId,
      runtimeId: request.settings.backend ?? TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
      settings: request.settings,
      input: { message: request.prompt },
      inputPreview: request.prompt,
      workDir: process.cwd(),
    });
    void this.publishRunProjection(createdRun);

    const run = this.runControl.startRun({
      runId: request.runId,
      sessionId,
      prompt: request.prompt,
    });

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
    const agentHarness = createAgentHarness({
      defaultRuntimeId: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
      sessionStore: this.agentSessions,
      runtimes: [
        { id: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID, create: () => new DesignBuildRuntime() },
        { id: 'pi-ai', create: () => new PiAiRuntime() },
        { id: 'pi-embedded', create: () => new PiEmbeddedRuntime() },
        {
          id: TELEGRAPH_SUBAGENTS_RUNTIME_ID,
          create: () => new TelegraphSubagentHarness({ subagentManager: this.runControl.subagents }),
        },
        { id: 'telegraph-orchestrator', aliases: ['orchestrator-core'], create: () => createDemoOrchestratorRuntime() },
      ],
      capabilities: createPageletRunCapabilities({
        runId: request.runId,
        sessionId,
        pageletId: 'design',
        pageletKind: 'design',
        settings: request.settings,
        feedback: {
          notify: input => {
            if (!input.runId) return;
            const event = feedbackRuntimeLog(input);
            void this.persistRunEvent(input.runId, event);
            this.runControl.emitAgentEvent({ type: 'agent_event', runId: input.runId, sessionId: input.sessionId, event });
          },
        },
        emit: event => {
          void this.persistRunEvent(request.runId, event);
          this.runControl.emitAgentEvent({ type: 'agent_event', runId: request.runId, sessionId, event });
        },
      }),
    });

    try {
      let terminal: { status: 'completed' | 'failed' | 'cancelled'; error?: string } | undefined;
      for await (const event of agentHarness.run(agentRequest, { signal: run.signal })) {
        if (run.signal.aborted) break;
        await this.persistRunEvent(request.runId, event);
        this.runControl.emitAgentEvent({ type: 'agent_event', runId: request.runId, sessionId, event });
        if (event.type === 'run_completed') {
          terminal = { status: 'completed' };
        } else if (event.type === 'run_failed') {
          terminal = { status: 'failed', error: event.error.message };
        } else if (event.type === 'run_cancelled') {
          terminal = { status: 'cancelled', error: event.reason ?? 'Cancelled' };
        }
      }

      this.runControl.finishRun(request.runId);
      if (run.signal.aborted) {
        const event = cancelledAgentEvent(request.runId);
        await this.persistRunEvent(request.runId, event);
        this.runControl.emitAgentEvent({
          type: 'agent_event',
          runId: request.runId,
          sessionId,
          event,
        });
        return { runId: request.runId, status: 'cancelled', error: 'Cancelled' };
      }
      if (terminal?.status === 'cancelled') {
        this.runControl.completeRun(request.runId, 'cancelled', terminal.error);
        return { runId: request.runId, status: 'cancelled', error: terminal.error };
      }
      if (terminal?.status === 'failed') {
        this.runControl.completeRun(request.runId, 'failed', terminal.error);
        return { runId: request.runId, status: 'failed', error: terminal.error };
      }
      this.runControl.completeRun(request.runId, 'completed');
      return { runId: request.runId, status: 'completed' };
    } catch (error) {
      this.runControl.finishRun(request.runId);
      const message = error instanceof Error ? error.message : String(error);
      await this.persistRunEvent(request.runId, failedAgentEvent(request.runId, message));
      this.runControl.emitAgentEvent({ type: 'run_failed', runId: request.runId, sessionId, error: message });
      return { runId: request.runId, status: 'failed', error: message };
    }
  }

  private async persistRunEvent(runId: string, event: AgentEvent): Promise<void> {
    try {
      await this.runEvents.append(runId, event);
    } catch {
      // Ledger persistence must not break live agent streaming.
    }
  }

  private async deleteAgentSessionRuns(sessionId: string): Promise<DesignDeleteSessionRunsResult> {
    await this.recoveredRunsReady;
    await this.runEvents.flushAll();

    const records = await this.runs.listRuns({ sessionId, limit: Number.MAX_SAFE_INTEGER });
    for (const record of records) {
      this.runControl.cancelRun(record.runId);
      this.sourceIntentIds.delete(record.runId);
    }

    const deletedRunIds = await this.runs.deleteRunsForSession(sessionId);
    try {
      await this.shared.deleteRunProjectionsForSession({ sessionId, pageletId: 'design' });
    } catch {
      // Shared projections are a cache; the pagelet ledger deletion is authoritative.
    }

    return { sessionId, deletedRunIds };
  }

  private async publishRunProjection(record: AgentRunRecord, event?: AgentRunEventRecord): Promise<void> {
    try {
      const artifactRefs = remoteArtifactRefs(record.artifactRefs, await this.runs.listRunEvents(record.runId));
      await this.shared.registerRunProjection({
        runId: record.runId,
        sessionId: record.sessionId,
        pageletId: 'design',
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

    if (!this.runControl.cancelRun(event.runId)) return;
    await this.shared.markRunControlCommandApplied(event.commandId);
  }

  private async consumeQueuedRunIntents(): Promise<void> {
    try {
      const intents = await this.shared.listRunIntents({
        status: 'queued',
        targetPagelet: 'design',
        limit: 5,
      });
      if (!Array.isArray(intents)) return;

      for (const intent of intents) {
        if (this.runControl.getRun(intentRunId(intent))) continue;
        await this.claimAndRunIntent(intent);
      }
    } catch {
      // Intent consumption is opportunistic; direct renderer runs must continue unaffected.
    }
  }

  private async claimAndRunIntent(intent: RunIntentRecord): Promise<void> {
    const runId = intentRunId(intent);
    const claimed = await this.shared.claimRunIntent(intent.intentId, {
      claimedBy: this.config.selfId,
      runId,
    });
    if (!claimed || claimed.runId !== runId || claimed.claimedBy !== this.config.selfId) return;

    void this.handleSendAgent({
      runId,
      sessionId: intent.sessionId ?? `design-${intent.intentId}`,
      prompt: intent.prompt,
      settings: settingsFromIntent(intent),
      context: {
        sourceIntentId: intent.intentId,
        source: intent.source,
        metadata: intent.metadata ?? {},
      },
    });
  }

  private async handlePreviewArtifactPatch(
    request: DesignArtifactPatchRequest,
  ): Promise<DesignArtifactPatchPreviewResult> {
    try {
      const patch = this.createDesignPatchCapability(request, false);
      const preview = await patch.preview(request.operations);
      return {
        runId: request.runId,
        artifactId: request.artifactId,
        status: 'previewed',
        preview,
      };
    } catch (error) {
      return {
        runId: request.runId,
        artifactId: request.artifactId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async handleApplyArtifactPatch(
    request: DesignArtifactPatchRequest,
  ): Promise<DesignArtifactPatchApplyResult> {
    try {
      assertDesignPatchApplyAllowed(request);
      const patch = this.createDesignPatchCapability(request, true);
      const result = await patch.apply(request.operations);
      return {
        runId: request.runId,
        artifactId: request.artifactId,
        status: 'applied',
        preview: {
          operations: result.operations,
          summary: result.summary,
        },
        applied: result.applied,
      };
    } catch (error) {
      return {
        runId: request.runId,
        artifactId: request.artifactId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async handleExportArtifact(
    request: DesignArtifactExportRequest,
  ): Promise<DesignArtifactExportResult> {
    try {
      const artifact = exportablePatchArtifactFromUnknown(request.artifact);
      if (!artifact) throw new Error('Export requires a design-patch artifact with file operations.');
      const pipeline = new DesignExportPipeline();
      const exportArtifact = await pipeline.exportArtifact({
        runId: request.runId,
        artifact,
        formats: request.formats,
      });
      return {
        runId: request.runId,
        artifactId: request.artifactId,
        status: 'exported',
        artifact: exportArtifact,
      };
    } catch (error) {
      return {
        runId: request.runId,
        artifactId: request.artifactId,
        status: 'failed',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private createDesignPatchCapability(
    request: DesignArtifactPatchRequest,
    userConfirmed: boolean,
  ): PermissionedNodePatchCapability {
    const taskProfile = request.settings.taskCapabilityProfile ?? { kind: 'default' as const };
    const emitPatchEvent = (event: AgentEvent): void => {
      void this.persistRunEvent(request.runId, event);
      this.runControl.emitAgentEvent({ type: 'agent_event', runId: request.runId, sessionId: request.sessionId, event });
    };
    const broker = new PermissionBroker({
      prompt: () => userConfirmed,
      emit: emitPatchEvent,
    });

    return new PermissionedNodePatchCapability({
      broker,
      emit: emitPatchEvent,
      allowedRoots: [process.cwd()],
      context: {
        runId: request.runId,
        sessionId: request.sessionId,
        pageletId: 'design',
        pageletKind: 'design',
        taskProfile,
        userIntent: {
          summary: `Apply design artifact patch ${request.artifactId}`,
          requestedCapabilities: ['filesystem'],
        },
        pageletPolicy: {
          allowedCapabilities: ['filesystem'],
        },
        workspacePolicy: {
          filesystem: {
            readableScopes: ['workspace'],
            writableScopes: ['workspace'],
            autoGrantWrites: false,
          },
        },
      },
    });
  }
}

function assertDesignPatchApplyAllowed(request: DesignArtifactPatchRequest): void {
  const profile = request.settings.taskCapabilityProfile;
  if (profile?.kind !== 'design-build') {
    throw new Error('Artifact apply requires the design-build task capability profile');
  }
  if (profile.artifactPolicy !== 'apply-after-confirm') {
    throw new Error('Artifact apply requires apply-after-confirm policy');
  }
  if (!profile.scopes.includes('repo:write')) {
    throw new Error('Artifact apply requires repo:write scope');
  }
}

function exportablePatchArtifactFromUnknown(value: unknown): DesignExportablePatchArtifact | null {
  if (!isRecord(value)) return null;
  const operations = Array.isArray(value.operations)
    ? value.operations.filter(isPatchOperation)
    : [];
  if (operations.length === 0) return null;
  const id = typeof value.id === 'string' ? value.id : undefined;
  const kind = typeof value.kind === 'string' ? value.kind : undefined;
  if (!id || !kind) return null;
  return {
    id,
    kind,
    title: typeof value.title === 'string' ? value.title : undefined,
    revision: typeof value.revision === 'number' ? value.revision : undefined,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
    operations,
  };
}

function isPatchOperation(value: unknown): value is DesignExportablePatchArtifact['operations'][number] {
  if (!isRecord(value)) return false;
  return typeof value.path === 'string' &&
    (value.kind === 'add' || value.kind === 'update' || value.kind === 'delete') &&
    (value.content === undefined || typeof value.content === 'string') &&
    (value.expectedOriginal === undefined || typeof value.expectedOriginal === 'string');
}

function feedbackRuntimeLog(input: { runId?: string; level: 'debug' | 'info' | 'warn' | 'error'; message: string; raw?: unknown; ts?: number }): AgentEvent {
  return {
    type: 'runtime_log',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-design-pagelet@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'design-feedback' },
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
    producerVersion: 'telegraph-design-pagelet@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'design-pagelet' },
    runId,
    reason: 'Cancelled',
    ts: Date.now(),
  };
}

function failedAgentEvent(runId: string, message: string): AgentEvent {
  return {
    type: 'run_failed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-design-pagelet@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'design-pagelet' },
    runId,
    error: {
      code: 'design_pagelet_send_error',
      message,
    },
    ts: Date.now(),
  };
}

function runProjectionStatus(record: AgentRunRecord): RunProjectionStatus {
  if (record.failureReason === 'runtime_recovery') return 'recovered';
  return record.status;
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

function intentRunId(intent: RunIntentRecord): string {
  return intent.runId ?? `design-${intent.intentId}`;
}

function sourceIntentIdFromContext(context: Record<string, unknown> | undefined): string | undefined {
  return typeof context?.sourceIntentId === 'string' ? context.sourceIntentId : undefined;
}

function settingsFromIntent(intent: RunIntentRecord): RuntimeSettings {
  const metadataSettings = metadataRuntimeSettings(intent.metadata);
  return {
    ...metadataSettings,
    backend: metadataSettings.backend ?? TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
    orchestration: metadataSettings.orchestration ?? 'none',
    taskCapabilityProfile: metadataSettings.taskCapabilityProfile ?? {
      kind: 'design-build',
      scopes: ['artifact:write', 'repo:read'],
      artifactPolicy: 'preview',
    },
  };
}

function metadataRuntimeSettings(metadata: Record<string, unknown> | undefined): RuntimeSettings {
  const settings = metadata?.settings;
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return {};
  return settings;
}
