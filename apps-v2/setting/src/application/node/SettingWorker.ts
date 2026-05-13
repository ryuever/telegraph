import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import {
  PageletWorker,
  PageletWorkerConfigId,
  IPageletWorkerConfig,
} from '@telegraph/pagelet-host/node/PageletWorker';
import { SETTING_PAGELET_SERVICE_PATH } from '@telegraph/setting/application/common';
import { ISharedService } from '@telegraph/shared/application/common';
import { IDaemonService } from '@telegraph/daemon/application/common';
import { IMainRpcService } from '@telegraph/pagelet-host/common';

export const SettingWorkerId = createId('SettingWorker');

@injectable()
export class SettingWorker extends PageletWorker {
  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  protected override onRendererConnection(channel: any): void {
    serviceHost.registerService(SETTING_PAGELET_SERVICE_PATH, {
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
