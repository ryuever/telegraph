import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';

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
import type { IAppOrchestrator } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { AppOrchestratorId } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { MAIN_RPC_SERVICE_PATH, MAIN_WINDOW_SERVICE_PATH } from '@/packages/services/pagelet-host/common';
import { MAIN_METRICS_SERVICE_PATH } from '@/packages/services/main-metrics/common';
import type { IMainMetricsService } from '@/packages/services/main-metrics/common';
import { MainMetricsServiceId } from '@/packages/services/main-metrics/common';
import type { IDaemonProcess } from '@/apps/daemon/application/common';
import { DaemonProcessId } from '@/apps/daemon/application/common';
import type { ISharedProcess } from '@/apps/shared/application/common';
import { SharedProcessId } from '@/apps/shared/application/common';
import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { LogServiceId } from '@/packages/services/log/common/LogService';
import type { ILogger } from '@/packages/services/log/common/types';

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
    @inject(LogServiceId)
    private readonly logger: ILogger
  ) {}

  async start(): Promise<void> {
    this.logger.info('[AppApplication] start()');

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

    const rendererIpcChannel = this.mainCpServer.getRendererIpcChannel();

    let mainCallCount = 0;
    serviceHost.registerServiceHandler(MAIN_RPC_SERVICE_PATH, {
      mainPing(msg: string): string {
        mainCallCount++;
        return `pong from main (#${mainCallCount}): ${msg}`;
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
      onSwitchPage: (callback: (pageId: string) => void) => {
        this.windowManager.setSwitchPageCallback(callback);
      },
    });

    await this.monitorApp.start();
    await this.settingApp.start();
    await this.designApp.start();
    await this.chatApp.start();

    this.windowManager.onSettingWindowCreated((win) => {
      this.mainCpServer.registerSettingWindow(win);
      this.appOrchestrator.registerSettingOrchestratorService();
    });

    this.logger.info('[AppApplication] start() done');
  }
}
