import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import { DESIGN_PAGELET_SERVICE_PATH } from '@/apps/design/application/common';

export const DesignPageletWorkerId = createId('DesignPageletWorker');

@injectable()
export class DesignPageletWorker extends PageletWorker {
  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  protected override onRendererConnection(channel: any): void {
    serviceHost.registerService(DESIGN_PAGELET_SERVICE_PATH, {
      channel,
      serviceHost,
      handlers: {
        info: (): string => `design-pagelet ready (pid=${process.pid})`,
        ping: (now: number): Promise<{ pong: number; serverTime: number }> =>
          Promise.resolve({ pong: now, serverTime: Date.now() }),
      },
    });
  }
}
