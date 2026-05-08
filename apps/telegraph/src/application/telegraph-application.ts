// Phase 1 — TelegraphApplication: thin entrypoint resolved by main.ts via DI.
// Phase 2+ will compose AppOrchestrator / MainCpServer / inspector here.
import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';
import type { IWindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager';
import { WindowManagerId } from '@telegraph/services/window-manager/electron-main/WindowManager';

export interface ITelegraphApplication {
  start(): void;
}

@injectable()
export class TelegraphApplication implements ITelegraphApplication {
  constructor(
    @inject(LogServiceId) private readonly log: ILogService,
    @inject(WindowManagerId) private readonly windowManager: IWindowManager,
  ) {}

  start(): void {
    this.log.info('TelegraphApplication.start()');
    this.windowManager.openMainWindow();
    this.log.info('TelegraphApplication.start() done');
  }
}

export const TelegraphApplicationId = createId('TelegraphApplication');
