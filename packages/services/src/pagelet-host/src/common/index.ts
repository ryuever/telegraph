export const RENDERER_PARTICIPANT_ID = 'renderer';

export const CONNECTION_PARTICIPANT_ID = 'connection';

export const MONITOR_PARTICIPANT_ID = 'monitor';

export const SETTING_PARTICIPANT_ID = 'setting';

export const DESIGN_PARTICIPANT_ID = 'design';

export const CHAT_PARTICIPANT_ID = 'chat';

/**
 * Application-layer RPC service path for the orchestrator dashboard
 * (renderer ↔ main, exposes connect/disconnect/getStatus + 7 events).
 *
 * Distinct from x-oasis's internal `__x_oasis_orchestrator__` channel —
 * this one is the user-facing IOrchestratorService that AppOrchestrator
 * registers and the renderer's OrchestratorAPI consumes.
 *
 * H4 (D-008): moved here from `apps/main/application/common/types.ts` so
 * packages/services owns the path it actually registers.
 */
export const ORCHESTRATOR_SERVICE_PATH = 'orchestrator';

export const MAIN_RPC_SERVICE_PATH = 'main-rpc';

export const MAIN_PROCESS_SUPERVISOR_SERVICE_PATH = 'main-process-supervisor';

export interface MainOpenRunOptions {
  pageletId?: string;
}

export interface MainOpenRunResult {
  runId: string;
  pageletId?: string;
  pageId: string;
  focused: boolean;
}

export interface MainSwitchPagePayload {
  runId?: string;
  pageletId?: string;
}

export interface MainWindowThemePayload {
  mode: 'light' | 'dark';
  backgroundColor: string;
  accentColor: string;
}

export interface IMainRpcService {
  mainPing(msg: string): Promise<string>;
  openRun(runId: string, options?: MainOpenRunOptions): Promise<MainOpenRunResult>;
}

export type ProcessControlAction = 'kill' | 'resume' | 'restart';

export interface ProcessControlRequest {
  participantId: string;
  action: ProcessControlAction;
  reason?: string;
}

export interface ProcessControlResult {
  participantId: string;
  action: ProcessControlAction;
  ok: boolean;
  state?: string;
  error?: string;
}

export interface IMainProcessSupervisorService {
  controlParticipant(
    request: ProcessControlRequest
  ): Promise<ProcessControlResult>;
}

export const MAIN_WINDOW_SERVICE_PATH = 'main-window';

export interface IMainWindowService {
  openSettingWindow(): Promise<void>;
  applyWindowTheme(theme: MainWindowThemePayload): Promise<void>;
  onSwitchPage(callback: (pageId: string, payload?: MainSwitchPagePayload) => void): void;
}
