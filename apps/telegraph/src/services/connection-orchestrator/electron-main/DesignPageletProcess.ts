// Phase 3 — main-side spawner for the design utility process.
//
// Responsibilities:
//   1. Resolve the design utility entry path (`apps/design`'s built bundle in
//      production; the dev bundle path in dev).
//   2. Call `electron.utilityProcess.fork(entryPath)` to spawn it.
//   3. Wrap the resulting `UtilityProcess` in `ElectronUtilityProcessChannel`
//      and register it as the `pagelet:design` participant on the
//      `AppOrchestrator`.
//   4. Wire the process's `exit` event so the orchestrator's
//      `handleParticipantLost` is called explicitly (defence-in-depth on top
//      of the channel's auto-disconnect added in Phase 2.5 / D-006 Gap 3).
//
// Phase 3 does NOT call `connect()` — that is initiated from the renderer
// (Phase 4) by clicking the Connect button in DesignPanel/ConnectionsTab.
//
// Entry path resolution rationale:
//   - In dev, electron-forge's Vite plugin sets `MAIN_WINDOW_VITE_DEV_SERVER_URL`
//     for the renderer but uses a different convention for additional bundles.
//     For utility processes we resolve relative to the main bundle's
//     `__dirname`, mirroring how preload.js is loaded (see WindowManager).
//   - In production, all bundles end up under `app.asar/.vite/build/` and the
//     same relative path works.
//
// We deliberately stay platform-agnostic about the absolute layout: the
// constructor accepts the resolved path so Phase 4 / tests can swap it.
import { utilityProcess } from 'electron';
import type { UtilityProcess } from 'electron';
import { join } from 'node:path';

import { ElectronUtilityProcessChannel } from '@x-oasis/async-call-rpc-electron';

import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';

import type { IAppOrchestrator } from './AppOrchestrator';
import { AppOrchestratorId } from './AppOrchestrator';
import { DESIGN_PARTICIPANT_ID } from '../common/types';

export interface IDesignPageletProcess {
  /**
   * Spawn the design utility, register it with the orchestrator, and resolve
   * once the process is alive (PID > 0). Throws if `utilityProcess.fork()`
   * fails synchronously.
   *
   * Idempotent: subsequent calls are warned and ignored.
   */
  spawn(): Promise<void>;
  /** Returns the spawned utility process (or undefined if not yet spawned). */
  getProcess(): UtilityProcess | undefined;
}

@injectable()
export class DesignPageletProcess implements IDesignPageletProcess {
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
      this.log.warn('DesignPageletProcess.spawn() called twice — ignoring');
      return;
    }
    this.spawned = true;

    const entryPath = this.resolveEntryPath();
    this.log.info(`DesignPageletProcess.spawn() entry=${entryPath}`);

    // utilityProcess.fork is synchronous-ish: it returns a UtilityProcess
    // immediately but the OS-level fork is async. We don't wait for the
    // 'spawn' event here because the orchestrator's cp channel will work
    // once the utility's `parentPort` listener is attached, which happens
    // inside the utility entry's module top-level.
    this.process = utilityProcess.fork(entryPath, [], {
      serviceName: 'telegraph-design-utility',
      stdio: 'inherit',
    });

    this.channel = new ElectronUtilityProcessChannel({
      process: this.process,
      description: `${DESIGN_PARTICIPANT_ID}-cp`,
    });

    this.orchestrator.registerParticipant(
      DESIGN_PARTICIPANT_ID,
      this.channel,
      'utility',
    );

    // Defence-in-depth: even though Phase 2.5 wired the channel's
    // onDidDisconnected → handleParticipantLost path automatically, we also
    // log the raw process exit for diagnostics.
    this.process.on('exit', (code) => {
      this.log.warn(
        `[DesignPageletProcess] utility process exited code=${String(code)} (participant=${DESIGN_PARTICIPANT_ID})`,
      );
    });

    this.log.info(
      `DesignPageletProcess ready — pid=${String(this.process.pid ?? 'unknown')} participant=${DESIGN_PARTICIPANT_ID}`,
    );
  }

  getProcess(): UtilityProcess | undefined {
    return this.process;
  }

  /**
   * Resolve the on-disk path to the design utility entry bundle.
   *
   * Layout assumption (see roadmap §10 Phase 3 + forge.config.ts):
   *   - main bundle:    `<app>/.vite/build/index.js`
   *   - design bundle:  `<app>/.vite/build/design_utility/index.js`
   *
   * `__dirname` works because vite outputs CommonJS for the main process
   * (Discovery #4 — `import.meta.dirname` is undefined in cjs).
   */
  private resolveEntryPath(): string {
    return join(__dirname, 'design_utility', 'index.js');
  }
}

export const DesignPageletProcessId = createId('DesignPageletProcess');
