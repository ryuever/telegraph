import { createId, injectable } from '@x-oasis/di';

import { getPidTree } from './process-utils';
import type { PidNodeJson } from './types';

export interface IProcessService {
  getPidTree(ppid: string): Promise<PidNodeJson | null>;
}

export const ProcessServiceId = createId('ProcessService');

@injectable()
export class ProcessService implements IProcessService {
  async getPidTree(ppid: string): Promise<PidNodeJson | null> {
    return getPidTree(ppid);
  }
}
