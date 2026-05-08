// Phase 3 + 4 — utility-process-side helper.
//
// Both ends of `pagelet:design` (and any future utility participant) need
// roughly the same boilerplate to attach to the orchestrator:
//
//   1. Wrap `process.parentPort` in `ElectronUtilityProcessChannel` to get a
//      cp channel back to main.
//   2. Mount its `RPCServiceHost` so business services (e.g. `/services/design`)
//      can be called over the *direct* channel later.
//   3. Subscribe to `registerOrchestratorHandler(...)` so when main calls
//      `orchestrator.connect()`, the utility receives the `MessagePortMain`
//      and binds it to a `direct` channel (`ElectronMessagePortMainChannel`)
//      that re-exposes the same service host.
//
// Phase 4 promotes step 3 from a raw callback to "build a direct channel,
// bind the port, attach the shared service host". Callers (DesignBootstrap)
// no longer need to know about MessagePort plumbing.
//
// IMPORTANT: this file lives under `services/connection-orchestrator/node/`
// because it is consumed by utility processes (node runtime, not renderer)
// and must therefore avoid `electron` main-process imports beyond
// `process.parentPort` access via the shared electron module surface.
import {
  ElectronMessagePortMainChannel,
  ElectronUtilityProcessChannel,
  registerOrchestratorHandler,
} from '@x-oasis/async-call-rpc-electron/electron-main';
import { RPCServiceHost } from '@x-oasis/async-call-rpc';

import type { ParentPort } from '@x-oasis/async-call-rpc-electron/electron-main';
import type { MessagePortMain } from 'electron';

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
   * Begin listening for orchestrator activations.
   *
   * After this resolves, main can call
   * `orchestrator.connect('renderer:main', '<this participant>')` and the
   * activated `MessagePortMain` will be auto-bound to a fresh
   * `ElectronMessagePortMainChannel` that exposes `serviceHost`. The
   * optional `onActivated` callback fires after binding for diagnostics
   * (e.g. logging the connection id, exposing the channel for tests).
   */
  start(onActivated?: (channel: ElectronMessagePortMainChannel) => void): void;
}

export class UtilityCpClient implements IUtilityCpClient {
  readonly cpChannel: ElectronUtilityProcessChannel;
  readonly serviceHost: RPCServiceHost;
  /**
   * The most recently activated direct channel, kept for diagnostics
   * (e.g. unit tests, "active connection" inspector). Phase 4 only one
   * connection is expected per utility, but we deliberately keep a Map
   * keyed by `Symbol()` so future multi-peer fan-out is a small change.
   */
  private readonly directChannels = new Map<symbol, ElectronMessagePortMainChannel>();
  private started = false;

  constructor(private readonly options: UtilityCpClientOptions) {
    this.cpChannel = new ElectronUtilityProcessChannel({
      parentPort: options.parentPort,
      description: options.description,
    });
    this.serviceHost = new RPCServiceHost();
  }

  start(onActivated?: (channel: ElectronMessagePortMainChannel) => void): void {
    if (this.started) {
      this.options.log?.warn('UtilityCpClient.start() called twice — ignoring');
      return;
    }
    this.started = true;

    // Register the activate-connection handler. When the main-side orchestrator
    // calls `connect(a, b)` and this participant is one of the endpoints,
    // x-oasis invokes the callback below with the transferred port. We
    // immediately wrap it in a direct channel and attach our shared service
    // host so business RPC (e.g. `/services/design.ping()`) can flow.
    registerOrchestratorHandler(this.cpChannel, (rawPort: unknown) => {
      this.options.log?.info(
        `[UtilityCpClient] activateConnection received port (description=${this.options.description})`,
      );

      // x-oasis types the cb param as `any`; narrow to `unknown` at the
      // boundary then cast to Electron's `MessagePortMain` once for the
      // bindPort call. Runtime: this IS a MessagePortMain (utility-process
      // side of `webContents.postMessage` transfer).
      const port = rawPort as MessagePortMain;

      const directChannel = new ElectronMessagePortMainChannel({
        description: `${this.options.description}-direct`,
      });
      directChannel.setServiceHost(this.serviceHost);
      directChannel.bindPort(port);

      const key = Symbol(this.options.description);
      this.directChannels.set(key, directChannel);

      onActivated?.(directChannel);
    });

    this.options.log?.info(
      `[UtilityCpClient] started — cp description=${this.options.description}`,
    );
  }
}
