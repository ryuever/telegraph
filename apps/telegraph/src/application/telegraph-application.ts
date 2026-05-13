// Phase 4 — TelegraphApplication: thin entrypoint resolved by main.ts via DI.
//
// Boot order (sequence matters):
//   1. MainCpServer.start() — must run BEFORE any participant registers, so
//      the IPCMainChannel is listening when the preload-side
//      IPCRendererChannel sends its first message.
//   2. SharedProcess.spawn() & DaemonProcess.spawn() — spawn the utility processes
//      and register them as participants. These are global singletons that back
//      pagelet processes; done before opening the renderer.
//   3. DesignPageletProcess.spawn() — fork the design utility and register
//      `pagelet:design` as a participant. Done BEFORE opening the renderer
//      so the renderer's first `getTopology()` call already sees all
//      participants (avoids a race / empty initial render).
//   4. WindowManager.openMainWindow() — opens the BrowserWindow, which loads
//      the preload (creates window.telegraph.ipc) and then index.tsx.
//
// `start()` is async because spawn() operations are async (utility cold start).
import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';
import type { IWindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager';
import { WindowManagerId } from '@telegraph/services/window-manager/electron-main/WindowManager';
import type { IMainCpServer } from '@telegraph/services/connection-orchestrator/electron-main/MainCpServer';
import { MainCpServerId } from '@telegraph/services/connection-orchestrator/electron-main/MainCpServer';
import type { IDesignPageletProcess } from '@telegraph/services/connection-orchestrator/electron-main/DesignPageletProcess';
import { DesignPageletProcessId } from '@telegraph/services/connection-orchestrator/electron-main/DesignPageletProcess';
import type { IMonitorPageletProcess } from '@telegraph/services/connection-orchestrator/electron-main/MonitorPageletProcess';
import { MonitorPageletProcessId } from '@telegraph/services/connection-orchestrator/electron-main/MonitorPageletProcess';
import type { ISharedProcess } from '@telegraph/services/connection-orchestrator/electron-main/SharedProcess';
import { SharedProcessId } from '@telegraph/services/connection-orchestrator/electron-main/SharedProcess';
import type { IDaemonProcess } from '@telegraph/services/connection-orchestrator/electron-main/DaemonProcess';
import { DaemonProcessId } from '@telegraph/services/connection-orchestrator/electron-main/DaemonProcess';

export interface ITelegraphApplication {
  start(): Promise<void>;
}

@injectable()
export class TelegraphApplication implements ITelegraphApplication {
  constructor(
    @inject(LogServiceId) private readonly log: ILogService,
    @inject(WindowManagerId) private readonly windowManager: IWindowManager,
    @inject(MainCpServerId) private readonly mainCpServer: IMainCpServer,
    @inject(SharedProcessId) private readonly sharedProcess: ISharedProcess,
    @inject(DaemonProcessId) private readonly daemonProcess: IDaemonProcess,
    @inject(DesignPageletProcessId) private readonly designPagelet: IDesignPageletProcess,
    @inject(MonitorPageletProcessId) private readonly monitorPagelet: IMonitorPageletProcess,
  ) {}

  async start(): Promise<void> {
    this.log.info('TelegraphApplication.start()');
    
    // Step 1: Stand up the cp channel + inspector service first.
    this.mainCpServer.start();
    
    // Step 2: Spawn shared and daemon utilities (global singletons).
    await Promise.all([
      this.sharedProcess.spawn(),
      this.daemonProcess.spawn(),
    ]);
    
    // Step 3: Spawn the design and monitor pagelet utilities.
    await Promise.all([
      this.designPagelet.spawn(),
      this.monitorPagelet.spawn(),
    ]);
    
    // Step 4: Open the renderer.
    this.windowManager.openMainWindow();
    
    // Step 5: Set up application menu + dock menu (macOS).
    this.windowManager.setupApplicationMenu();
    this.windowManager.setupDockMenu();
    
    this.log.info('TelegraphApplication.start() done');
  }
}

export const TelegraphApplicationId = createId('TelegraphApplication');
