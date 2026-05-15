import { inject, injectable } from '@x-oasis/di';

import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { AppOrchestratorId } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import type { IAppOrchestrator } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { MONITOR_PARTICIPANT_ID } from '@/packages/services/pagelet-host/common';
import type { IMonitorApplication } from '@/apps/monitor/application/common';
import { MonitorApplicationId } from '@/apps/monitor/application/common';

export const MONITOR_WORKER_FILE = 'monitor-worker.js';

export type { IMonitorApplication };
export { MonitorApplicationId };

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
