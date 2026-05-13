// Daemon utility bootstrap.
//
// Wires the utility-side cp channel + service host:
//   1. Build a `UtilityCpClient` over `process.parentPort`.
//   2. Mount `DaemonApplication` on the shared service host under
//      `DAEMON_SERVICE_PATH` so other processes can call it.
//   3. Start the cp client to begin listening for orchestrator activations.

import { appendFileSync } from 'node:fs';
import { createId, inject, injectable } from '@x-oasis/di';

import type { ParentPort } from '@x-oasis/async-call-rpc-electron/electron-main';

import {
  UtilityCpClient,
  type IUtilityCpClient,
} from '@telegraph/services/connection-orchestrator/node/UtilityCpClient';
import { DAEMON_SERVICE_PATH } from '@telegraph/services/connection-orchestrator/common/types';

import {
  DaemonApplication,
  DaemonApplicationId,
} from './DaemonApplication';

export interface IDaemonBootstrap {
  start(): void;
}

const DLOG_FILE = '/tmp/telegraph-daemon.log';
function dlog(msg: string): void {
  try {
    appendFileSync(DLOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

@injectable()
export class DaemonBootstrap implements IDaemonBootstrap {
  private cpClient?: IUtilityCpClient;
  private started = false;

  constructor(
    @inject(DaemonApplicationId) private readonly daemonApp: DaemonApplication,
  ) {}

  start(): void {
    if (this.started) {
      console.warn('[DaemonBootstrap] start() called twice — ignoring');
      return;
    }
    this.started = true;

    dlog(`[DEBUG] process.type: ${String((process as any).type)}`);
    dlog(`[DEBUG] ELECTRON_RUN_AS_NODE: ${String(process.env.ELECTRON_RUN_AS_NODE)}`);
    dlog(`[DEBUG] process.parentPort type: ${typeof process.parentPort}, value: ${String(process.parentPort)}`);
    dlog(`[DEBUG] process.versions.electron: ${String((process.versions as any).electron)}`);

    const electronParentPort = process.parentPort as unknown;
    if (electronParentPort === undefined) {
      throw new Error('[DaemonBootstrap] process.parentPort is undefined — not running inside utilityProcess?');
    }

    this.cpClient = new UtilityCpClient({
      parentPort: electronParentPort as ParentPort,
      description: 'daemon-utility-cp',
      log: {
        info: (msg) => { dlog(msg); },
        warn: (msg) => { dlog(`[WARN] ${msg}`); },
        error: (msg) => { dlog(`[ERROR] ${msg}`); },
      },
    });

    this.cpClient.serviceHost.registerServiceHandler(
      DAEMON_SERVICE_PATH,
      this.daemonApp,
    );

    this.cpClient.start(() => {
      dlog(`[DaemonBootstrap] direct channel ready — services available at ${DAEMON_SERVICE_PATH}`);
    });

    dlog('[DaemonBootstrap] daemon utility ready');
  }
}

export const DaemonBootstrapId = createId('DaemonBootstrap');