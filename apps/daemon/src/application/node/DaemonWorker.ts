import { createId, injectable } from '@x-oasis/di';
import {
  ElectronUtilityProcessChannel,
  createParticipantProxy,
} from '@x-oasis/async-call-rpc-electron';
import { clientHost, RPCServiceHost } from '@x-oasis/async-call-rpc';

import { DAEMON_SERVICE_PATH } from '@/apps/daemon/application/common';
import type { MonitorSnapshot } from '@/apps/daemon/diagnostics/common/types';
import { Diagnostics } from '@/apps/daemon/diagnostics/node/Diagnostics';
import {
  MAIN_METRICS_SERVICE_PATH,
  IMainMetricsService,
} from '@/packages/services/main-metrics/common';
import { createLogger } from '@/packages/services/log/node/logger';

const logger = createLogger('daemon');

interface SystemStatusEvent {
  timestamp: number;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  monitorCount: number;
}

type UtilityProcessParentPort = NodeJS.EventEmitter & {
  postMessage(message: unknown): void;
};

export interface IDaemonWorker {
  boot(): void;
}

export const DaemonWorkerId = createId('DaemonWorker');

@injectable()
export class DaemonWorker implements IDaemonWorker {
  private monitorCount = 0;
  private diagnostics = new Diagnostics();

  boot(): void {
    const SELF_ID = 'daemon';
    const mainChannel = new ElectronUtilityProcessChannel({
      parentPort: process.parentPort as unknown as UtilityProcessParentPort,
      description: 'daemon→main IPC channel',
    });

    const mainMetricsClient = clientHost
      .registerClient(MAIN_METRICS_SERVICE_PATH, { channel: mainChannel })
      .createProxy() as unknown as IMainMetricsService;

    this.diagnostics.setMetricsProvider(mainMetricsClient);

    const diagnostics = this.diagnostics;

    const daemonHandlers = {
      systemStatus: (): string => {
        this.monitorCount++;
        return `system OK (#${String(this.monitorCount)}), uptime=${String(Math.floor(
          process.uptime()
        ))}s`;
      },
      echo: (msg: string): string => `daemon echo: ${msg}`,
      onSystemStatusChange: (callback: (status: SystemStatusEvent) => void) => {
        const interval = setInterval(() => {
          callback({
            timestamp: Date.now(),
            uptime: Math.floor(process.uptime()),
            memoryUsage: process.memoryUsage(),
            monitorCount: this.monitorCount,
          });
        }, 2000);
        return () => { clearInterval(interval); };
      },
      getPerformanceSnapshot: () => diagnostics.getPerformanceSnapshot(),
      onPerformanceUpdate: (callback: (snapshot: MonitorSnapshot) => void) =>
        diagnostics.onPerformanceUpdate(callback),
    };

    const proxy = createParticipantProxy({
      selfId: SELF_ID,
      controlChannel: mainChannel,
      onConnection: (conn) => {
        logger.info(
          `[daemon-worker] connection from ${conn.peerId} (role=${conn.role})`
        );
        const ch = proxy.getChannelFor(conn.peerId);
        if (ch) {
          const perConnHost = new RPCServiceHost();
          perConnHost.registerServiceHandler(
            DAEMON_SERVICE_PATH,
            daemonHandlers
          );
          ch.setServiceHost(perConnHost);
          logger.info(
            `[daemon-worker] ${DAEMON_SERVICE_PATH} registered for ${conn.peerId}`
          );
        }
      },
    });

    logger.info('[daemon-worker] initialized, waiting for pagelet connections');
  }
}
