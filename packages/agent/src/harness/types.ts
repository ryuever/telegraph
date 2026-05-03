import type { Tool } from '@mariozechner/pi-ai'
import type { AgentRuntimeSettings, AgentTextMessage } from '@telegraph/agent/types'

/**
 * Harness session state — the harness owns the rolling conversation, system
 * prompt, and tool registry. The host (UI, CLI, IDE) reads/writes through the
 * harness rather than poking at pi-ai directly.
 */
export interface HarnessState {
  systemPrompt: string
  messages: AgentTextMessage[]
}

export interface HarnessRunInput {
  userMessage: string
  signal?: AbortSignal
}

export interface HarnessRunHandlers {
  onAssistantStart?: () => void
  onAssistantDelta?: (delta: string) => void
  onAssistantEnd?: (text: string) => void
  onToolCall?: (call: { id: string; name: string; arguments: unknown }) => void
  onError?: (err: unknown) => void
}

/** A tool the harness can advertise to the model. Currently a thin alias. */
export type HarnessTool = Tool

export interface HarnessOptions {
  settings: AgentRuntimeSettings
  systemPrompt?: string
  tools?: HarnessTool[]
}
