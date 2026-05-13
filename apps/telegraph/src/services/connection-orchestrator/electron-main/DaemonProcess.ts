// Daemon process spawner - manages the daemon utility process.
//
// Responsibilities:
//   1. Resolve the daemon utility entry path.
//   2. Call `electron.utilityProcess.fork(entryPath)` to spawn it.
//   3. Wrap the resulting `UtilityProcess` in `ElectronUtilityProcessChannel`
//      and register it as the `daemon` participant on the `AppOrchestrator`.
//   4. Monitor process health and handle restarts.

import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { join } from 'node:path';

import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron/electron-main';

import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';

import type { IAppOrchestrator } from './AppOrchestrator';
import { AppOrchestratorId } from './AppOrchestrator';
import { DAEMON_PARTICIPANT_ID } from '../common/types';

export interface IDaemonProcess {
  spawn(): Promise<void>;
  getProcess(): UtilityProcess | undefined;
  getChannel(): ElectronUtilityProcessChannel | undefined;
}

@injectable()
export class DaemonProcess implements IDaemonProcess {
  private process?: UtilityProcess;
  private channel?: ElectronUtilityProcessChannel;
  private spawned = false;

  constructor(
    @inject(LogServiceId) private readonly log: ILogService,
    @inject(AppOrchestratorId) private readonly orchestrator: IAppOrchestrator,
  ) {}

  async spawn(): Promise<void> {
    if (this.spawned) {
      this.log.warn('DaemonProcess.spawn() called twice — ignoring');
      return;
    }
    this.spawned = true;

    const entryPath = this.resolveEntryPath();
    this.log.info(`DaemonProcess.spawn() entry=${entryPath}`);

    this.process = utilityProcess.fork(entryPath, [], {
      serviceName: 'telegraph-daemon-utility',
      stdio: 'inherit',
    });

    this.log.info(
      `DaemonProcess fork() returned — process launched (async), pid=${String(this.process.pid ?? 'unknown')}`,
    );

    this.channel = new ElectronUtilityProcessChannel({
      process: this.process,
      description: `${DAEMON_PARTICIPANT_ID}-cp`,
    });

    this.orchestrator.registerParticipant(
      DAEMON_PARTICIPANT_ID,
      this.channel,
      'utility',
    );

    this.process.on('exit', (code) => {
      this.log.warn(
        `[DaemonProcess] utility process exited code=${String(code)} (participant=${DAEMON_PARTICIPANT_ID})`,
      );
    });

    this.log.info(
      `DaemonProcess ready — participant=${DAEMON_PARTICIPANT_ID} registered with orchestrator`,
    );
  }

  getProcess(): UtilityProcess | undefined {
    return this.process;
  }

  getChannel(): ElectronUtilityProcessChannel | undefined {
    return this.channel;
  }

  private resolveEntryPath(): string {
    return join(__dirname, 'daemon_utility', 'index.js');
  }
}

export const DaemonProcessId = createId('DaemonProcess');