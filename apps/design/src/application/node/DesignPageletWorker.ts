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
  type DesignArtifactPatchApplyResult,
  type DesignArtifactPatchPreviewResult,
  type DesignArtifactPatchRequest,
  type DesignSubagentRecordSnapshot,
} from '@/apps/design/application/common';
import { createDemoOrchestratorRuntime } from '@/packages/agent/runtime/OrchestratorCoreRunner';
import { createAgentHarness } from '@/packages/agent/harness';
import { PermissionBroker } from '@/packages/agent/harness/PermissionBroker';
import {
  createPageletRunCapabilities,
  PermissionedNodePatchCapability,
} from '@/packages/agent/harness/node';
import { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime';
import { PiEmbeddedRuntime } from '@/packages/agent/runtime/PiEmbeddedRuntime';
import { TelegraphSubagentHarness } from '@/extensions/telegraph-subagents/src/TelegraphSubagentHarness';
import { TELEGRAPH_SUBAGENTS_RUNTIME_ID } from '@/packages/agent/extensions/harness/constants';
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent, type AgentRunRequest } from '@/packages/agent-protocol';
import type { RuntimeSettings } from '@/packages/agent-protocol';
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build';
import { FileAgentRunRepository } from '@/packages/agent/persistence/AgentRunRepository';
import type { AgentRunEventRecord, AgentRunRecord } from '@/packages/agent/persistence/AgentRunRepository';
import type { ISharedService, RunIntentRecord, RunProjectionStatus } from '@/apps/shared/application/common';
import { DesignBuildRuntime } from './design-build/DesignBuildRuntime';
import { DesignHarnessRunController } from './DesignHarnessRunController';
import { designRunSnapshotFromLedger } from './DesignRunStore';

export const DesignPageletWorkerId = createId('DesignPageletWorker');

@injectable()
export class DesignPageletWorker extends PageletWorker<ISharedService> {
  private readonly runControl = new DesignHarnessRunController();
  private readonly runs = new FileAgentRunRepository(join(process.cwd(), '.telegraph', 'design-runs'));
  private readonly recoveredRunsReady = this.runs.markRunningRunsRecovered().catch(() => []);
  private intentPollTimer: ReturnType<typeof setInterval> | null = null;

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
          Promise.resolve(this.runControl.cancelRun(runId)),
        listAgentRuns: async (): Promise<DesignAgentRunRecordSnapshot[]> => {
          await this.recoveredRunsReady;
          const records = await this.runs.listRuns();
          return Promise.all(records.map(async record =>
            designRunSnapshotFromLedger(record, await this.runs.listRunEvents(record.runId)),
          ));
        },
        getAgentRun: async (runId: string): Promise<DesignAgentRunRecordSnapshot | null> => {
          await this.recoveredRunsReady;
          const record = await this.runs.getRun(runId);
          if (!record) return null;
          return designRunSnapshotFromLedger(record, await this.runs.listRunEvents(runId));
        },
        listAgentRunEvents: async (runId: string): Promise<DesignAgentRunEventRecordSnapshot[]> => {
          await this.recoveredRunsReady;
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
        onAgentEvent: (callback: (event: DesignAgentStreamEvent) => void): { unsubscribe: () => void } => {
          return this.runControl.subscribe(callback);
        },
      },
    });
  }

  protected override onSharedClientReady(): void {
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
      const eventRecord = await this.runs.appendEvent(runId, event);
      const record = await this.runs.getRun(runId);
      if (record) void this.publishRunProjection(record, eventRecord);
    } catch {
      // Ledger persistence must not break live agent streaming.
    }
  }

  private async publishRunProjection(record: AgentRunRecord, event?: AgentRunEventRecord): Promise<void> {
    try {
      await this.shared.registerRunProjection({
        runId: record.runId,
        sessionId: record.sessionId,
        pageletId: 'design',
        status: runProjectionStatus(record),
        title: record.inputPreview,
        promptPreview: record.inputPreview,
        cursor: event?.seq ?? record.eventCount,
        eventCount: record.eventCount,
        error: record.failureMessage,
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

  private createDesignPatchCapability(
    request: DesignArtifactPatchRequest,
    userConfirmed: boolean,
  ): PermissionedNodePatchCapability {
    const taskProfile = request.settings.taskCapabilityProfile ?? { kind: 'default' as const };
    const broker = new PermissionBroker({
      prompt: () => userConfirmed,
      emit: event => {
        this.runControl.emitAgentEvent({ type: 'agent_event', runId: request.runId, sessionId: request.sessionId, event });
      },
    });

    return new PermissionedNodePatchCapability({
      broker,
      emit: event => {
        this.runControl.emitAgentEvent({ type: 'agent_event', runId: request.runId, sessionId: request.sessionId, event });
      },
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

function intentRunId(intent: RunIntentRecord): string {
  return intent.runId ?? `design-${intent.intentId}`;
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
