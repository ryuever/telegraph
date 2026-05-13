import { createId, inject, injectable } from '@x-oasis/di';

import type { IPageletProcess } from '@telegraph/pagelet-host/electron-main/PageletProcess';
import { PageletProcessId } from '@telegraph/pagelet-host/electron-main/PageletProcess';
import { AppOrchestratorId } from '@telegraph/pagelet-host/electron-main/AppOrchestrator';
import type { IAppOrchestrator } from '@telegraph/pagelet-host/electron-main/AppOrchestrator';
import { MONITOR_PARTICIPANT_ID } from '@telegraph/pagelet-host/common';

export const MONITOR_WORKER_FILE = 'monitor-worker.js';

export interface IMonitorApplication {
  start(): Promise<void>;
}

export const MonitorApplicationId = createId('MonitorApplication');

@injectable()
export class MonitorApplication implements IMonitorApplication {
  constructor(
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess,
    @inject(AppOrchestratorId)
    private readonly appOrchestrator: IAppOrchestrator
  ) {}

  async start(): Promise<void> {
    await this.pageletProcess.spawn(
      MONITOR_PARTICIPANT_ID,
      MONITOR_WORKER_FILE
    );
    await this.appOrchestrator.connectMonitor();
  }
}
