import { createId, inject, injectable } from '@x-oasis/di';

import type { IPageletProcess } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { PageletProcessId } from '@/packages/services/pagelet-host/electron-main/PageletProcess';
import { AppOrchestratorId } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import type { IAppOrchestrator } from '@/packages/services/pagelet-host/electron-main/AppOrchestrator';
import { CHAT_PARTICIPANT_ID } from '@/packages/services/pagelet-host/common';

export const CHAT_WORKER_FILE = 'chat-worker.js';

export interface IChatApplication {
  start(): Promise<void>;
}

export const ChatApplicationId = createId('ChatApplication');

@injectable()
export class ChatApplication implements IChatApplication {
  constructor(
    @inject(PageletProcessId) private readonly pageletProcess: IPageletProcess,
    @inject(AppOrchestratorId)
    private readonly appOrchestrator: IAppOrchestrator
  ) {}

  async start(): Promise<void> {
    await this.pageletProcess.spawn(
      CHAT_PARTICIPANT_ID,
      CHAT_WORKER_FILE
    );
  }
}
