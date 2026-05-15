import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import {
  PageletWorker,
  PageletWorkerConfigId,
} from '@/packages/services/pagelet-host/node/PageletWorker';
import type {
  IPageletWorkerConfig,
} from '@/packages/services/pagelet-host/node/PageletWorker';
import { CONNECTION_PAGELET_SERVICE_PATH } from '@/apps/connection/application/common';
import type { ISharedService } from '@/apps/shared/application/common';
import type { IDaemonService } from '@/apps/daemon/application/common';

export const ConnectionWorkerId = createId('ConnectionWorker');

@injectable()
export class ConnectionWorker extends PageletWorker<
  ISharedService,
  IDaemonService
> {
  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }
  protected override onRendererConnection(channel: any): void {
    serviceHost.registerService(CONNECTION_PAGELET_SERVICE_PATH, {
      channel,
      serviceHost,
      handlers: {
        info: (): string => `${this.config.selfId} ready (pid=${process.pid})`,
        callSharedEcho: (msg: string): Promise<string> =>
          this.shared.echo(msg),
        callSharedGetConfig: (key: string): Promise<string> =>
          this.shared.getConfig(key),
        callSharedSetConfig: (key: string, value: string): Promise<string> =>
          this.shared.setConfig(key, value),
        callDaemonEcho: (msg: string): Promise<string> =>
          this.daemon.echo(msg),
        callDaemonSystemStatus: (): Promise<string> =>
          this.daemon.systemStatus(),
        callMainPing: (msg: string): Promise<string> => this.main.mainPing(msg),
      },
    });
  }
}
