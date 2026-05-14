import { createId, inject, injectable } from '@x-oasis/di';

import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { AppOrchestratorId } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import type { IAppOrchestrator } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { DESIGN_PARTICIPANT_ID } from '@/packages/services/pagelet-host/common';

export const DESIGN_WORKER_FILE = 'design-worker.js';

export interface IDesignApplication {
  start(): Promise<void>;
}

export const DesignApplicationId = createId('DesignApplication');

@injectable()
export class DesignApplication implements IDesignApplication {
  constructor(
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess,
    @inject(AppOrchestratorId)
    private readonly appOrchestrator: IAppOrchestrator
  ) {}

  async start(): Promise<void> {
    await this.pageletProcess.spawn(
      DESIGN_PARTICIPANT_ID,
      DESIGN_WORKER_FILE
    );
    await this.appOrchestrator.connectDesign();
  }
}
