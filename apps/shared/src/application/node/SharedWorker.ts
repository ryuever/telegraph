import { createId, injectable } from '@x-oasis/di';
import {
  ElectronUtilityProcessChannel,
  createParticipantProxy,
} from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';

import { SHARED_SERVICE_PATH } from '@/apps/shared/application/common';
import { createLogger } from '@/packages/services/log/node/logger';

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

    logger.info('[shared-worker] initialized, waiting for pagelet connections');
  }
}
