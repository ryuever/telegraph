import { createId, inject, injectable } from '@x-oasis/di';

import {
  ISharedProcess,
  SharedProcessId,
} from '@telegraph/shared/application/electron-main/SharedProcess';

export interface ISharedApplication {
  start(): Promise<void>;
}

export const SharedApplicationId = createId('SharedApplication');

@injectable()
export class SharedApplication implements ISharedApplication {
  constructor(
    @inject(SharedProcessId) private readonly sharedProcess: ISharedProcess
  ) {}

  async start(): Promise<void> {
    await this.sharedProcess.spawn();
  }
}
