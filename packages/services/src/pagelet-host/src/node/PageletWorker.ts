import { createId, inject, injectable } from '@x-oasis/di';
import {
  ElectronUtilityProcessChannel,
  ElectronMessagePortMainChannel,
  createParticipantProxy,
} from '@x-oasis/async-call-rpc-electron';
import { clientHost } from '@x-oasis/async-call-rpc';

import {
  IMainRpcService,
  MAIN_RPC_SERVICE_PATH,
} from '@/packages/services/pagelet-host/common';

export interface IPageletWorkerConfig {
  selfId: string;
  rendererParticipantId: string;
}

export const PageletWorkerConfigId = createId('PageletWorkerConfig');

export interface IPageletWorker {
  boot(): Promise<void>;
}

export const PageletWorkerId = createId('PageletWorker');

@injectable()
export class PageletWorker implements IPageletWorker {
  protected sharedClient: any = null;
  protected daemonClient: any = null;
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

  constructor(
    @inject(PageletWorkerConfigId)
    protected readonly config: IPageletWorkerConfig
  ) {}

  async boot(): Promise<void> {
    if (!process.parentPort) {
      throw new Error('parentPort is not available');
    }

    const mainChannel = new ElectronUtilityProcessChannel({
      parentPort: process.parentPort as any,
      description: `${this.config.selfId}→main IPC channel`,
    });
    this.mainChannel = mainChannel;

    const proxy = createParticipantProxy({
      selfId: this.config.selfId,
      controlChannel: mainChannel,
      onConnection: (conn) => {
        console.log(
          `[${this.config.selfId}-worker] connection: ${conn.connectionId}, peer=${conn.peerId}, role=${conn.role}`
        );
        const ch = proxy.getChannelFor(conn.peerId);

        if (ch && conn.peerId === this.config.rendererParticipantId) {
          this.onRendererConnection(ch);
          console.log(
            `[${this.config.selfId}-worker] service registered on ${conn.peerId} channel`
          );
        }
      },
    });

    this.mainClient = clientHost
      .registerClient(MAIN_RPC_SERVICE_PATH, { channel: mainChannel })
      .createProxy() as unknown as IMainRpcService;

    const sharedConn = await proxy.connect('shared');
    const daemonConn = await proxy.connect('daemon');

    const sharedChannel = sharedConn.getChannel();
    const daemonChannel = daemonConn.getChannel();
    this.sharedChannel = sharedChannel;
    this.daemonChannel = daemonChannel;

    this.sharedClient = clientHost
      .registerClient('shared-rpc', { channel: sharedChannel })
      .createProxy();

    this.daemonClient = clientHost
      .registerClient('daemon-rpc', { channel: daemonChannel })
      .createProxy();

    console.log(
      `[${this.config.selfId}-worker] connected to shared & daemon, waiting for ${this.config.rendererParticipantId} to connect`
    );
  }

  protected onRendererConnection(
    _channel: ReturnType<
      ReturnType<typeof createParticipantProxy>['getChannelFor']
    >
  ): void {}
}
