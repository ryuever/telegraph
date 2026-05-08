// Phase 2 — TelegraphApplication: thin entrypoint resolved by main.ts via DI.
//
// Boot order matters:
//   1. MainCpServer.start() — must run BEFORE the renderer window opens, so
//      the IPCMainChannel is listening when the preload-side
//      IPCRendererChannel sends its first message.
//   2. WindowManager.openMainWindow() — opens the BrowserWindow, which loads
//      the preload (creates window.telegraph.ipc) and then index.tsx.
import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';
import type { IWindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager';
import { WindowManagerId } from '@telegraph/services/window-manager/electron-main/WindowManager';
import type { IMainCpServer } from '@telegraph/services/connection-orchestrator/electron-main/MainCpServer';
import { MainCpServerId } from '@telegraph/services/connection-orchestrator/electron-main/MainCpServer';

export interface ITelegraphApplication {
  start(): void;
}

@injectable()
export class TelegraphApplication implements ITelegraphApplication {
  constructor(
    @inject(LogServiceId) private readonly log: ILogService,
    @inject(WindowManagerId) private readonly windowManager: IWindowManager,
    @inject(MainCpServerId) private readonly mainCpServer: IMainCpServer,
  ) {}

  start(): void {
    this.log.info('TelegraphApplication.start()');
    // Stand up the cp channel + inspector service first.
    this.mainCpServer.start();
    // Then open the renderer.
    this.windowManager.openMainWindow();
    this.log.info('TelegraphApplication.start() done');
  }
}

export const TelegraphApplicationId = createId('TelegraphApplication');
