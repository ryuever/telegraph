// Daemon process application - provides monitoring and management services.

import { createId, injectable } from '@x-oasis/di';

import type { IDaemonService } from '@telegraph/services/connection-orchestrator/common/types';

@injectable()
export class DaemonApplication implements IDaemonService {
  private pageletStatus: string[] = [];

  async ping(now: number): Promise<{ pong: number; serverTime: number }> {
    return {
      pong: now,
      serverTime: Date.now(),
    };
  }

  async getProcessStatus(): Promise<{ shared: string; pagelets: string[] }> {
    return {
      shared: 'running',
      pagelets: this.pageletStatus,
    };
  }

  registerPagelet(id: string): void {
    if (!this.pageletStatus.includes(id)) {
      this.pageletStatus.push(id);
    }
  }

  unregisterPagelet(id: string): void {
    const idx = this.pageletStatus.indexOf(id);
    if (idx !== -1) {
      this.pageletStatus.splice(idx, 1);
    }
  }
}

export const DaemonApplicationId = createId('DaemonApplication');