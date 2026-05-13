// Phase 3 — Design utility bootstrap.
//
// Wires the utility-side cp channel + service host:
//   1. Build a `UtilityCpClient` over `process.parentPort`.
//   2. Mount `DesignApplication` on the shared service host under
//      `DESIGN_SERVICE_PATH` so the renderer (Phase 4) can call `ping()`
//      over the activated direct channel.
//   3. Start the cp client to begin listening for orchestrator activations.
//
// The actual direct-channel binding (taking the activated MessagePort and
// attaching it to an `ElectronMessagePortChannel` so RPC traffic flows) lands
// in Phase 4. Phase 3 is "spawn + handshake survives 5s without exit".
import { appendFileSync } from 'node:fs';
import { createId, inject, injectable } from '@x-oasis/di';

import type { ParentPort } from '@x-oasis/async-call-rpc-electron/electron-main';

import {
  UtilityCpClient,
  type IUtilityCpClient,
} from '@telegraph/services/connection-orchestrator/node/UtilityCpClient';
import { DESIGN_SERVICE_PATH } from '@telegraph/services/connection-orchestrator/common/types';

import {
  DesignApplication,
  DesignApplicationId,
} from './DesignApplication';

export interface IDesignBootstrap {
  start(): void;
}

// Route diagnostics to file so they survive forge's stdout suppression.
const DLOG_FILE = '/tmp/telegraph-design.log';
function dlog(msg: string): void {
  try {
    appendFileSync(DLOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
  } catch { /* ignore */ }
}

@injectable()
export class DesignBootstrap implements IDesignBootstrap {
  private cpClient?: IUtilityCpClient;
  private started = false;

  constructor(
    @inject(DesignApplicationId) private readonly designApp: DesignApplication,
  ) {}

  start(): void {
    if (this.started) {
      console.warn('[DesignBootstrap] start() called twice — ignoring');
      return;
    }
    this.started = true;

    // `process.parentPort` is provided by Electron's utility-process runtime.
    // Its type signature differs from x-oasis's `ParentPort` because Electron
    // declares a DOM-lib `MessageEvent` while x-oasis types use a structural
    // shape. They are runtime-compatible — the cast bridges the type gap.
    const electronParentPort = process.parentPort as unknown;
    if (electronParentPort === undefined) {
      // We're not running inside a utility process. This should never happen
      // in production — main spawns us via utilityProcess.fork(). Throwing
      // makes the failure mode obvious in dev (e.g. running design entry
      // standalone for type-only smoke).
      throw new Error('[DesignBootstrap] process.parentPort is undefined — not running inside utilityProcess?');
    }

    this.cpClient = new UtilityCpClient({
      parentPort: electronParentPort as ParentPort,
      description: 'pagelet:design-utility-cp',
      log: {
        info: (msg) => { dlog(msg); },
        warn: (msg) => { dlog(`[WARN] ${msg}`); },
        error: (msg) => { dlog(`[ERROR] ${msg}`); },
      },
    });

    // Register business services on the shared service host BEFORE start()
    // so the host is ready the moment a direct channel is bound.
    this.cpClient.serviceHost.registerServiceHandler(
      DESIGN_SERVICE_PATH,
      this.designApp,
    );

    this.cpClient.start(() => {
      dlog(`[DesignBootstrap] direct channel ready — services available at ${DESIGN_SERVICE_PATH}`);
    });

    dlog('[DesignBootstrap] design utility ready');
  }
}

export const DesignBootstrapId = createId('DesignBootstrap');
