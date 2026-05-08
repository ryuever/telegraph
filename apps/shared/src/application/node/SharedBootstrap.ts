// Shared utility bootstrap.
//
// Wires the utility-side cp channel + service host:
//   1. Build a `UtilityCpClient` over `process.parentPort`.
//   2. Mount `SharedApplication` on the shared service host under
//      `SHARED_SERVICE_PATH` so other processes can call it.
//   3. Start the cp client to begin listening for orchestrator activations.

import { appendFileSync } from 'node:fs';
import { createId, inject, injectable } from '@x-oasis/di';

import type { ParentPort } from '@x-oasis/async-call-rpc-electron/electron-main';

import {
  UtilityCpClient,
  type IUtilityCpClient,
} from '@telegraph/services/connection-orchestrator/node/UtilityCpClient';
import { SHARED_SERVICE_PATH } from '@telegraph/services/connection-orchestrator/common/types';

import {
  SharedApplication,
  SharedApplicationId,
} from './SharedApplication';

export interface ISharedBootstrap {
  start(): void;
}

const DLOG_FILE = '/tmp/telegraph-shared.log';
function dlog(msg: string): void {
  try {
    appendFileSync(DLOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

@injectable()
export class SharedBootstrap implements ISharedBootstrap {
  private cpClient?: IUtilityCpClient;
  private started = false;

  constructor(
    @inject(SharedApplicationId) private readonly sharedApp: SharedApplication,
  ) {}

  start(): void {
    if (this.started) {
      console.warn('[SharedBootstrap] start() called twice — ignoring');
      return;
    }
    this.started = true;

    const electronParentPort = process.parentPort as unknown;
    if (electronParentPort === undefined) {
      throw new Error('[SharedBootstrap] process.parentPort is undefined — not running inside utilityProcess?');
    }

    this.cpClient = new UtilityCpClient({
      parentPort: electronParentPort as ParentPort,
      description: 'shared-utility-cp',
      log: {
        info: (msg) => { dlog(msg); },
        warn: (msg) => { dlog(`[WARN] ${msg}`); },
        error: (msg) => { dlog(`[ERROR] ${msg}`); },
      },
    });

    this.cpClient.serviceHost.registerServiceHandler(
      SHARED_SERVICE_PATH,
      this.sharedApp,
    );

    this.cpClient.start(() => {
      dlog(`[SharedBootstrap] direct channel ready — services available at ${SHARED_SERVICE_PATH}`);
    });

    dlog('[SharedBootstrap] shared utility ready');
  }
}

export const SharedBootstrapId = createId('SharedBootstrap');