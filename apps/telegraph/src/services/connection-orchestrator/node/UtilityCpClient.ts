// Phase 3 — utility-process-side helper.
//
// Both ends of `pagelet:design` (and any future utility participant) need
// roughly the same boilerplate to attach to the orchestrator:
//
//   1. Wrap `process.parentPort` in `ElectronUtilityProcessChannel` to get a
//      cp channel back to main.
//   2. Mount its `RPCServiceHost` so business services (e.g. `/services/design`)
//      can be called over the *direct* channel later.
//   3. Subscribe to `registerOrchestratorHandler(...)` so when main calls
//      `orchestrator.connect()`, the utility receives the `MessagePort` and
//      binds it to a `direct` channel that exposes the same service host.
//
// Phase 3 only standsup steps 1 + 2 + the onPort registration; Phase 4 will
// extend `bindActivatedPort()` to wire the direct channel for real RPC.
//
// IMPORTANT: this file lives under `services/connection-orchestrator/node/`
// because it is consumed by utility processes (node runtime, not renderer)
// and must therefore avoid `electron` main-process imports beyond
// `process.parentPort` access via the shared electron module surface.
import {
  ElectronUtilityProcessChannel,
  registerOrchestratorHandler,
} from '@x-oasis/async-call-rpc-electron';
import { RPCServiceHost } from '@x-oasis/async-call-rpc';

import type { ParentPort } from '@x-oasis/async-call-rpc-electron';

export interface UtilityCpClientOptions {
  /**
   * The utility process's parent port (must equal `process.parentPort` at
   * runtime). Passed in to keep this class testable and to make the
   * dependency on `electron` fully explicit at the call site.
   */
  parentPort: ParentPort;
  /**
   * Human-friendly description used by x-oasis logger / inspector.
   * Convention: `'<participantId>-cp'`.
   */
  description: string;
  /**
   * Optional logger; defaults to console.
   */
  log?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export interface IUtilityCpClient {
  /**
   * The cp channel that talks to main's `AppOrchestrator`. Pass this to any
   * code that needs to send raw control-plane traffic (rare — most callers
   * should mount services via `serviceHost` instead).
   */
  readonly cpChannel: ElectronUtilityProcessChannel;
  /**
   * The shared `RPCServiceHost` that backs the *direct* channel after
   * activation. Business services (e.g. `/services/design`) MUST register
   * here before `start()` is called.
   */
  readonly serviceHost: RPCServiceHost;
  /**
   * Begin listening for orchestrator activations.  After this resolves, main
   * can call `orchestrator.connect('renderer:main', '<this participant>')`
   * and the activated MessagePort will be delivered via `onActivated`.
   */
  start(onActivated: (port: unknown) => void): void;
}

export class UtilityCpClient implements IUtilityCpClient {
  readonly cpChannel: ElectronUtilityProcessChannel;
  readonly serviceHost: RPCServiceHost;
  private started = false;

  constructor(private readonly options: UtilityCpClientOptions) {
    this.cpChannel = new ElectronUtilityProcessChannel({
      parentPort: options.parentPort,
      description: options.description,
    });
    this.serviceHost = new RPCServiceHost();
  }

  start(onActivated: (port: unknown) => void): void {
    if (this.started) {
      this.options.log?.warn('UtilityCpClient.start() called twice — ignoring');
      return;
    }
    this.started = true;

    // Register the activate-connection handler. When the main-side orchestrator
    // calls `connect(a, b)` and this participant is one of the endpoints,
    // x-oasis will invoke `onPort` here with the transferred MessagePort.
    //
    // Phase 3: we just hand the port to the caller (which logs it).  Phase 4
    // will create an `ElectronMessagePortChannel`, bind the port, and attach
    // `this.serviceHost` so business RPC works.
    registerOrchestratorHandler(this.cpChannel, (port) => {
      this.options.log?.info(
        `[UtilityCpClient] activateConnection received MessagePort (description=${this.options.description})`,
      );
      onActivated(port);
    });

    this.options.log?.info(
      `[UtilityCpClient] started — cp description=${this.options.description}`,
    );
  }
}
