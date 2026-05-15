import { inject, injectable } from '@x-oasis/di';

import type { IDaemonProcess } from '@/apps/daemon/application/common';
import { DaemonProcessId } from '@/apps/daemon/application/common';
import type { IDaemonApplication } from '@/apps/daemon/application/common';
import { DaemonApplicationId } from '@/apps/daemon/application/common';

export type { IDaemonApplication };
export { DaemonApplicationId };

@injectable()
export class DaemonApplication implements IDaemonApplication {
  constructor(
    @inject(DaemonProcessId) private readonly daemonProcess: IDaemonProcess
  ) {}

  async start(): Promise<void> {
    await this.daemonProcess.spawn();
  }
}
