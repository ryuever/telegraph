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
   * Returns the orchestrators a freshly-spawned pagelet should be registered
   * with **in addition to** the default `getOrchestrator()`.
   *
   * Used by `PageletProcess.spawn` to wire pagelets like `setting` into a
   * second window-scoped orchestrator without `if (pageletId === 'setting')`
   * hardcodes inside the pagelet-host framework. Apps add new windows by
   * extending their `IMainCpServer` implementation, not by patching here.
   */
  getAdditionalOrchestratorsFor(
    pageletId: string
  ): ElectronConnectionOrchestrator[];
}

export const MainCpServerId = createId('MainCpServer');
