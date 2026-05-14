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
import { ISharedService } from '@/apps/shared/application/common';
import { IDaemonService } from '@/apps/daemon/application/common';
import { IMainRpcService } from '@/packages/services/pagelet-host/common';

export const ConnectionWorkerId = createId('ConnectionWorker');

@injectable()
export class ConnectionWorker extends PageletWorker {
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
          (this.sharedClient as ISharedService)?.echo(msg) ??
          Promise.resolve('shared not ready'),
        callSharedGetConfig: (key: string): Promise<string> =>
          (this.sharedClient as ISharedService)?.getConfig(key) ??
          Promise.resolve('shared not ready'),
        callSharedSetConfig: (key: string, value: string): Promise<string> =>
          (this.sharedClient as ISharedService)?.setConfig(key, value) ??
          Promise.resolve('shared not ready'),
        callDaemonEcho: (msg: string): Promise<string> =>
          (this.daemonClient as IDaemonService)?.echo(msg) ??
          Promise.resolve('daemon not ready'),
        callDaemonSystemStatus: (): Promise<string> =>
          (this.daemonClient as IDaemonService)?.systemStatus() ??
          Promise.resolve('daemon not ready'),
        callMainPing: (msg: string): Promise<string> =>
          (this.mainClient as IMainRpcService)?.mainPing(msg) ??
          Promise.resolve('main not ready'),
      },
    });
  }
}
