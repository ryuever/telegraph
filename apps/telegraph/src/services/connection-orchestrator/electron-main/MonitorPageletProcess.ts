import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { join } from 'node:path';

import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron/electron-main';

import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';

import type { IAppOrchestrator } from './AppOrchestrator';
import { AppOrchestratorId } from './AppOrchestrator';
import { MONITOR_PARTICIPANT_ID } from '../common/types';

export interface IMonitorPageletProcess {
  spawn(): Promise<void>;
  getProcess(): UtilityProcess | undefined;
}

@injectable()
export class MonitorPageletProcess implements IMonitorPageletProcess {
  private process?: UtilityProcess;
  private channel?: ElectronUtilityProcessChannel;
  private spawned = false;

  constructor(
    @inject(LogServiceId) private readonly log: ILogService,
    @inject(AppOrchestratorId) private readonly orchestrator: IAppOrchestrator,
  ) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async spawn(): Promise<void> {
    if (this.spawned) {
      this.log.warn('MonitorPageletProcess.spawn() called twice — ignoring');
      return;
    }
    this.spawned = true;

    const entryPath = this.resolveEntryPath();
    this.log.info(`MonitorPageletProcess.spawn() entry=${entryPath}`);

    this.process = utilityProcess.fork(entryPath, [], {
      serviceName: 'telegraph-monitor-utility',
      stdio: 'inherit',
    });

    this.channel = new ElectronUtilityProcessChannel({
      process: this.process,
      description: `${MONITOR_PARTICIPANT_ID}-cp`,
    });

    this.orchestrator.registerParticipant(
      MONITOR_PARTICIPANT_ID,
      this.channel,
      'utility',
    );

    this.process.on('exit', (code) => {
      this.log.warn(
        `[MonitorPageletProcess] utility process exited code=${String(code)} (participant=${MONITOR_PARTICIPANT_ID})`,
      );
    });

    this.log.info(
      `MonitorPageletProcess ready — pid=${String(this.process.pid ?? 'unknown')} participant=${MONITOR_PARTICIPANT_ID}`,
    );
  }

  getProcess(): UtilityProcess | undefined {
    return this.process;
  }

  private resolveEntryPath(): string {
    return join(__dirname, 'monitor_utility', 'index.js');
  }
}

export const MonitorPageletProcessId = createId('MonitorPageletProcess');
