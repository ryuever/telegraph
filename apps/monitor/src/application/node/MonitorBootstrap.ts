import { appendFileSync } from 'node:fs';
import { createId, inject, injectable } from '@x-oasis/di';

import type { ParentPort } from '@x-oasis/async-call-rpc-electron/electron-main';

import {
  UtilityCpClient,
  type IUtilityCpClient,
} from '@telegraph/services/connection-orchestrator/node/UtilityCpClient';
import { MONITOR_SERVICE_PATH } from '@telegraph/services/connection-orchestrator/common/types';

import {
  MonitorApplication,
  MonitorApplicationId,
} from './MonitorApplication';

export interface IMonitorBootstrap {
  start(): void;
}

const DLOG_FILE = '/tmp/telegraph-monitor.log';
function dlog(msg: string): void {
  try {
    appendFileSync(DLOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

@injectable()
export class MonitorBootstrap implements IMonitorBootstrap {
  private cpClient?: IUtilityCpClient;
  private started = false;

  constructor(
    @inject(MonitorApplicationId) private readonly monitorApp: MonitorApplication,
  ) {}

  start(): void {
    if (this.started) {
      console.warn('[MonitorBootstrap] start() called twice — ignoring');
      return;
    }
    this.started = true;

    const electronParentPort = process.parentPort as unknown;
    if (electronParentPort === undefined) {
      throw new Error('[MonitorBootstrap] process.parentPort is undefined — not running inside utilityProcess?');
    }

    /* eslint-disable @typescript-eslint/no-unsafe-assignment */
    this.cpClient = new UtilityCpClient({
      parentPort: electronParentPort as ParentPort,
      description: 'pagelet:monitor-utility-cp',
      log: {
        info: (msg) => { dlog(msg); },
        warn: (msg) => { dlog(`[WARN] ${msg}`); },
        error: (msg) => { dlog(`[ERROR] ${msg}`); },
      },
    });
    /* eslint-enable @typescript-eslint/no-unsafe-assignment */

    this.cpClient.serviceHost.registerServiceHandler(
      MONITOR_SERVICE_PATH,
      this.monitorApp,
    );

    this.cpClient.start(() => {
      dlog(`[MonitorBootstrap] direct channel ready — services available at ${MONITOR_SERVICE_PATH}`);
    });

    dlog('[MonitorBootstrap] monitor utility ready');
  }
}

export const MonitorBootstrapId = createId('MonitorBootstrap');
