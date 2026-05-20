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
  type DesignArtifactPatchApplyResult,
  type DesignArtifactPatchPreviewResult,
  type DesignArtifactPatchRequest,
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
import { TelegraphSubagentHarness } from '@/packages/agent/runtime/telegraphSubagents/TelegraphSubagentHarness';
import { TELEGRAPH_SUBAGENTS_RUNTIME_ID } from '@/packages/agent/runtime/telegraphSubagents/constants';
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent, type AgentRunRequest } from '@/packages/agent-protocol';

export const DesignPageletWorkerId = createId('DesignPageletWorker');

const activeAgentRuns = new Map<string, AbortController>();

@injectable()
export class DesignPageletWorker extends PageletWorker {
  private agentListeners = new Set<(event: DesignAgentStreamEvent) => void>();

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
        previewArtifactPatch: (request: DesignArtifactPatchRequest): Promise<DesignArtifactPatchPreviewResult> =>
          this.handlePreviewArtifactPatch(request),
        applyArtifactPatch: (request: DesignArtifactPatchRequest): Promise<DesignArtifactPatchApplyResult> =>
          this.handleApplyArtifactPatch(request),
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
    const agentHarness = createAgentHarness({
      defaultRuntimeId: 'pi-ai',
      runtimes: [
        { id: 'pi-ai', create: () => new PiAiRuntime() },
        { id: 'pi-embedded', create: () => new PiEmbeddedRuntime() },
        {
          id: TELEGRAPH_SUBAGENTS_RUNTIME_ID,
          create: () => new TelegraphSubagentHarness(),
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
            this.emitAgentEvent({ type: 'agent_event', runId: input.runId, sessionId: input.sessionId, event: feedbackRuntimeLog(input) });
          },
        },
        emit: event => {
          this.emitAgentEvent({ type: 'agent_event', runId: request.runId, sessionId, event });
        },
      }),
    });

    try {
      for await (const event of agentHarness.run(agentRequest, { signal: abortController.signal })) {
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
        this.emitAgentEvent({ type: 'agent_event', runId: request.runId, sessionId: request.sessionId, event });
      },
    });

    return new PermissionedNodePatchCapability({
      broker,
      emit: event => {
        this.emitAgentEvent({ type: 'agent_event', runId: request.runId, sessionId: request.sessionId, event });
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
