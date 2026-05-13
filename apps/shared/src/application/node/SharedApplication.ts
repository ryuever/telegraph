// Shared process application - provides common services like AppInfoService, LoginService.

import { createId, injectable } from '@x-oasis/di';

import type { ISharedService } from '@telegraph/services/connection-orchestrator/common/types';

@injectable()
export class SharedApplication implements ISharedService {
  async ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return {
      pong: now,
      serverTime: Date.now(),
    };
  }

  async getAppInfo(): Promise<{ name: string; version: string }> {
    return {
      name: 'telegraph',
      version: '1.0.0',
    };
  }
}

export const SharedApplicationId = createId('SharedApplication');