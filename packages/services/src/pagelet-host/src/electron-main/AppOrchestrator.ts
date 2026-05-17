import { createId, inject, injectable } from '@x-oasis/di';
import { RPCServiceHost } from '@x-oasis/async-call-rpc';
import {
  ExponentialBackoffPolicy,
} from '@x-oasis/async-call-rpc/orchestrator';
import type {
  ConnectionInfo,
  ConnectionStats,
  OrchestratorEvent,
  ConnectionConfig,
  ConnectOptions,
} from '@x-oasis/async-call-rpc/orchestrator';
import type {
  ElectronConnectionOrchestrator,
  IPCMainChannel,
} from '@x-oasis/async-call-rpc-electron';

import type {
  IMainCpServer,
} from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import {
  MainCpServerId,
} from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import type {
  IPageletProcess,
} from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import {
  PageletProcessId,
} from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import {
  ORCHESTRATOR_SERVICE_PATH,
  RENDERER_PARTICIPANT_ID,
  CONNECTION_PARTICIPANT_ID,
  SETTING_PARTICIPANT_ID,
  DESIGN_PARTICIPANT_ID,
  CHAT_PARTICIPANT_ID,
} from '@/packages/services/pagelet-host/common';
import { LogServiceId } from '@/packages/services/log/common/LogService';
import type { ILogger } from '@/packages/services/log/common/types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConnectResult {
  connectionId?: string;
  fromId?: string;
  toId?: string;
  state?: string;
  lastStateChangedAt?: number;
  error?: string;
}

export interface StatsView {
  totalRpcCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgLatencyMs: number;
  totalReconnects: number;
}

export interface StatusView {
  connectionId: string;
  fromId: string;
  toId: string;
  state: string;
  lastStateChangedAt: number;
  error?: string;
  isReady: boolean;
  stats: StatsView | null;
}

export interface IOrchestratorService {
  connect(): Promise<ConnectResult>;
  disconnect(): Promise<void>;
  simulateLost(): void;
  getStatus(): Promise<StatusView | null>;
  killUtility(): void;
  onStateChange(callback: (event: OrchestratorEvent) => void): void;
  onReady(callback: (event: OrchestratorEvent) => void): void;
  onDisconnected(callback: (event: OrchestratorEvent) => void): void;
  onReconnecting(callback: (event: OrchestratorEvent) => void): void;
  onReconnected(callback: (event: OrchestratorEvent) => void): void;
  onReconnectFailed(callback: (event: OrchestratorEvent) => void): void;
  onClosed(callback: (event: OrchestratorEvent) => void): void;
}

export interface IAppOrchestrator {
  registerOrchestratorService(): void;
  registerSettingOrchestratorService(): void;
  connectMonitor(): Promise<void>;
  connectDesign(): Promise<void>;
  connectSetting(): Promise<void>;
  connectChat(): Promise<void>;
}

export const AppOrchestratorId = createId('AppOrchestrator');

// ─── Connection defaults ─────────────────────────────────────────────────────

/**
 * Long-lived connection config shared by every direct connection the
 * AppOrchestrator establishes. Exponential backoff covers transient utility
 * crashes (caps at 30s after ~5 attempts; gives up after 5min).
 *
 * 与 D-007 "类别 A" 配套：以前 connect() 不传 reconnectPolicy → 重连不会发生。
 */
function defaultConnectionConfig(): ConnectionConfig {
  return {
    reconnectPolicy: new ExponentialBackoffPolicy({
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      multiplier: 2,
      jitterFactor: 0.3,
      maxRetries: 10,
      maxElapsedMs: 5 * 60_000,
    }),
  };
}

/**
 * First-attempt activation options.
 * - 30s 超时容忍冷启动
 * - retryOnInitialFailure: 首连失败也走重连策略而不是直接 reject
 *   (D-006 §2 Gap 2 + retryOnInitialFailure)
 */
function defaultConnectOptions(): ConnectOptions {
  return {
    activateTimeoutMs: 30_000,
    retryOnInitialFailure: true,
  };
}

// ─── Implementation ──────────────────────────────────────────────────────────

interface OrchestratorScopeContext {
  orchestrator: ElectronConnectionOrchestrator;
  channel: IPCMainChannel;
  serviceHost: RPCServiceHost;
  utilityParticipantId: string;
  serviceLabel: string;
}

@injectable()
export class AppOrchestrator implements IAppOrchestrator {
  private pageServiceHost = new RPCServiceHost();
  private settingPageServiceHost = new RPCServiceHost();

  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer,
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess,
    @inject(LogServiceId) private readonly logger: ILogger
  ) {}

  registerOrchestratorService(): void {
    const channel = this.cpServer.getRendererIpcChannel();
    this.registerScopedOrchestratorService({
      orchestrator: this.cpServer.getOrchestrator(),
      channel,
      serviceHost: this.pageServiceHost,
      utilityParticipantId: CONNECTION_PARTICIPANT_ID,
      serviceLabel: 'main',
    });
  }

  registerSettingOrchestratorService(): void {
    const channel = this.cpServer.getSettingIpcChannel();
    if (!channel) {
      this.logger.warn('[AppOrchestrator] setting IPC channel not ready yet');
      return;
    }
    this.registerScopedOrchestratorService({
      orchestrator: this.cpServer.getSettingOrchestrator(),
      channel,
      serviceHost: this.settingPageServiceHost,
      utilityParticipantId: SETTING_PARTICIPANT_ID,
      serviceLabel: 'setting',
    });
    this.logger.info('[AppOrchestrator] setting orchestrator service registered');
  }

  /**
   * Internal: register the orchestrator control RPC service against the given
   * scope (main vs setting). The two scopes used to be ~210 lines of duplicate
   * registration code; now they share this single method.
   *
   * 使用 createEventForwarder 一次拿全 7 个事件，删掉手写转发样板。
   * （x-oasis BaseConnectionOrchestrator.ts:384）
   */
  private registerScopedOrchestratorService(ctx: OrchestratorScopeContext): void {
    const { orchestrator, channel, serviceHost: scopeServiceHost, utilityParticipantId, serviceLabel } = ctx;

    channel.setServiceHost(scopeServiceHost);

    // Build remote-callback subscription helpers up-front so the
    // event handlers in `handlers` are tiny and uniform.
    type RemoteCallback = (event: OrchestratorEvent) => void;
    const remoteCallbacks = new Map<string, RemoteCallback[]>();

    const subscribe = (eventType: string) => (cb: RemoteCallback) => {
      let list = remoteCallbacks.get(eventType);
      if (!list) {
        list = [];
        remoteCallbacks.set(eventType, list);
      }
      list.push(cb);
    };

    // Single forwarder for all 7 event types; dispatches to the per-event
    // remote-callback lists. This replaces the hand-written 7 × per-orchestrator
    // (= 14 lines) of orchestrator.onXxx(cb => remoteCallback(cb)) plumbing.
    orchestrator.createEventForwarder((event) => {
      const list = remoteCallbacks.get(event.type);
      if (!list) return;
      for (const cb of list) {
        try {
          cb(event);
        } catch (err) {
          this.logger.warn(
            `[AppOrchestrator:${serviceLabel}] remote ${event.type} callback threw`,
            err
          );
        }
      }
    });

    const handlers: IOrchestratorService = {
      connect: async (): Promise<ConnectResult> => {
        try {
          const info = await orchestrator.connect(
            RENDERER_PARTICIPANT_ID,
            utilityParticipantId,
            defaultConnectionConfig(),
            defaultConnectOptions()
          );
          return formatConnectResult(info);
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
      disconnect: async (): Promise<void> => {
        const info = orchestrator.getConnectionInfo(
          RENDERER_PARTICIPANT_ID,
          utilityParticipantId
        );
        if (info) {
          await orchestrator.disconnect(info.connectionId);
        }
      },
      simulateLost: (): void => {
        orchestrator.handleParticipantLost(
          utilityParticipantId,
          'simulated process exit'
        );
      },
      getStatus: (): Promise<StatusView | null> => {
        const info = orchestrator.getConnectionInfo(
          RENDERER_PARTICIPANT_ID,
          utilityParticipantId
        );
        if (!info) return Promise.resolve(null);
        const stats = orchestrator.getConnectionStats(info.connectionId);
        return Promise.resolve(formatStatusView(info, stats));
      },
      killUtility: (): void => {
        this.pageletProcess.kill(utilityParticipantId);
      },
      onStateChange: subscribe('stateChange'),
      onReady: subscribe('ready'),
      onDisconnected: subscribe('disconnected'),
      onReconnecting: subscribe('reconnecting'),
      onReconnected: subscribe('reconnected'),
      onReconnectFailed: subscribe('reconnectFailed'),
      onClosed: subscribe('closed'),
    };

    scopeServiceHost.registerService(ORCHESTRATOR_SERVICE_PATH, {
      channel,
      serviceHost: scopeServiceHost,
      handlers: handlers as unknown as Record<string, (...args: unknown[]) => unknown>,
    });
  }

  async connectMonitor(): Promise<void> {
    const orchestrator = this.cpServer.getOrchestrator();
    await orchestrator.connect(
      RENDERER_PARTICIPANT_ID,
      'monitor',
      defaultConnectionConfig(),
      defaultConnectOptions()
    );
    this.logger.info('[AppOrchestrator] monitor direct connection established');
  }

  async connectSetting(): Promise<void> {
    const settingOrchestrator = this.cpServer.getSettingOrchestrator();
    await settingOrchestrator.connect(
      RENDERER_PARTICIPANT_ID,
      SETTING_PARTICIPANT_ID,
      defaultConnectionConfig(),
      defaultConnectOptions()
    );
    this.logger.info('[AppOrchestrator] setting direct connection established');
  }

  async connectDesign(): Promise<void> {
    const orchestrator = this.cpServer.getOrchestrator();
    await orchestrator.connect(
      RENDERER_PARTICIPANT_ID,
      DESIGN_PARTICIPANT_ID,
      defaultConnectionConfig(),
      defaultConnectOptions()
    );
    this.logger.info('[AppOrchestrator] design direct connection established');
  }

  async connectChat(): Promise<void> {
    const orchestrator = this.cpServer.getOrchestrator();
    await orchestrator.connect(
      RENDERER_PARTICIPANT_ID,
      CHAT_PARTICIPANT_ID,
      defaultConnectionConfig(),
      defaultConnectOptions()
    );
    this.logger.info('[AppOrchestrator] chat direct connection established');
  }
}

// ─── Pure formatters ─────────────────────────────────────────────────────────

function formatConnectResult(info: ConnectionInfo): ConnectResult {
  return {
    connectionId: info.connectionId,
    fromId: info.fromId,
    toId: info.toId,
    state: info.state,
    lastStateChangedAt: info.lastStateChangedAt,
    error: info.error?.message,
  };
}

function formatStatusView(
  info: ConnectionInfo,
  stats: ConnectionStats | undefined
): StatusView {
  return {
    connectionId: info.connectionId,
    fromId: info.fromId,
    toId: info.toId,
    state: info.state,
    lastStateChangedAt: info.lastStateChangedAt,
    error: info.error?.message,
    isReady: info.isReady,
    stats: stats
      ? {
          totalRpcCalls: stats.totalRpcCalls,
          successfulCalls: stats.successfulCalls,
          failedCalls: stats.failedCalls,
          avgLatencyMs: stats.avgLatencyMs,
          totalReconnects: stats.totalReconnects,
        }
      : null,
  };
}
