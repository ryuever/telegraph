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
        info: (msg) => {
          console.log(msg);
        },
        warn: (msg) => {
          console.warn(msg);
        },
        error: (msg) => {
          console.error(msg);
        },
      },
    });

    // Register business services on the shared service host BEFORE start()
    // so the host is ready the moment a direct channel is bound.
    this.cpClient.serviceHost.registerServiceHandler(
      DESIGN_SERVICE_PATH,
      this.designApp,
    );

    this.cpClient.start(() => {
      // Phase 4: the cp client has already wrapped the activated port in a
      // direct channel and attached our shared service host. We just log
      // for diagnostics — the channel instance itself isn't meaningful in
      // string form (no toString impl), so we report by service path.
      console.log(
        `[DesignBootstrap] direct channel ready — services available at ${DESIGN_SERVICE_PATH}`,
      );
    });

    console.log('[DesignBootstrap] design utility ready');
  }
}

export const DesignBootstrapId = createId('DesignBootstrap');
