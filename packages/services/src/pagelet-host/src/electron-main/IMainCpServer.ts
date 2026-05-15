import { createId } from '@x-oasis/di';
import type {
  ElectronConnectionOrchestrator,
  IPCMainChannel,
} from '@x-oasis/async-call-rpc-electron';
import type { BrowserWindow } from 'electron';

/**
 * Contract for the main-process "connection scope" host that owns the
 * renderer and (optional) setting orchestrators / IPC channels.
 *
 * This interface lives in `packages/services/pagelet-host` rather than in
 * `apps/main` because the pagelet-host framework code (AppOrchestrator,
 * PageletProcess, future supervisors) is the **consumer** — apps/main is
 * just one possible **implementation**. Owning the interface here keeps the
 * dependency direction straight (packages → x-oasis only; apps/* depend on
 * packages/*) and makes `packages/services` independently publishable.
 *
 * H4 (D-008): moved out of `apps/main/application/electron-main/MainCpServer.ts`
 * so packages/services no longer needs `@/apps/main` in its tsconfig paths.
 */
export interface IMainCpServer {
  start(): void;
  getOrchestrator(): ElectronConnectionOrchestrator;
  getSettingOrchestrator(): ElectronConnectionOrchestrator;
  getRendererIpcChannel(): IPCMainChannel;
  getSettingIpcChannel(): IPCMainChannel | null;
  registerSettingWindow(win: BrowserWindow): IPCMainChannel;
  /**
   * Declare that whenever pagelet `pageletId` is spawned, it must also be
   * registered into `orchestrator` (in addition to the default
   * `getOrchestrator()`).
   *
   * This is the only seam through which a host app teaches the framework
   * about extra window-scoped orchestrators — e.g. apps/main wires
   * `'setting'` → settingOrchestrator here, instead of the framework
   * carrying an `if (pageletId === 'setting')` branch. Adding a third
   * window-bound pagelet now means **one extra call from the host**, not a
   * patch inside `packages/services`.
   *
   * Multiple calls with the same `pageletId` accumulate. Must be invoked
   * before `PageletProcess.spawn(pageletId, …)` for the binding to take
   * effect on that spawn.
   */
  attachOrchestratorToPagelet(
    pageletId: string,
    orchestrator: ElectronConnectionOrchestrator
  ): void;
  /**
   * Returns the orchestrators a freshly-spawned pagelet should be
   * registered with **in addition to** the default `getOrchestrator()`.
   *
   * Driven by `attachOrchestratorToPagelet()`. Returns `[]` if no extra
   * orchestrators have been attached. Called by `PageletProcess.spawn`.
   */
  getAdditionalOrchestratorsFor(
    pageletId: string
  ): ElectronConnectionOrchestrator[];
}

export const MainCpServerId = createId('MainCpServer');
