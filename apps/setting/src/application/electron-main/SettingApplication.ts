import { inject, injectable } from '@x-oasis/di';

import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { AppOrchestratorId } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import type { IAppOrchestrator } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { SETTING_PARTICIPANT_ID } from '@/apps/setting/application/common';
import type { ISettingApplication } from '@/apps/setting/application/common';
import { SettingApplicationId } from '@/apps/setting/application/common';

export const SETTING_WORKER_FILE = 'setting-worker.js';

export type { ISettingApplication };
export { SettingApplicationId };

@injectable()
export class SettingApplication implements ISettingApplication {
  constructor(
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess,
    @inject(AppOrchestratorId)
    private readonly appOrchestrator: IAppOrchestrator
  ) {}

  async start(): Promise<void> {
    await this.pageletProcess.spawn(
      SETTING_PARTICIPANT_ID,
      SETTING_WORKER_FILE
    );
    console.log('[SettingApplication] started');
  }
}
