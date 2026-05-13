import { createId, inject, injectable } from '@x-oasis/di';
import {
  ElectronUtilityProcessChannel,
  createParticipantProxy,
} from '@x-oasis/async-call-rpc-electron';
import { clientHost } from '@x-oasis/async-call-rpc';

import {
  IMainRpcService,
  MAIN_RPC_SERVICE_PATH,
} from '@telegraph/pagelet-host/common';

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

    this.sharedClient = clientHost
      .registerClient('shared-rpc', { channel: sharedConn.getChannel() })
      .createProxy();

    this.daemonClient = clientHost
      .registerClient('daemon-rpc', { channel: daemonConn.getChannel() })
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
