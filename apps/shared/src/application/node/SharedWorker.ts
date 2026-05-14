import { createId, injectable } from '@x-oasis/di';
import {
  ElectronUtilityProcessChannel,
  createParticipantProxy,
} from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';

import { SHARED_SERVICE_PATH } from '@/apps/shared/application/common';

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

  boot(): void {
    if (!process.parentPort) {
      throw new Error('parentPort is not available');
    }

    const SELF_ID = 'shared';
    const mainChannel = new ElectronUtilityProcessChannel({
      parentPort: process.parentPort as any,
      description: 'shared→main IPC channel',
    });

    const handlers = {
      getConfig: (key: string): string => {
        this.configVersion++;
        return `config[${key}] = ${this.configStore[key] || 'undefined'} (v${
          this.configVersion
        })`;
      },
      setConfig: (key: string, value: string): string => {
        this.configVersion++;
        this.configStore[key] = value;
        return `config[${key}] set to ${value} (v${this.configVersion})`;
      },
      echo: (msg: string): string => `shared echo: ${msg}`,
      onConfigChange: (callback: (event: any) => void) => {
        const interval = setInterval(() => {
          const keys = Object.keys(this.configStore);
          const randomKey = keys[Math.floor(Math.random() * keys.length)];
          const oldVal = this.configStore[randomKey];
          const newVal = `${oldVal}-updated-${Date.now() % 1000}`;
          this.configStore[randomKey] = newVal;
          this.configVersion++;
          callback({
            key: randomKey,
            oldValue: oldVal,
            newValue: newVal,
            configVersion: this.configVersion,
            timestamp: Date.now(),
          });
        }, 3000);
        return () => clearInterval(interval);
      },
    };

    const proxy = createParticipantProxy({
      selfId: SELF_ID,
      controlChannel: mainChannel,
      onConnection: (conn) => {
        console.log(
          `[shared-worker] connection from ${conn.peerId} (role=${conn.role})`
        );
        const ch = proxy.getChannelFor(conn.peerId);
        if (ch) {
          serviceHost.registerService(SHARED_SERVICE_PATH, {
            channel: ch,
            serviceHost,
            handlers,
          });
          console.log(
            `[shared-worker] ${SHARED_SERVICE_PATH} registered for ${conn.peerId}`
          );
        }
      },
    });

    console.log('[shared-worker] initialized, waiting for pagelet connections');
  }
}
