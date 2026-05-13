import { createId, inject, injectable } from '@x-oasis/di';

import {
  IPageletProcess,
  PageletProcessId,
} from '@telegraph/pagelet-host/electron-main/PageletProcess';
import {
  AppOrchestratorId,
  IAppOrchestrator,
} from '@telegraph/pagelet-host/electron-main/AppOrchestrator';
import { SETTING_PARTICIPANT_ID } from '@telegraph/setting/application/common';

export const SETTING_WORKER_FILE = 'setting-worker.js';

export interface ISettingApplication {
  start(): Promise<void>;
}

export const SettingApplicationId = createId('SettingApplication');

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
