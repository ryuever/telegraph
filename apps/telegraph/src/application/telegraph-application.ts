// Phase 3 — TelegraphApplication: thin entrypoint resolved by main.ts via DI.
//
// Boot order (sequence matters):
//   1. MainCpServer.start() — must run BEFORE any participant registers, so
//      the IPCMainChannel is listening when the preload-side
//      IPCRendererChannel sends its first message.
//   2. DesignPageletProcess.spawn() — fork the design utility and register
//      `pagelet:design` as a participant. Done BEFORE opening the renderer
//      so the renderer's first `getTopology()` call already sees both
//      participants (avoids a Phase 4 race / empty initial render).
//   3. WindowManager.openMainWindow() — opens the BrowserWindow, which loads
//      the preload (creates window.telegraph.ipc) and then index.tsx.
//
// `start()` is async because spawn() is async (utility cold start).
import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';
import type { IWindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager';
import { WindowManagerId } from '@telegraph/services/window-manager/electron-main/WindowManager';
import type { IMainCpServer } from '@telegraph/services/connection-orchestrator/electron-main/MainCpServer';
import { MainCpServerId } from '@telegraph/services/connection-orchestrator/electron-main/MainCpServer';
import type { IDesignPageletProcess } from '@telegraph/services/connection-orchestrator/electron-main/DesignPageletProcess';
import { DesignPageletProcessId } from '@telegraph/services/connection-orchestrator/electron-main/DesignPageletProcess';

export interface ITelegraphApplication {
  start(): Promise<void>;
}

@injectable()
export class TelegraphApplication implements ITelegraphApplication {
  constructor(
    @inject(LogServiceId) private readonly log: ILogService,
    @inject(WindowManagerId) private readonly windowManager: IWindowManager,
    @inject(MainCpServerId) private readonly mainCpServer: IMainCpServer,
    @inject(DesignPageletProcessId) private readonly designPagelet: IDesignPageletProcess,
  ) {}

  async start(): Promise<void> {
    this.log.info('TelegraphApplication.start()');
    // Stand up the cp channel + inspector service first.
    this.mainCpServer.start();
    // Spawn the design utility before opening the renderer so the topology
    // already includes both participants on the renderer's first poll.
    await this.designPagelet.spawn();
    // Then open the renderer.
    this.windowManager.openMainWindow();
    this.log.info('TelegraphApplication.start() done');
  }
}

export const TelegraphApplicationId = createId('TelegraphApplication');
