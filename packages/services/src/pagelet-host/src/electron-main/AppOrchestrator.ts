import { createId, inject, injectable } from '@x-oasis/di';
import { RPCServiceHost } from '@x-oasis/async-call-rpc';

import type {
  IMainCpServer,
} from '@telegraph/main/application/electron-main/MainCpServer';
import {
  MainCpServerId,
} from '@telegraph/main/application/electron-main/MainCpServer';
import type {
  IPageletProcess,
} from '@telegraph/pagelet-host/electron-main/PageletProcess';
import {
  PageletProcessId,
} from '@telegraph/pagelet-host/electron-main/PageletProcess';
import { ORCHESTRATOR_SERVICE_PATH } from '@telegraph/main/application/common/types';
import {
  RENDERER_PARTICIPANT_ID,
  CONNECTION_PARTICIPANT_ID,
  SETTING_PARTICIPANT_ID,
  DESIGN_PARTICIPANT_ID,
} from '@telegraph/pagelet-host/common';

export interface IOrchestratorService {
  connect(): Promise<any>;
  disconnect(): Promise<void>;
  simulateLost(): void;
  getStatus(): Promise<any>;
  killUtility(): void;
  onStateChange(callback: (event: any) => void): void;
  onReady(callback: (event: any) => void): void;
  onDisconnected(callback: (event: any) => void): void;
  onReconnecting(callback: (event: any) => void): void;
  onReconnected(callback: (event: any) => void): void;
  onReconnectFailed(callback: (event: any) => void): void;
  onClosed(callback: (event: any) => void): void;
}

export interface IAppOrchestrator {
  registerOrchestratorService(): void;
  registerSettingOrchestratorService(): void;
  connectMonitor(): Promise<void>;
  connectDesign(): Promise<void>;
}

export const AppOrchestratorId = createId('AppOrchestrator');

@injectable()
export class AppOrchestrator implements IAppOrchestrator {
  private pageServiceHost = new RPCServiceHost();
  private settingPageServiceHost = new RPCServiceHost();

  constructor(
    @inject(MainCpServerId) private readonly cpServer: IMainCpServer,
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess
  ) {}

  registerOrchestratorService(): void {
    const rendererIpcChannel = this.cpServer.getRendererIpcChannel();
    rendererIpcChannel.setServiceHost(this.pageServiceHost);

    const orchestrator = this.cpServer.getOrchestrator();

    this.pageServiceHost.registerService(ORCHESTRATOR_SERVICE_PATH, {
      channel: rendererIpcChannel,
      serviceHost: this.pageServiceHost,
      handlers: {
        async connect(): Promise<any> {
          try {
            const info = await orchestrator.connect(
              RENDERER_PARTICIPANT_ID,
              CONNECTION_PARTICIPANT_ID
            );
            return {
              connectionId: info.connectionId,
              fromId: info.fromId,
              toId: info.toId,
              state: info.state,
              lastStateChangedAt: info.lastStateChangedAt,
              error: info.error?.message,
            };
          } catch (err: any) {
            return { error: err.message };
          }
        },
        async disconnect(): Promise<void> {
          const info = orchestrator.getConnectionInfo(
            RENDERER_PARTICIPANT_ID,
            CONNECTION_PARTICIPANT_ID
          );
          if (info) {
            await orchestrator.disconnect(info.connectionId);
          }
        },
        simulateLost(): void {
          orchestrator.handleParticipantLost(
            CONNECTION_PARTICIPANT_ID,
            'simulated process exit'
          );
        },
        async getStatus(): Promise<any> {
          const info = orchestrator.getConnectionInfo(
            RENDERER_PARTICIPANT_ID,
            CONNECTION_PARTICIPANT_ID
          );
          if (!info) return null;
          const stats = orchestrator.getConnectionStats(info.connectionId);
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
        },
        killUtility: (): void => {
          this.pageletProcess.kill(CONNECTION_PARTICIPANT_ID);
        },
        onStateChange(remoteCallback: (event: any) => void) {
          orchestrator.onStateChange((event: any) => remoteCallback(event));
        },
        onReady(remoteCallback: (event: any) => void) {
          orchestrator.onReady((event: any) => remoteCallback(event));
        },
        onDisconnected(remoteCallback: (event: any) => void) {
          orchestrator.onDisconnected((event: any) => remoteCallback(event));
        },
        onReconnecting(remoteCallback: (event: any) => void) {
          orchestrator.onReconnecting((event: any) => remoteCallback(event));
        },
        onReconnected(remoteCallback: (event: any) => void) {
          orchestrator.onReconnected((event: any) => remoteCallback(event));
        },
        onReconnectFailed(remoteCallback: (event: any) => void) {
          orchestrator.onReconnectFailed((event: any) => remoteCallback(event));
        },
        onClosed(remoteCallback: (event: any) => void) {
          orchestrator.onClosed((event: any) => remoteCallback(event));
        },
      },
    });
  }

  async connectMonitor(): Promise<void> {
    const orchestrator = this.cpServer.getOrchestrator();
    await orchestrator.connect(RENDERER_PARTICIPANT_ID, 'monitor');
    console.log('[AppOrchestrator] monitor direct connection established');
  }

  registerSettingOrchestratorService(): void {
    const settingIpcChannel = this.cpServer.getSettingIpcChannel();
    if (!settingIpcChannel) {
      console.warn('[AppOrchestrator] setting IPC channel not ready yet');
      return;
    }

    settingIpcChannel.setServiceHost(this.settingPageServiceHost);

    const settingOrchestrator = this.cpServer.getSettingOrchestrator();

    this.settingPageServiceHost.registerService('orchestrator', {
      channel: settingIpcChannel,
      serviceHost: this.settingPageServiceHost,
      handlers: {
        async connect(): Promise<any> {
          try {
            const info = await settingOrchestrator.connect(
              RENDERER_PARTICIPANT_ID,
              SETTING_PARTICIPANT_ID
            );
            return {
              connectionId: info.connectionId,
              fromId: info.fromId,
              toId: info.toId,
              state: info.state,
              lastStateChangedAt: info.lastStateChangedAt,
              error: info.error?.message,
            };
          } catch (err: any) {
            return { error: err.message };
          }
        },
        async disconnect(): Promise<void> {
          const info = settingOrchestrator.getConnectionInfo(
            RENDERER_PARTICIPANT_ID,
            SETTING_PARTICIPANT_ID
          );
          if (info) {
            await settingOrchestrator.disconnect(info.connectionId);
          }
        },
        simulateLost(): void {
          settingOrchestrator.handleParticipantLost(
            SETTING_PARTICIPANT_ID,
            'simulated process exit'
          );
        },
        async getStatus(): Promise<any> {
          const info = settingOrchestrator.getConnectionInfo(
            RENDERER_PARTICIPANT_ID,
            SETTING_PARTICIPANT_ID
          );
          if (!info) return null;
          const stats = settingOrchestrator.getConnectionStats(
            info.connectionId
          );
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
        },
        killUtility: (): void => {
          this.pageletProcess.kill(SETTING_PARTICIPANT_ID);
        },
        onStateChange(remoteCallback: (event: any) => void) {
          settingOrchestrator.onStateChange((event: any) => remoteCallback(event));
        },
        onReady(remoteCallback: (event: any) => void) {
          settingOrchestrator.onReady((event: any) => remoteCallback(event));
        },
        onDisconnected(remoteCallback: (event: any) => void) {
          settingOrchestrator.onDisconnected((event: any) => remoteCallback(event));
        },
        onReconnecting(remoteCallback: (event: any) => void) {
          settingOrchestrator.onReconnecting((event: any) => remoteCallback(event));
        },
        onReconnected(remoteCallback: (event: any) => void) {
          settingOrchestrator.onReconnected((event: any) => remoteCallback(event));
        },
        onReconnectFailed(remoteCallback: (event: any) => void) {
          settingOrchestrator.onReconnectFailed((event: any) =>
            remoteCallback(event)
          );
        },
        onClosed(remoteCallback: (event: any) => void) {
          settingOrchestrator.onClosed((event: any) => remoteCallback(event));
        },
      },
    });

    console.log('[AppOrchestrator] setting orchestrator service registered');
  }

  async connectSetting(): Promise<void> {
    const settingOrchestrator = this.cpServer.getSettingOrchestrator();
    await settingOrchestrator.connect(
      RENDERER_PARTICIPANT_ID,
      SETTING_PARTICIPANT_ID
    );
    console.log('[AppOrchestrator] setting direct connection established');
  }

  async connectDesign(): Promise<void> {
    const orchestrator = this.cpServer.getOrchestrator();
    await orchestrator.connect(RENDERER_PARTICIPANT_ID, DESIGN_PARTICIPANT_ID);
    console.log('[AppOrchestrator] design direct connection established');
  }
}
