import { createId, inject, injectable } from '@x-oasis/di';

import type { IDaemonProcess } from '@/apps/daemon/application/electron-main/DaemonProcess';
import { DaemonProcessId } from '@/apps/daemon/application/electron-main/DaemonProcess';

export interface IDaemonApplication {
  start(): Promise<void>;
}

export const DaemonApplicationId = createId('DaemonApplication');

@injectable()
export class DaemonApplication implements IDaemonApplication {
  constructor(
    @inject(DaemonProcessId) private readonly daemonProcess: IDaemonProcess
  ) {}

  async start(): Promise<void> {
    await this.daemonProcess.spawn();
  }
}
