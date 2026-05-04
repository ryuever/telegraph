import type { AgentRuntimeSettings } from '@telegraph/agent/types'

/** Payload main sends to daemon to run one streaming turn */
export interface RunAgentStreamPayload {
  /** `WebContents#id` from the renderer that invoked IPC; used to fan chunks back */
  webContentsId: number
  message: string
  settings: AgentRuntimeSettings
}

export type AgentStreamChunk =
  | { type: 'text_delta'; text: string }
  | { type: 'error'; error: string }
  | { type: 'done' }

export interface IAgentStreamService {
  runStream(req: RunAgentStreamPayload): Promise<void>
}

export interface IAgentStreamSink {
  push(webContentsId: number, chunk: AgentStreamChunk): Promise<void>
}
