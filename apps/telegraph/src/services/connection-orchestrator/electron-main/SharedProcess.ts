// Shared process spawner - manages the shared utility process.
//
// Responsibilities:
//   1. Resolve the shared utility entry path.
//   2. Call `electron.utilityProcess.fork(entryPath)` to spawn it.
//   3. Wrap the resulting `UtilityProcess` in `ElectronUtilityProcessChannel`
//      and register it as the `shared` participant on the `AppOrchestrator`.
//   4. Handle reconnection when the process is killed and restarted.

import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { join } from 'node:path';

import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron/electron-main';

import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';

import type { IAppOrchestrator } from './AppOrchestrator';
import { AppOrchestratorId } from './AppOrchestrator';
import { SHARED_PARTICIPANT_ID } from '../common/types';

export interface ISharedProcess {
  spawn(): Promise<void>;
  getProcess(): UtilityProcess | undefined;
  getChannel(): ElectronUtilityProcessChannel | undefined;
}

@injectable()
export class SharedProcess implements ISharedProcess {
  private process?: UtilityProcess;
  private channel?: ElectronUtilityProcessChannel;
  private spawned = false;

  constructor(
    @inject(LogServiceId) private readonly log: ILogService,
    @inject(AppOrchestratorId) private readonly orchestrator: IAppOrchestrator,
  ) {}

  async spawn(): Promise<void> {
    if (this.spawned) {
      this.log.warn('SharedProcess.spawn() called twice — ignoring');
      return;
    }
    this.spawned = true;

    const entryPath = this.resolveEntryPath();
    this.log.info(`SharedProcess.spawn() entry=${entryPath}`);

    this.process = utilityProcess.fork(entryPath, [], {
      serviceName: 'telegraph-shared-utility',
      stdio: 'inherit',
    });

    this.channel = new ElectronUtilityProcessChannel({
      process: this.process,
      description: `${SHARED_PARTICIPANT_ID}-cp`,
    });

    this.orchestrator.registerParticipant(
      SHARED_PARTICIPANT_ID,
      this.channel,
      'utility',
    );

    this.process.on('exit', (code) => {
      this.log.warn(
        `[SharedProcess] utility process exited code=${String(code)} (participant=${SHARED_PARTICIPANT_ID})`,
      );
    });

    this.log.info(
      `SharedProcess ready — pid=${String(this.process.pid ?? 'unknown')} participant=${SHARED_PARTICIPANT_ID}`,
    );
  }

  getProcess(): UtilityProcess | undefined {
    return this.process;
  }

  getChannel(): ElectronUtilityProcessChannel | undefined {
    return this.channel;
  }

  private resolveEntryPath(): string {
    return join(__dirname, 'shared_utility', 'index.js');
  }
}

export const SharedProcessId = createId('SharedProcess');