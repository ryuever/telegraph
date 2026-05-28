import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import {
  ConnectionState,
  ExponentialBackoffPolicy,
} from '@x-oasis/async-call-rpc/orchestrator';

import type { IWindowManager } from '@/apps/main/application/common';
import { WindowManagerId } from '@/apps/main/application/common';
import type { IMainCpServer } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import { MainCpServerId } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';
import type { IDaemonApplication } from '@/apps/daemon/application/common';
import { DaemonApplicationId } from '@/apps/daemon/application/common';
import type { ISharedApplication } from '@/apps/shared/application/common';
import { SharedApplicationId } from '@/apps/shared/application/common';
import type { IConnectionApplication } from '@/apps/connection/application/common';
import { ConnectionApplicationId } from '@/apps/connection/application/common';
import type { IMonitorApplication } from '@/apps/monitor/application/common';
import { MonitorApplicationId } from '@/apps/monitor/application/common';
import type { ISettingApplication } from '@/apps/setting/application/common';
import { SettingApplicationId } from '@/apps/setting/application/common';
import type { IDesignApplication } from '@/apps/design/application/common';
import { DesignApplicationId } from '@/apps/design/application/common';
import type { IChatApplication } from '@/apps/chat/application/common';
import { ChatApplicationId } from '@/apps/chat/application/common';
import type { ICliGatewayApplication } from '@/apps/cli-gateway/application/common';
import { CliGatewayApplicationId } from '@/apps/cli-gateway/application/common';
import type { IRemoteControlApplication } from '@/apps/remote-control/application/common';
import { RemoteControlApplicationId } from '@/apps/remote-control/application/common';
import type { IAppOrchestrator } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { AppOrchestratorId } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import {
  CHAT_PARTICIPANT_ID,
  CONNECTION_PARTICIPANT_ID,
  DESIGN_PARTICIPANT_ID,
  MAIN_PROCESS_SUPERVISOR_SERVICE_PATH,
  MAIN_RPC_SERVICE_PATH,
  MAIN_WINDOW_SERVICE_PATH,
  MONITOR_PARTICIPANT_ID,
  RENDERER_PARTICIPANT_ID,
} from '@/packages/services/pagelet-host/common';
import type {
  IMainProcessSupervisorService,
  ProcessControlAction,
  ProcessControlRequest,
  ProcessControlResult,
} from '@/packages/services/pagelet-host/common';
import type { MainWindowThemePayload } from '@/packages/services/pagelet-host/common';
import { MAIN_METRICS_SERVICE_PATH } from '@/packages/services/main-metrics/common';
import type { IMainMetricsService } from '@/packages/services/main-metrics/common';
import { MainMetricsServiceId } from '@/packages/services/main-metrics/common';
import type { IDaemonProcess } from '@/apps/daemon/application/common';
import { DAEMON_PARTICIPANT_ID, DaemonProcessId } from '@/apps/daemon/application/common';
import type { ISharedProcess } from '@/apps/shared/application/common';
import { SHARED_PARTICIPANT_ID, SharedProcessId } from '@/apps/shared/application/common';
import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { LogServiceId } from '@/packages/services/log/common/LogService';
import type { ILogger } from '@/packages/services/log/common/types';
import {
  ComputerUseArtifactProtocolId,
  type IComputerUseArtifactProtocol,
} from '@/apps/main/application/electron-main/ComputerUseArtifactProtocol';

export interface IAppApplication {
  start(): Promise<void>;
}

export const AppApplicationId = createId('AppApplication');

@injectable()
export class AppApplication implements IAppApplication {
  constructor(
    @inject(WindowManagerId) private readonly windowManager: IWindowManager,
    @inject(MainCpServerId) private readonly mainCpServer: IMainCpServer,
    @inject(DaemonApplicationId) private readonly daemonApp: IDaemonApplication,
    @inject(SharedApplicationId) private readonly sharedApp: ISharedApplication,
    @inject(ConnectionApplicationId)
    private readonly connectionApp: IConnectionApplication,
    @inject(MonitorApplicationId)
    private readonly monitorApp: IMonitorApplication,
    @inject(SettingApplicationId)
    private readonly settingApp: ISettingApplication,
    @inject(DesignApplicationId)
    private readonly designApp: IDesignApplication,
    @inject(ChatApplicationId)
    private readonly chatApp: IChatApplication,
    @inject(CliGatewayApplicationId)
    private readonly cliGatewayApp: ICliGatewayApplication,
    @inject(RemoteControlApplicationId)
    private readonly remoteControlApp: IRemoteControlApplication,
    @inject(AppOrchestratorId)
    private readonly appOrchestrator: IAppOrchestrator,
    @inject(MainMetricsServiceId)
    private readonly metricsService: IMainMetricsService,
    @inject(DaemonProcessId)
    private readonly daemonProcess: IDaemonProcess,
    @inject(SharedProcessId)
    private readonly sharedProcess: ISharedProcess,
    @inject(PageletProcessId)
    private readonly pageletProcess: IPageletProcess,
    @inject(ComputerUseArtifactProtocolId)
    private readonly computerUseArtifactProtocol: IComputerUseArtifactProtocol,
    @inject(LogServiceId)
    private readonly logger: ILogger
  ) {}

  async start(): Promise<void> {
    this.logger.info('[AppApplication] start()');

    this.computerUseArtifactProtocol.start();

    this.windowManager.openMainWindow();

    this.mainCpServer.start();

    // Declare the setting pagelet's extra orchestrator binding here, in
    // the host's start() flow, instead of inside MainCpServer (which
    // used to hardcode `if (pageletId === 'setting')`). Adding another
    // window-bound pagelet means another attach call here, no framework
    // changes — see IMainCpServer.attachOrchestratorToPagelet docs (H5).
    this.mainCpServer.attachOrchestratorToPagelet(
      'setting',
      this.mainCpServer.getSettingOrchestrator()
    );

    this.windowManager.onSettingWindowCreated((win) => {
      this.mainCpServer.registerSettingWindow(win);
      this.appOrchestrator.registerSettingOrchestratorService();
    });

    const rendererIpcChannel = this.mainCpServer.getRendererIpcChannel();

    let mainCallCount = 0;
    serviceHost.registerServiceHandler(MAIN_RPC_SERVICE_PATH, {
      mainPing(msg: string): string {
        mainCallCount++;
        return `pong from main (#${String(mainCallCount)}): ${msg}`;
      },
      openRun: (runId: string, options?: { pageletId?: string }) => {
        const pageId = 'run-console';
        return {
          runId,
          pageletId: options?.pageletId,
          pageId,
          focused: this.windowManager.switchPage(pageId, {
            runId,
            pageletId: options?.pageletId,
          }),
        };
      },
    });

    // Wire the supervisor inspector aggregator. Done here (the only seam
    // where all three process families are visible) rather than inside
    // MainMetricsService because packages/services cannot import apps/*.
    this.metricsService.setSupervisorProvider(() =>
      [
        this.daemonProcess.getInspectorSnapshot(),
        this.sharedProcess.getInspectorSnapshot(),
        ...this.pageletProcess.getInspectorSnapshots(),
      ].filter((s): s is NonNullable<typeof s> => s !== null)
    );

    serviceHost.registerServiceHandler(MAIN_METRICS_SERVICE_PATH, {
      getAppMetrics: () => this.metricsService.getAppMetrics(),
      getMainPid: () => this.metricsService.getMainPid(),
      getUtilityPidNames: () => this.metricsService.getUtilityPidNames(),
      getSupervisorSnapshots: () =>
        this.metricsService.getSupervisorSnapshots(),
      onSupervisorSnapshotsChanged: (
        callback: (snapshots: ReturnType<IMainMetricsService['getSupervisorSnapshots']>) => void
      ) => this.metricsService.onSupervisorSnapshotsChanged(callback),
    });

    const processSupervisorService: IMainProcessSupervisorService = {
      controlParticipant: (request) =>
        this.controlParticipantProcess(request.participantId, request.action),
    };
    serviceHost.registerServiceHandler(MAIN_PROCESS_SUPERVISOR_SERVICE_PATH, {
      controlParticipant: (request: ProcessControlRequest) =>
        processSupervisorService.controlParticipant(request),
    });

    // Bridge supervisor state transitions → MainMetricsService event
    // bus so monitor renderer sees transient states (`restarting`,
    // `failed`, `starting`) even when the transition is shorter than
    // the baseline poll interval. Each process kind is independent;
    // any of them firing causes a full snapshot push (cheap — ≤ a few
    // dozen rows).
    this.daemonProcess.subscribeStateChange(() => {
      this.metricsService.triggerSupervisorSnapshotsChanged();
    });
    this.sharedProcess.subscribeStateChange(() => {
      this.metricsService.triggerSupervisorSnapshotsChanged();
    });
    this.pageletProcess.subscribeStateChange(() => {
      this.metricsService.triggerSupervisorSnapshotsChanged();
    });

    await Promise.all([this.sharedApp.start(), this.daemonApp.start()]);

    await this.connectionApp.start();

    rendererIpcChannel.serviceHost?.registerServiceHandler(MAIN_WINDOW_SERVICE_PATH, {
      openSettingWindow: () => {
        this.windowManager.openSettingWindow();
      },
      applyWindowTheme: (theme: MainWindowThemePayload) => {
        this.windowManager.applyWindowTheme(theme);
      },
      onSwitchPage: (callback: (pageId: string) => void) => {
        this.windowManager.setSwitchPageCallback(callback);
      },
    });

    await this.monitorApp.start();
    await this.settingApp.start();
    await this.cliGatewayApp.start();
    await this.remoteControlApp.start();
    await this.designApp.start();
    await this.chatApp.start();

    // Cmd+R recreates the renderer/preload context without destroying the
    // BrowserWindow. The orchestrator's control-plane IPC can survive that
    // transition, so READY direct MessagePorts may still point at the old
    // preload. Close those records as soon as a reload starts; reconnect
    // only after the new preload has loaded.
    const reloadParticipantIds = [
      CONNECTION_PARTICIPANT_ID,
      MONITOR_PARTICIPANT_ID,
      DESIGN_PARTICIPANT_ID,
      CHAT_PARTICIPANT_ID,
    ];
    const reloadConfig = {
      reconnectPolicy: new ExponentialBackoffPolicy({
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
        multiplier: 2,
        jitterFactor: 0.3,
        maxRetries: 10,
        maxElapsedMs: 5 * 60_000,
      }),
    };
    const reloadOptions = {
      activateTimeoutMs: 30_000,
      retryOnInitialFailure: true,
    };
    let reloadEpoch = 0;
    const pendingReloadReconnects = new Set<string>();

    const markRendererReloadStarted = (source: string): void => {
      if (pendingReloadReconnects.size > 0) return;

      const orchestrator = this.mainCpServer.getOrchestrator();
      const activeParticipantIds = reloadParticipantIds.filter((toId) => {
        const info = orchestrator.getConnectionInfo(RENDERER_PARTICIPANT_ID, toId);
        return (
          info !== undefined &&
          info.state !== ConnectionState.CLOSED &&
          info.state !== ConnectionState.IDLE
        );
      });
      if (activeParticipantIds.length === 0) return;

      reloadEpoch++;
      this.logger.info(
        `[AppApplication] renderer reload started (${source}) — closing stale direct channels`
      );

      for (const toId of activeParticipantIds) {
        pendingReloadReconnects.add(toId);
        const info = orchestrator.getConnectionInfo(RENDERER_PARTICIPANT_ID, toId);
        if (!info) continue;
        void orchestrator.disconnect(info.connectionId).catch((err: unknown) => {
          this.logger.warn(
            `[AppApplication] renderer reload disconnect failed for ${toId}`,
            err
          );
        });
      }
    };

    const reconnectRendererAfterReload = (): void => {
      if (pendingReloadReconnects.size === 0) return;

      const orchestrator = this.mainCpServer.getOrchestrator();
      const epoch = reloadEpoch;
      const reconnectIds = [...pendingReloadReconnects];
      pendingReloadReconnects.clear();

      this.logger.info(
        '[AppApplication] renderer reload finished — reconnecting direct channels'
      );

      for (const toId of reconnectIds) {
        void orchestrator
          .connect(
            RENDERER_PARTICIPANT_ID,
            toId,
            reloadConfig,
            reloadOptions
          )
          .catch((err: unknown) => {
            if (epoch !== reloadEpoch) return;
            this.logger.warn(
              `[AppApplication] renderer reload reconnect failed for ${toId}`,
              err
            );
          });
      }
    };

    const win = this.windowManager.getMainWindow();
    if (win) {
      win.webContents.on('before-input-event', (_event, input) => {
        if (
          input.type === 'keyDown' &&
          input.key.toLowerCase() === 'r' &&
          (input.meta || input.control)
        ) {
          markRendererReloadStarted('keyboard');
        }
      });
      win.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
        if (isMainFrame) {
          markRendererReloadStarted('navigation');
        }
      });
      win.webContents.on('did-finish-load', () => {
        reconnectRendererAfterReload();
      });
    }

    this.logger.info('[AppApplication] start() done');
  }

  private async controlParticipantProcess(
    participantId: string,
    action: ProcessControlAction
  ): Promise<ProcessControlResult> {
    try {
      if (participantId === DAEMON_PARTICIPANT_ID) {
        await this.controlSingletonProcess(this.daemonProcess, action, 'daemon');
      } else if (participantId === SHARED_PARTICIPANT_ID) {
        await this.controlSingletonProcess(this.sharedProcess, action, 'shared');
      } else {
        await this.controlPageletProcess(participantId, action);
      }

      this.metricsService.triggerSupervisorSnapshotsChanged();
      const snapshot = this.metricsService
        .getSupervisorSnapshots()
        .find((s) => s.participantId === participantId);
      return {
        participantId,
        action,
        ok: true,
        state: snapshot?.state,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[AppApplication] process control failed (${action} ${participantId}): ${message}`
      );
      return {
        participantId,
        action,
        ok: false,
        error: message,
      };
    }
  }

  private async controlSingletonProcess(
    process: Pick<IDaemonProcess, 'stop' | 'resume' | 'restart'>,
    action: ProcessControlAction,
    label: string
  ): Promise<void> {
    if (action === 'kill') {
      process.stop();
      return;
    }
    if (action === 'resume') {
      await process.resume();
      return;
    }
    await process.restart(`monitor:${label}`);
  }

  private async controlPageletProcess(
    participantId: string,
    action: ProcessControlAction
  ): Promise<void> {
    if (action === 'kill') {
      this.pageletProcess.stop(participantId);
      return;
    }
    if (action === 'resume') {
      await this.pageletProcess.resume(participantId);
      return;
    }
    await this.pageletProcess.restart(participantId, 'monitor');
  }
}
