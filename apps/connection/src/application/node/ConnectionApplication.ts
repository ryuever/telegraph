import { createId, inject, injectable } from '@x-oasis/di';

import type {
  IPageletProcess,
} from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import {
  PageletProcessId,
} from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import type {
  IAppOrchestrator,
} from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import {
  AppOrchestratorId,
} from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { CONNECTION_PARTICIPANT_ID } from '@/packages/services/pagelet-host/common';

export const CONNECTION_WORKER_FILE = 'connection-worker.js';

export interface IConnectionApplication {
  start(): Promise<void>;
}

export const ConnectionApplicationId = createId('ConnectionApplication');

@injectable()
export class ConnectionApplication implements IConnectionApplication {
  constructor(
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess,
    @inject(AppOrchestratorId)
    private readonly appOrchestrator: IAppOrchestrator
  ) {}

  async start(): Promise<void> {
    await this.pageletProcess.spawn(
      CONNECTION_PARTICIPANT_ID,
      CONNECTION_WORKER_FILE
    );
    this.appOrchestrator.registerOrchestratorService();
  }
}
