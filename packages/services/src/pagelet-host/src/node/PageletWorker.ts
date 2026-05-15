import { createId, inject, injectable } from '@x-oasis/di';
import {
  ElectronUtilityProcessChannel,
  ElectronMessagePortMainChannel,
  createParticipantProxy,
} from '@x-oasis/async-call-rpc-electron';
import {
  clientHost,
  ConnectionConfigSpec,
  ConnectOptions,
} from '@x-oasis/async-call-rpc';

import {
  IMainRpcService,
  MAIN_RPC_SERVICE_PATH,
} from '@/packages/services/pagelet-host/common';
import { createForwardingProxy } from '@/packages/services/pagelet-host/node/createForwardingProxy';
import { createLogger } from '@/packages/services/log/node/logger';

const logger = createLogger('pagelet');

export interface IPageletWorkerConfig {
  selfId: string;
  rendererParticipantId: string;
}

export const PageletWorkerConfigId = createId('PageletWorkerConfig');

export interface IPageletWorker {
  boot(): Promise<void>;
}

export const PageletWorkerId = createId('PageletWorker');

/**
 * Generic over the shared & daemon RPC service interfaces so concrete
 * pagelets type-narrow the proxies without per-call `as ISharedService`
 * / `as IDaemonService` casts.
 *
 * The clients are nullable because they are populated asynchronously
 * during `boot()`. Subclasses must guard with `?.` and treat absence as
 * "peer not yet ready" — see `apps/setting/.../SettingWorker.ts` for
 * the canonical fallback pattern.
 *
 * Default `unknown` keeps the contract opt-in: pagelets that don't talk
 * to shared/daemon (e.g. design) can ignore the type parameters.
 */
@injectable()
export class PageletWorker<
  TSharedService = unknown,
  TDaemonService = unknown,
> implements IPageletWorker
{
  protected sharedClient: TSharedService | null = null;
  protected daemonClient: TDaemonService | null = null;
  protected mainClient: IMainRpcService | null = null;
  /**
   * The pagelet→main control channel (UtilityProcess parentPort).
   * Exposed so subclasses can register additional RPC clients (e.g.
   * MainMetricsService) over the same physical channel and react to
   * its `onDidConnected` for push-style RPC re-subscription on
   * reconnect — main never restarts but channel-level reconnection
   * semantics are identical to the daemon channel case.
   */
  protected mainChannel: ElectronUtilityProcessChannel | null = null;
  /**
   * The control channel to the daemon utility process. Exposed so
   * subclasses can subscribe to `onDidConnected` and re-subscribe any
   * push-style daemon RPCs after a daemon restart (the channel
   * instance is preserved across `replaceParticipantChannel` /
   * `bindPort({rebind:true})` so this reference stays valid).
   */
  protected daemonChannel: ElectronMessagePortMainChannel | null = null;
  /**
   * Same as {@link daemonChannel} but for shared. Reserved for
   * symmetry — subclasses currently don't need it but if shared ever
   * starts hosting push-style RPCs the same re-subscribe pattern
   * applies.
   */
  protected sharedChannel: ElectronMessagePortMainChannel | null = null;

  /**
   * Forwarding proxy over {@link sharedClient}. Lets subclasses write
   * `this.shared.echo(msg)` without per-call null check; falls back to
   * `Promise.resolve('shared not ready')` while the channel is still
   * being established or while the supervisor is restarting the peer.
   * See {@link createForwardingProxy} for the rationale.
   */
  protected readonly shared: TSharedService = createForwardingProxy<
    TSharedService & object
  >(() => this.sharedClient as TSharedService & object, 'shared');

  protected readonly daemon: TDaemonService = createForwardingProxy<
    TDaemonService & object
  >(() => this.daemonClient as TDaemonService & object, 'daemon');

  protected readonly main: IMainRpcService = createForwardingProxy<IMainRpcService>(
    () => this.mainClient,
    'main'
  );

  constructor(
    @inject(PageletWorkerConfigId)
    protected readonly config: IPageletWorkerConfig
  ) {}

  /**
   * Per-peer initial connect timeout (ms). Hitting it does NOT abort
   * boot; the connection promise is left running in the background and
   * fills in `{shared,daemon}Client` whenever it eventually resolves.
   * Until then, `this.shared` / `this.daemon` forwarding proxies
   * return 'X not ready' so renderer-side handlers can still respond.
   *
   * Override in subclasses if a particular pagelet has stricter
   * latency requirements.
   */
  protected readonly peerConnectTimeoutMs: number = 5000;

  /**
   * Per-peer connection config (cross-process-safe spec) sent to the
   * main-process orchestrator alongside `proxy.connect()`.
   *
   * Defaults to `undefined` — the orchestrator falls back to its own
   * `defaultConnectionConfig()` (exponential-backoff, 1s–30s, 10
   * retries, 5min cap). Override in subclasses to customise per-pagelet
   * reconnect behaviour.
   *
   * Called once per peer during `boot()`. The return value is passed
   * through to `ParticipantOrchestratorProxy.connect(toId, config)`,
   * which ships it over RPC. The orchestrator unmarshals
   * `ReconnectPolicySpec` back into a class instance via
   * `instantiateReconnectPolicy()` — see x-oasis G7.
   */
  protected peerConnectionConfig(
    _peerLabel: string
  ): ConnectionConfigSpec | undefined {
    return undefined;
  }

  /**
   * Per-peer first-attempt activation options. Defaults to
   * `undefined` (the orchestrator uses its own defaults — see
   * `defaultConnectOptions()` in AppOrchestrator).
   */
  protected peerConnectOptions(
    _peerLabel: string
  ): ConnectOptions | undefined {
    return undefined;
  }

  async boot(): Promise<void> {
    const parentPort = process.parentPort;

    const mainChannel = new ElectronUtilityProcessChannel({
      parentPort: parentPort as unknown as ConstructorParameters<typeof ElectronUtilityProcessChannel>[0] extends { parentPort: infer P } ? P : never,
      description: `${this.config.selfId}→main IPC channel`,
    });
    this.mainChannel = mainChannel;

    const proxy = createParticipantProxy({
      selfId: this.config.selfId,
      controlChannel: mainChannel,
      onConnection: (conn) => {
        logger.info(
          `[${this.config.selfId}-worker] connection: ${conn.connectionId}, peer=${conn.peerId}, role=${conn.role}`
        );
        const ch = proxy.getChannelFor(conn.peerId);

        if (ch && conn.peerId === this.config.rendererParticipantId) {
          this.onRendererConnection(ch);
          logger.info(
            `[${this.config.selfId}-worker] service registered on ${conn.peerId} channel`
          );
        }
      },
    });

    this.mainClient = clientHost
      .registerClient(MAIN_RPC_SERVICE_PATH, { channel: mainChannel })
      .createProxy() as unknown as IMainRpcService;

    // Connect to shared & daemon in PARALLEL with a per-peer timeout.
    // Previous implementation awaited them serially with no timeout —
    // a daemon that's still being spawned (or in supervisor-restart
    // window) would freeze every pagelet's boot indefinitely. Now boot
    // returns once both connect attempts settle (success or timeout);
    // late-arriving connections install their client in the background
    // and the forwarding proxies serve 'X not ready' until then.
    await Promise.allSettled([
      this.connectPeer('shared', proxy, (channel) => {
        this.sharedChannel = channel;
        this.sharedClient = clientHost
          .registerClient('shared-rpc', { channel })
          .createProxy() as unknown as TSharedService;
        this.onSharedClientReady(channel);
      }),
      this.connectPeer('daemon', proxy, (channel) => {
        this.daemonChannel = channel;
        this.daemonClient = clientHost
          .registerClient('daemon-rpc', { channel })
          .createProxy() as unknown as TDaemonService;
        this.onDaemonClientReady(channel);
      }),
    ]);

    logger.info(
      `[${this.config.selfId}-worker] boot complete (shared=${
        this.sharedClient ? 'connected' : 'pending'
      }, daemon=${
        this.daemonClient ? 'connected' : 'pending'
      }), waiting for ${this.config.rendererParticipantId}`
    );
  }

  /**
   * Race `proxy.connect(peerId)` against {@link peerConnectTimeoutMs}.
   * On success — within the timeout — `install(channel)` runs and the
   * outer promise resolves. On timeout the outer promise rejects so
   * `Promise.allSettled` upstream lets boot() return; the underlying
   * connect promise is **not** cancelled (x-oasis exposes no
   * cancellation primitive) and `install(channel)` runs late when the
   * connect eventually completes.
   *
   * @param peerLabel  Participant id ('shared' | 'daemon').
   * @param proxy      The participant proxy from createParticipantProxy.
   * @param install    Synchronous callback that wires the resolved
   *                   channel into the worker (sets {@link sharedChannel}
   *                   / {@link sharedClient} or the daemon equivalents).
   */
  protected async connectPeer(
    peerLabel: string,
    proxy: ReturnType<typeof createParticipantProxy>,
    install: (channel: ElectronMessagePortMainChannel) => void
  ): Promise<void> {
    const connectPromise = proxy
      .connect(
        peerLabel,
        this.peerConnectionConfig(peerLabel),
        this.peerConnectOptions(peerLabel)
      )
      .then((conn) => conn.getChannel());

    // Always install when connect resolves, even if the outer race
    // already lost to the timeout. Failures are logged but not
    // re-thrown — the timeout path already surfaced the problem.
    void connectPromise.then(install, (err: unknown) => {
      logger.warn(
        `[${this.config.selfId}-worker] background connect to '${peerLabel}' failed: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        reject(
          new Error(
            `[${this.config.selfId}-worker] connect to '${peerLabel}' timed out after ${String(this.peerConnectTimeoutMs)}ms`
          )
        );
      }, this.peerConnectTimeoutMs);
    });

    try {
      await Promise.race([connectPromise, timeoutPromise]);
      if (timer) clearTimeout(timer);
    } catch (err) {
      logger.warn(
        `[${this.config.selfId}-worker] ${
          err instanceof Error ? err.message : String(err)
        } — forwarding proxy will return '${peerLabel} not ready' until the background connect wins`
      );
      throw err;
    }
  }

  protected onRendererConnection(
    _channel: ReturnType<
      ReturnType<typeof createParticipantProxy>['getChannelFor']
    >
  ): void {}

  /**
   * Hook fired immediately after {@link sharedClient} (and the
   * underlying {@link sharedChannel}) is installed, including the
   * late-install path when the initial connect timed out and the
   * background recovery eventually wins. Subclasses use this to wire
   * `channel.onDidConnected` for push-RPC re-subscribe on supervisor
   * restart of the peer — without this hook, late installs would
   * silently miss the wiring (the boot() override path runs once and
   * by then channels are still null on the timeout branch).
   */
  protected onSharedClientReady(_channel: ElectronMessagePortMainChannel): void {}

  /** See {@link onSharedClientReady}. Symmetric for daemon. */
  protected onDaemonClientReady(_channel: ElectronMessagePortMainChannel): void {}
}

/**
 * Convenience factory that mirrors the main-process
 * `defaultConnectionConfig()` parameters but as a cross-process-safe
 * `ConnectionConfigSpec`. Use in subclasses:
 *
 * ```ts
 * protected peerConnectionConfig(peerLabel: string) {
 *   return defaultConnectionConfigSpec();
 * }
 * ```
 */
export function defaultConnectionConfigSpec(): ConnectionConfigSpec {
  return {
    reconnectPolicy: {
      kind: 'exponential-backoff',
      options: {
        initialDelayMs: 1_000,
        maxDelayMs: 30_000,
        multiplier: 2,
        jitterFactor: 0.3,
        maxRetries: 10,
        maxElapsedMs: 5 * 60_000,
      },
    },
  };
}
