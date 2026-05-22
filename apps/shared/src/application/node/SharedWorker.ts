import { createId, injectable } from '@x-oasis/di';
import {
  ElectronUtilityProcessChannel,
  createParticipantProxy,
} from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';

import { SHARED_SERVICE_PATH } from '@/apps/shared/application/common';
import { createLogger } from '@/packages/services/log/node/logger';
import { RunBrokerStore } from './RunBrokerStore';
import { RunBrokerSocketGateway } from './RunBrokerSocketGateway';

const logger = createLogger('shared');

interface ConfigChangeEvent {
  key: string;
  oldValue: string;
  newValue: string;
  configVersion: number;
  timestamp: number;
}

type UtilityProcessParentPort = NodeJS.EventEmitter & {
  postMessage(message: unknown): void;
};

export interface ISharedWorker {
  boot(): void;
}

export const SharedWorkerId = createId('SharedWorker');

@injectable()
export class SharedWorker implements ISharedWorker {
  private readonly runBroker = new RunBrokerStore();
  private readonly runBrokerGateway = new RunBrokerSocketGateway(this.runBroker);
  private configVersion = 0;
  private configStore: Record<string, string> = {
    theme: 'dark',
    language: 'zh-CN',
    timeout: '30000',
  };
  private configListeners = new Set<(event: ConfigChangeEvent) => void>();

  boot(): void {
    const SELF_ID = 'shared';
    const mainChannel = new ElectronUtilityProcessChannel({
      parentPort: process.parentPort as unknown as UtilityProcessParentPort,
      description: 'shared→main IPC channel',
    });

    const handlers = {
      getConfig: (key: string): string => {
        this.configVersion++;
        return `config[${key}] = ${this.configStore[key] || 'undefined'} (v${String(
          this.configVersion
        )})`;
      },
      setConfig: (key: string, value: string): string => {
        const oldValue = this.configStore[key] ?? 'undefined';
        this.configVersion++;
        this.configStore[key] = value;
        const event: ConfigChangeEvent = {
          key,
          oldValue,
          newValue: value,
          configVersion: this.configVersion,
          timestamp: Date.now(),
        };
        for (const listener of this.configListeners) {
          listener(event);
        }
        return `config[${key}] set to ${value} (v${String(this.configVersion)})`;
      },
      echo: (msg: string): string => `shared echo: ${msg}`,
      onConfigChange: (callback: (event: ConfigChangeEvent) => void) => {
        this.configListeners.add(callback);
        return () => { this.configListeners.delete(callback); };
      },
      createRunIntent: this.runBroker.createRunIntent.bind(this.runBroker),
      claimRunIntent: this.runBroker.claimRunIntent.bind(this.runBroker),
      listRunIntents: this.runBroker.listRunIntents.bind(this.runBroker),
      getRunIntent: this.runBroker.getRunIntent.bind(this.runBroker),
      registerRunProjection: this.runBroker.registerRunProjection.bind(this.runBroker),
      listRunProjections: this.runBroker.listRunProjections.bind(this.runBroker),
      getRunProjection: this.runBroker.getRunProjection.bind(this.runBroker),
      subscribeRunProjections: this.runBroker.subscribeRunProjections.bind(this.runBroker),
      requestApproval: this.runBroker.requestApproval.bind(this.runBroker),
      decideApproval: this.runBroker.decideApproval.bind(this.runBroker),
      listApprovals: this.runBroker.listApprovals.bind(this.runBroker),
    };

    const proxy = createParticipantProxy({
      selfId: SELF_ID,
      controlChannel: mainChannel,
      onConnection: (conn) => {
        logger.info(
          `[shared-worker] connection from ${conn.peerId} (role=${conn.role})`
        );
        const ch = proxy.getChannelFor(conn.peerId);
        if (ch) {
          serviceHost.registerService(SHARED_SERVICE_PATH, {
            channel: ch,
            serviceHost,
            handlers,
          });
          logger.info(
            `[shared-worker] ${SHARED_SERVICE_PATH} registered for ${conn.peerId}`
          );
        }
      },
    });

    void this.runBrokerGateway.start()
      .then(path => {
        logger.info(`[shared-worker] run broker gateway listening on ${path}`);
      })
      .catch((error: unknown) => {
        logger.warn(`[shared-worker] run broker gateway failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`);
      });

    logger.info('[shared-worker] initialized, waiting for pagelet connections');
  }
}
