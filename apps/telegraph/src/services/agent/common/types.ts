import type { AgentRuntimeSettings } from '@telegraph/agent/types'

export type AgentRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

/** Payload main sends to daemon to run one streaming turn */
export interface RunAgentStreamPayload {
  /** `WebContents#id` from the renderer that invoked IPC; used to fan chunks back */
  webContentsId: number
  /** Client-generated run id used for stream fan-out/filtering */
  runId: string
  message: string
  settings: AgentRuntimeSettings
}

export interface RunAgentStreamResult {
  runId: string
  status: 'completed' | 'failed'
  text?: string
  error?: string
}

export type AgentRunEvent =
  | { type: 'run_queued'; runId: string; status: 'queued' }
  | { type: 'run_started'; runId: string; status: 'running' }
  | { type: 'text_delta'; runId: string; text: string }
  | { type: 'run_failed'; runId: string; status: 'failed'; error: string }
  | { type: 'run_completed'; runId: string; status: 'completed' }
  // Legacy compatibility for existing renderer listeners.
  | { type: 'error'; runId: string; error: string }
  | { type: 'done'; runId: string }

export type AgentStreamChunk = AgentRunEvent

export interface IAgentStreamService {
  runStream(req: RunAgentStreamPayload): Promise<RunAgentStreamResult>
}

export interface AgentSinkPushPayload {
  webContentsId: number
  chunk: AgentStreamChunk
}

export interface IAgentStreamSink {
  push(payload: AgentSinkPushPayload): Promise<void>
}
