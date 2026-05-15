import { inject, injectable } from '@x-oasis/di';

import type { ISharedProcess } from '@/apps/shared/application/common';
import { SharedProcessId } from '@/apps/shared/application/common';
import { ISharedApplication, SharedApplicationId } from '@/apps/shared/application/common';

export type { ISharedApplication };
export { SharedApplicationId };

@injectable()
export class SharedApplication implements ISharedApplication {
  constructor(
    @inject(SharedProcessId) private readonly sharedProcess: ISharedProcess
  ) {}

  async start(): Promise<void> {
    await this.sharedProcess.spawn();
  }
}
