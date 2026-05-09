import { createId, injectable } from '@x-oasis/di';

import type { IMonitorService } from '@telegraph/services/connection-orchestrator/common/types';

@injectable()
export class MonitorApplication implements IMonitorService {
  ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return Promise.resolve({ pong: now, serverTime: Date.now() });
  }
}

export const MonitorApplicationId = createId('MonitorApplication');
