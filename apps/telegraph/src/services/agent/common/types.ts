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
  /** Sidebar conversation id from the renderer; echoed on `llm_trace` so traces survive active-chat switches. */
  sessionId: string
  message: string
  settings: AgentRuntimeSettings
}

export interface RunAgentStreamResult {
  runId: string
  status: 'completed' | 'failed'
  text?: string
  error?: string
}

/** Structured payloads for the chat LLM trace sidebar (daemon → renderer via stream IPC). */
export type LlmTracePayload =
  | {
      kind: 'telegraph_turn_context'
      /** Snapshot of UI thread messages passed into the agent adapter for this send. */
      messages: Array<{ id: string; role: string; content: string; status?: string }>
      runtimeSettingsSummary: {
        provider: string
        modelId: string
        backend: string
        orchestration: string
        pattern: string | null
      }
    }
  | {
      kind: 'pi_cli_request'
      userMessage: string
      /** Final `-p` argv segment Pi receives (after orchestration wrapper expansion). */
      promptPassedToPi: string
      provider?: string
      modelId?: string
      orchestration?: string
      pattern?: string | null
    }
  | {
      kind: 'pi_json_line'
      /** One parsed line from `pi --mode json` (subset of event types; deltas may be truncated). */
      payload: unknown
    }
  | {
      kind: 'pi_ai_request'
      /** Exact context passed into pi-ai `stream()` from Telegraph. */
      context: unknown
      /** Sanitized stream options. API keys are never echoed into trace rows. */
      options: { hasApiKey: boolean; signal: boolean }
      /** Flattened summary retained for easy scanning in the trace panel. */
      systemPrompt: string
      messages: Array<{ role: string; content: string }>
      provider?: string
      modelId?: string
    }
  | {
      kind: 'pi_ai_stream_event'
      /** Raw iterator event from `@mariozechner/pi-ai` stream. */
      event: unknown
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
  | { type: 'llm_trace'; runId: string; sessionId: string; trace: LlmTracePayload }

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
