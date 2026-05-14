import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';

import type { IWindowManager } from '@/apps/main/application/electron-main/WindowManager';
import { WindowManagerId } from '@/apps/main/application/electron-main/WindowManager';
import type { IMainCpServer } from '@/apps/main/application/electron-main/MainCpServer';
import { MainCpServerId } from '@/apps/main/application/electron-main/MainCpServer';
import type { IDaemonApplication } from '@/apps/daemon/application/node/DaemonApplication';
import { DaemonApplicationId } from '@/apps/daemon/application/node/DaemonApplication';
import type { ISharedApplication } from '@/apps/shared/application/node/SharedApplication';
import { SharedApplicationId } from '@/apps/shared/application/node/SharedApplication';
import type { IConnectionApplication } from '@/apps/connection/application/node/ConnectionApplication';
import { ConnectionApplicationId } from '@/apps/connection/application/node/ConnectionApplication';
import type { IMonitorApplication } from '@/apps/monitor/application/electron-main/MonitorApplication';
import { MonitorApplicationId } from '@/apps/monitor/application/electron-main/MonitorApplication';
import type { ISettingApplication } from '@/apps/setting/application/electron-main/SettingApplication';
import { SettingApplicationId } from '@/apps/setting/application/electron-main/SettingApplication';
import type { IDesignApplication } from '@/apps/design/application/electron-main/DesignApplication';
import { DesignApplicationId } from '@/apps/design/application/electron-main/DesignApplication';
import type { IChatApplication } from '@/apps/chat/application/electron-main/ChatApplication';
import { ChatApplicationId } from '@/apps/chat/application/electron-main/ChatApplication';
import type { IAppOrchestrator } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { AppOrchestratorId } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { MAIN_RPC_SERVICE_PATH, MAIN_WINDOW_SERVICE_PATH } from '@/packages/services/pagelet-host/common';
import { MAIN_METRICS_SERVICE_PATH } from '@/packages/services/main-metrics/common';
import type { IMainMetricsService } from '@/packages/services/main-metrics/common';
import { MainMetricsServiceId } from '@/packages/services/main-metrics/common';
import type { IDaemonProcess } from '@/apps/daemon/application/electron-main/DaemonProcess';
import { DaemonProcessId } from '@/apps/daemon/application/electron-main/DaemonProcess';
import type { ISharedProcess } from '@/apps/shared/application/electron-main/SharedProcess';
import { SharedProcessId } from '@/apps/shared/application/electron-main/SharedProcess';
import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess';

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
    private readonly pageletProcess: IPageletProcess
  ) {}

  async start(): Promise<void> {
    console.log('[AppApplication] start()');

    this.windowManager.openMainWindow();

    this.mainCpServer.start();

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
      ].filter(
        (s): s is NonNullable<typeof s> => s !== null
      )
    );

    serviceHost.registerServiceHandler(MAIN_METRICS_SERVICE_PATH, {
      getAppMetrics: () => this.metricsService.getAppMetrics(),
      getMainPid: () => this.metricsService.getMainPid(),
      getUtilityPidNames: () => this.metricsService.getUtilityPidNames(),
      getSupervisorSnapshots: () =>
        this.metricsService.getSupervisorSnapshots(),
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

    console.log('[AppApplication] start() done');
  }
}
