import { createId, inject, injectable } from '@x-oasis/di';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker';
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker';
import { MONITOR_PAGELET_SERVICE_PATH } from '@/apps/monitor/application/common';
import { IDaemonService } from '@/apps/daemon/application/common';

export const MonitorPageletWorkerId = createId('MonitorPageletWorker');

@injectable()
export class MonitorPageletWorker extends PageletWorker {
  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config);
  }

  protected override onRendererConnection(channel: any): void {
    serviceHost.registerService(MONITOR_PAGELET_SERVICE_PATH, {
      channel,
      serviceHost,
      handlers: {
        info: (): string => `monitor-pagelet ready (pid=${process.pid})`,
        getSnapshot: (): any =>
          (this.daemonClient as IDaemonService)?.getPerformanceSnapshot(),
        onPerformanceUpdate: (callback: (snapshot: any) => void) =>
          (this.daemonClient as IDaemonService)?.onPerformanceUpdate(callback),
      },
    });
  }
}
