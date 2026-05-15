import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import type { ElectronMessagePortMainChannel } from '@x-oasis/async-call-rpc-electron';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import { DESIGN_PAGELET_SERVICE_PATH } from '@/apps/design/application/common';

export const DesignPageletWorkerId = createId('DesignPageletWorker');

@injectable()
export class DesignPageletWorker extends PageletWorker {
  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  protected override onRendererConnection(channel: ElectronMessagePortMainChannel): void {
    serviceHost.registerService(DESIGN_PAGELET_SERVICE_PATH, {
      channel,
      handlers: {
        info: (): string => `design-pagelet ready (pid=${String(process.pid)})`,
        ping: (now: number) =>
          Promise.resolve({ pong: now, serverTime: Date.now() }),
      },
    });
  }
}
