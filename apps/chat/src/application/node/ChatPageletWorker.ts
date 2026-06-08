import { existsSync } from 'node:fs';
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
  type ChatConfiguredModelDescriptorSnapshot,
  type ChatDeleteSessionRunsResult,
  type ChatSendRequest,
  type ChatSendResult,
  type ChatRunTraceBundle,
  type ChatRunTraceImportResult,
  type ChatSubagentRecordSnapshot,
  type ChatStreamEvent,
  type ChatCommandInvocationResult,
  type ChatNotifyCapability,
  type ChatExtensionNotificationStreamEvent,
  CHAT_NOTIFY_CAPABILITY_KEY,
} from '@/apps/chat/application/common';
import { assertChatRunTraceBundle } from '@/apps/chat/application/common/trace-bundle';
import { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime';
import { PiEmbeddedRuntime } from '@/packages/agent/runtime/PiEmbeddedRuntime';
import { listRuntimeCapabilityDescriptors } from '@/packages/agent/runtime/RuntimeCapabilityDescriptor';
import { EXTENSION_MANIFEST_FILENAME, ExtensionHost } from '@/packages/agent-extensions';
import {
  TelegraphExtensionHostImpl,
  type AgentCapability,
  type CapabilityHookRegistrar,
} from '@/packages/agent-capabilities';
import { TELEGRAPH_SUBAGENTS_MANAGER_KEY } from '@/extensions/telegraph-subagents/src/extension';
import type { SubagentManager } from '@/extensions/telegraph-subagents/src/SubagentManager';
import type { SubagentRecord } from '@/extensions/telegraph-subagents/src/types';
import { createDemoOrchestratorRuntime } from '@/packages/agent/runtime/OrchestratorCoreRunner';
import { listPiConfiguredModels } from '@/packages/agent/runtime/pi-ai-provider-config';
import { createAgentHarness, HookBus, selectRuntimeId } from '@/packages/agent/harness';
import type { AgentSessionStore, RuntimeRegistration } from '@/packages/agent/harness';
import { createPageletRunCapabilities, FileAgentSessionStore } from '@/packages/agent/harness/node';
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent, type AgentRunRequest, type PermissionRequest, type RuntimeMessage } from '@/packages/agent-protocol';
import type { PermissionDecision, PermissionPrompt } from '@/packages/agent/harness/PermissionBroker';
import { BufferedAgentRunEventWriter } from '@/packages/agent/persistence/BufferedAgentRunEventWriter';
import { FileAgentRunRepository } from '@/packages/agent/persistence/AgentRunRepository';
import {
  resolveTelegraphDataDir,
  resolveTelegraphWorkspaceRoot,
} from '@/packages/agent/persistence/telegraphPaths';
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
  deleteRunProjectionsForSession(input: { sessionId: string; pageletId?: string }): Promise<unknown>;
}

@injectable()
export class ChatPageletWorker extends PageletWorker<ChatRunBrokerService> {
  private streamListeners = new Set<(event: ChatStreamEvent) => void>();
  /**
   * D-016 P5: the SubagentManager is now owned by the `@telegraph/subagents`
   * extension factory and handed back to us under
   * {@link TELEGRAPH_SUBAGENTS_MANAGER_KEY}. We resolve it lazily via
   * `extensionsReady` so the pagelet boot path stays synchronous.
   */
  private subagents: SubagentManager | undefined;
  private extensionHost: ExtensionHost | undefined;
  private telegraphHost: TelegraphExtensionHostImpl | undefined;
  /**
   * 4-pack item D: process-lifetime HookBus that backs the extension host's
   * CapabilityHookRegistrar. Extensions subscribe to hooks (e.g. afterRun)
   * once at activation time, but each chat run spins up its own
   * AgentHarness with its own HookBus. We bridge by snapshotting this bus
   * into AgentHarnessOptions.hooks for every harness instance — see
   * `createHarnessForRun` callers.
   */
  private readonly extensionHookBus = new HookBus();
  private readonly extensionsReady: Promise<void> = this.activateExtensions();
  private readonly workspaceRoot = resolveTelegraphWorkspaceRoot();
  private readonly agentSessions = new FileAgentSessionStore(
    join(resolveTelegraphDataDir(), 'chat-sessions'),
  );
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

        deleteSessionRuns: async (sessionId: string): Promise<ChatDeleteSessionRunsResult> => {
          return this.deleteSessionRuns(sessionId);
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

        listConfiguredModels: async (): Promise<ChatConfiguredModelDescriptorSnapshot[]> =>
          listPiConfiguredModels(),

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

        listSubagents: async (): Promise<ChatSubagentRecordSnapshot[]> => {
          await this.extensionsReady;
          const manager = this.subagents;
          if (!manager) return [];
          return manager.listRecords().map(snapshotSubagentRecord);
        },

        getSubagentResult: async (childRunId: string, consume: boolean = false): Promise<ChatSubagentRecordSnapshot | null> => {
          await this.extensionsReady;
          const manager = this.subagents;
          if (!manager) return null;
          const record = manager.getResult(childRunId, { consume });
          return record ? snapshotSubagentRecord(record) : null;
        },

        cancelSubagent: async (childRunId: string): Promise<boolean> => {
          await this.extensionsReady;
          const manager = this.subagents;
          if (!manager) return false;
          return manager.abort(childRunId);
        },

        /**
         * 4-pack item B (telegraph-bookmark): renderer-driven slash-command
         * dispatch. The chat composer pre-parses input like `/bookmark` into
         * `{ commandId, args }` and invokes the extension-registered command
         * handler living inside this pagelet's CapabilityHost.
         *
         * Failure modes are returned as `{ ok: false, error }` envelopes (not
         * thrown across the RPC boundary) so renderer code stays defensive
         * against extension-author bugs without try/catch noise per call. See
         * the doc comment on `IChatPageletService.invokeCommand` for the
         * envelope contract.
         */
        invokeCommand: async (commandId: string, args?: unknown): Promise<ChatCommandInvocationResult> => {
          await this.extensionsReady;
          const host = this.telegraphHost;
          if (!host) {
            return { ok: false, error: 'extension host not initialised' };
          }
          const command = host.getCommand(commandId);
          if (!command) {
            return { ok: false, error: `command not found: ${commandId}` };
          }
          if (!command.invoke) {
            // CapabilityHost.ts:104 — `invoke` undefined means renderer-side
            // handling. Forward this as an explicit error so the chat layer
            // doesn't silently swallow a misconfigured command.
            return { ok: false, error: `command "${commandId}" has no invoke handler (renderer-side)` };
          }
          try {
            const result = await command.invoke(args);
            return { ok: true, result };
          } catch (err) {
            const error = err instanceof Error ? err.message : String(err);
            return { ok: false, error };
          }
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

  /**
   * D-016 P5: snapshot the runtime contributions registered by activated
   * extensions and adapt them to the harness's `RuntimeRegistration` shape.
   * Returns `[]` if extension activation hasn't completed or failed.
   *
   * The cast on `create` is safe because `RuntimeContribution.create` accepts
   * `unknown` (P3) and the harness always passes a real `AgentRunRequest`.
   */
  private extensionContributedRuntimes(): RuntimeRegistration[] {
    const host = this.telegraphHost;
    if (!host) return [];
    return host.listRuntimes().map((contribution): RuntimeRegistration => ({
      id: contribution.id,
      aliases: contribution.aliases,
      create: contribution.create as RuntimeRegistration['create'],
    }));
  }

  /**
   * 4-pack item C bridge fix: extensions register their tools on the
   * pagelet-lifetime `telegraphHost`, but every chat run constructs a
   * **fresh** CapabilityHost inside AgentHarness and reads tools from
   * *that* one (`AgentHarness.ts:327` calls `capabilities.listToolCapabilities()`
   * on the per-run host). Without an explicit bridge, extension-registered
   * tools are invisible to the runtime adapter, so the model never learns
   * about them and falls back to "I cannot access your todo list" style
   * replies even though `@telegraph/todo` is loaded.
   *
   * The factory returned here is shipped to `createAgentHarness` as one
   * of the `capabilities` entries; it is invoked at run-start, captures
   * the current snapshot of extension tools, and re-registers each one
   * on the per-run host. The execute closure is forwarded verbatim, so
   * tool implementations keep their `this` and any captured state on
   * the extension's `TodoStore`/etc. instances.
   *
   * Snapshot semantics intentionally match `extensionHookBus.snapshot()`:
   * an extension activated after this run started (e.g. via a future
   * hot-reload) will surface on the *next* run, not this one. That keeps
   * tool surface deterministic per run.
   *
   * Only `listToolCapabilities` is bridged because it is the sole
   * per-run host read the harness makes today (verified by grep). If
   * harness gains a `listCommands()` / `listSubagents()` path in the
   * future, mirror this helper for those kinds. Commands and runtimes
   * already have their own bridges (`invokeCommand` RPC,
   * `extensionContributedRuntimes`).
   */
  private extensionContributedToolsCapability(): AgentCapability {
    const host = this.telegraphHost;
    return ({ host: runHost }) => {
      if (!host) return;
      for (const tool of host.listToolCapabilities()) {
        runHost.registerTool(tool);
      }
    };
  }

  /**
   * D-016 P5 + 4-pack P0: discover every extension under the workspace
   * `extensions/` directory and activate them via the command-style
   * ExtensionHost loader. The first-party `@telegraph/subagents` extension
   * still publishes its `SubagentManager` under
   * {@link TELEGRAPH_SUBAGENTS_MANAGER_KEY}; we resolve it once activation
   * settles. Other extensions (pirate / todo / bookmark / completion-notify)
   * are picked up automatically as long as they ship a
   * `telegraph.extension.json` manifest at their root.
   *
   * Activation failures are intentionally swallowed per-extension by
   * ExtensionHost (lifecycle event = `activation_failed`); the pagelet must
   * still serve non-subagent runtimes (pi-ai / pi-embedded) when any
   * individual extension has issues. AgentHarness will surface an
   * "Unknown agent runtime" error if a subagent-bound run is requested
   * without the subagents extension active.
   */
  private async activateExtensions(): Promise<void> {
    // 4-pack item D: wire the extension host's CapabilityHookRegistrar to a
    // worker-owned persistent HookBus instead of the previous noop. Every
    // extension hook registration now lands in this.extensionHookBus and
    // is replayed into each per-run AgentHarness via the bridge below.
    const hooks: CapabilityHookRegistrar = {
      on: (name, handler) => this.extensionHookBus.on(name, handler),
    };
    const telegraphHost = new TelegraphExtensionHostImpl(hooks);
    const extensionHost = new ExtensionHost({ telegraph: telegraphHost, hooks });
    this.telegraphHost = telegraphHost;
    this.extensionHost = extensionHost;

    // 4-pack item D: publish the chat-side notify capability into the
    // extension host's custom registry *before* activating any extensions,
    // so extension factories can resolve it during their own activation.
    // Each call synthesizes a ChatExtensionNotificationStreamEvent and pushes
    // it to streamListeners (renderer side will route it to a toast/banner).
    const notify: ChatNotifyCapability = input => {
      const event: ChatExtensionNotificationStreamEvent = {
        type: 'extension_notification',
        runId: input.runId,
        sessionId: input.sessionId,
        extensionId: input.extensionId,
        level: input.level ?? 'info',
        message: input.message,
        ts: Date.now(),
      };
      this.emitStreamEvent(event);
    };
    telegraphHost.registerCustom(CHAT_NOTIFY_CAPABILITY_KEY, notify);

    try {
      const extensionsDir = resolveExtensionsDirectory();
      await extensionHost.activateFromDirectory(extensionsDir);
      const manager = telegraphHost.getCustom(TELEGRAPH_SUBAGENTS_MANAGER_KEY);
      if (manager) {
        this.subagents = manager as SubagentManager;
      }
    } catch {
      // Directory discovery failure: keep `subagents` undefined; non-subagent
      // flows (pi-ai / pi-embedded) still work and the AgentHarness will
      // reject any attempt to construct the telegraph-subagents runtime.
    }
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
   * stream AgentEvents directly on the chat stream channel.
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
      workDir: this.workspaceRoot,
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
        this.emitStreamEvent(event);
      }

      // D-016 P5: wait for the @telegraph/subagents extension before composing
      // the harness so its runtime contribution (telegraph-subagents) is
      // visible to selectRuntimeId / RuntimeRegistry.
      await this.extensionsReady;

      const agentRequest: AgentRunRequest = {
        runId,
        sessionId,
        messages: this.messagesForRun(req),
        settings,
      };
      const agentHarness = createAgentHarness({
        defaultRuntimeId: 'pi-ai',
        sessionStore: this.sessionStoreForRun(req),
        // 4-pack item D: replay extension-registered hooks into this run's
        // HookBus. Snapshot happens fresh per run so an extension activated
        // mid-session still gets its `afterRun` etc. for the next run.
        hooks: this.extensionHookBus.snapshot(),
        runtimes: [
          { id: 'pi-ai', create: () => new PiAiRuntime() },
          { id: 'pi-embedded', create: () => new PiEmbeddedRuntime() },
          ...this.extensionContributedRuntimes(),
          { id: 'telegraph-orchestrator', aliases: ['orchestrator-core'], create: () => createDemoOrchestratorRuntime() },
        ],
        capabilities: [
          ...createPageletRunCapabilities({
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
                this.emitStreamEvent(event);
              },
            },
            emit: event => {
              void this.persistRunEvent(runId, event);
              this.emitStreamEvent(event);
            },
            prompt: prompt => this.promptForPermission(prompt),
          }),
          // 4-pack item C bridge fix — see extensionContributedToolsCapability
          // doc comment for the why. Appended last because
          // CapabilityHost.registerTool is last-write-wins (Map.set keyed
          // by tool definition name), so extension tools would silently
          // shadow a first-party tool of the same name. That is the
          // intended precedence for the demo (extensions can replace),
          // but if first-party tools should win in the future, move this
          // entry to the front of the array.
          this.extensionContributedToolsCapability(),
        ],
      });

      for await (const ev of agentHarness.run(agentRequest, { signal: abortController.signal })) {
        if (abortController.signal.aborted) break;

        await this.persistRunEvent(runId, ev);
        this.emitStreamEvent(ev);
      }

      if (abortController.signal.aborted) {
        const event = cancelledAgentEvent(runId);
        await this.persistRunEvent(runId, event);
        this.emitStreamEvent(event);
        activeRuns.delete(runId);
        this.resolvePendingPermissionsForRun(runId, denyDecision('Run was cancelled before permission was resolved'));
        return { runId, status: 'cancelled', error: 'Cancelled' };
      }

      activeRuns.delete(runId);
      this.resolvePendingPermissionsForRun(runId, denyDecision('Run finished before permission was resolved'));
      return { runId, status: 'completed' };
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const event = failedAgentEvent(runId, errorMsg);
      await this.persistRunEvent(runId, event);
      this.emitStreamEvent(event);
      activeRuns.delete(runId);
      this.resolvePendingPermissionsForRun(runId, denyDecision('Run failed before permission was resolved'));
      return { runId, status: 'failed', error: errorMsg };
    }
  }

  private async deleteSessionRuns(sessionId: string): Promise<ChatDeleteSessionRunsResult> {
    await this.recoveredRunsReady;
    await this.runEvents.flushAll();

    const runs = await this.runs.listRuns({ sessionId, limit: Number.MAX_SAFE_INTEGER });
    for (const run of runs) {
      const controller = activeRuns.get(run.runId);
      if (controller) {
        controller.abort();
        activeRuns.delete(run.runId);
      }
      this.sourceIntentIds.delete(run.runId);
      this.resolvePendingPermissionsForRun(run.runId, denyDecision('Chat session was deleted'));
    }

    const deletedRunIds = await this.runs.deleteRunsForSession(sessionId);
    try {
      await this.shared.deleteRunProjectionsForSession({ sessionId, pageletId: 'chat' });
    } catch {
      // Shared projections are a cache; the pagelet ledger deletion is authoritative.
    }

    return { sessionId, deletedRunIds };
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
      const runEvents = await this.runs.listRunEvents(record.runId);
      const artifactRefs = remoteArtifactRefs(record.artifactRefs, runEvents);
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
          chat: chatProjectionMetadata(record, runEvents),
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

function chatProjectionMetadata(record: AgentRunRecord, events: AgentRunEventRecord[]): Record<string, unknown> {
  const assistantText = assistantTextFromEvents(events);
  return {
    prompt: record.input?.message ?? record.inputPreview,
    assistantText,
    assistantPreview: compactProjectionText(assistantText),
    provider: record.settings.provider,
    modelId: record.settings.modelId,
    backend: record.settings.backend ?? record.runtimeId,
  };
}

function assistantTextFromEvents(events: AgentRunEventRecord[]): string {
  let text = '';
  for (const record of events) {
    const event = record.event;
    if (event.type === 'assistant_delta') {
      text += event.text;
      continue;
    }
    if (event.type === 'assistant_message' && event.message.role === 'assistant') {
      text += event.message.content;
      continue;
    }
    if (event.type === 'run_completed' && !text.trim()) {
      text = textFromUnknown(event.output);
    }
  }
  return text.trim();
}

function textFromUnknown(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  const reply = record.reply ?? record.text ?? record.message ?? record.output;
  return typeof reply === 'string' ? reply : '';
}

function compactProjectionText(value: string): string {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
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
    authMode: metadataSettings.authMode,
    subscriptionProvider: metadataSettings.subscriptionProvider,
    subscriptionCredentials: metadataSettings.subscriptionCredentials,
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

/**
 * D-016 P5 + 4-pack P0: locate the workspace `extensions/` directory so the
 * ExtensionHost can discover and activate every extension under it. Searches
 * a small set of candidate roots so the worker keeps working under both dev
 * (vite cwd at repo root) and packaged (worker bundle cwd next to the
 * pagelet js) layouts. We probe for the first-party
 * `telegraph-subagents/<EXTENSION_MANIFEST_FILENAME>` to anchor the
 * candidate; that extension is guaranteed to exist (D-016 P5) and lives
 * directly under `extensions/`.
 */
function resolveExtensionsDirectory(): string {
  const candidates = [
    join(process.cwd(), 'extensions'),
    join(process.cwd(), '..', '..', 'extensions'),
    join(process.cwd(), '..', '..', '..', 'extensions'),
  ];
  const found = candidates.find(candidate =>
    existsSync(join(candidate, 'telegraph-subagents', EXTENSION_MANIFEST_FILENAME))
  );
  return found ?? candidates[0]!;
}
