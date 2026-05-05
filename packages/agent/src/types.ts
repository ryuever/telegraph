import type { Api, Context, Message, Model, Tool } from '@mariozechner/pi-ai'

export type AgentRole = 'user' | 'assistant' | 'system' | 'tool'

export interface AgentTextMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

/**
 * A model entry the UI can render in a picker.
 *
 * - `kind: 'builtin'` looks the model up via pi-ai's `getModel(provider, id)`,
 *   which is type-safe but locked to providers/ids known at pi-ai build time.
 * - `kind: 'custom'` carries a fully-formed pi-ai Model. Use this for
 *   OpenAI-compatible deployments (Ollama, vLLM, proxies) and for overriding
 *   `baseUrl` / `headers` on a known provider without forking pi-ai.
 */
export type ModelDescriptor =
  | {
      kind: 'builtin'
      provider: string
      id: string
      label: string
    }
  | {
      kind: 'custom'
      provider: string
      id: string
      label: string
      model: Model<Api>
    }

/** Concrete settings used to build a runtime Model + apiKey at call time. */
export interface AgentRuntimeSettings {
  provider: string
  modelId: string
  apiKey: string
  /** Optional override — only honored by providers whose Model definition reads it (currently MiniMax custom). */
  baseUrl?: string
  /** Execution backend selector; defaults to 'pi-ai'. */
  backend?: AgentBackendKind
  /** Multi-agent orchestration mode (currently daemon-side for pi-cli). */
  orchestration?: AgentOrchestrationMode
  /** Multi-agent orchestration pattern used by pi-subagents mode. */
  orchestrationPattern?: AgentOrchestrationPattern
  /** Hint for parallel task workspace isolation in pi-subagents mode. */
  worktreeIsolation?: boolean
  /**
   * Extension capability ids denied for this run (renderer + optional daemon registry merge).
   * Example: `['pi-subagents']` blocks pi-subagents orchestration paths.
   */
  extensionBlocklist?: string[]
}

export interface AgentStreamCallbacks {
  onStart?: () => void
  onTextDelta?: (delta: string) => void
  onThinkingDelta?: (delta: string) => void
  onToolCallStart?: (call: { id: string; name: string }) => void
  onToolCallEnd?: (call: { id: string; name: string; arguments: unknown }) => void
  onDone?: (reason: string, message: Message) => void
  onError?: (reason: string, message: Message) => void
}

export interface AgentSendInput {
  systemPrompt?: string
  messages: AgentTextMessage[]
  tools?: Tool[]
  signal?: AbortSignal
  callbacks?: AgentStreamCallbacks
  /** Exact pi-ai request context/options prepared immediately before `stream()`. */
  onPiAiRequest?: (request: { context: Context; options: { hasApiKey: boolean; signal: boolean } }) => void | Promise<void>
  /** Raw pi-ai stream events (`text_delta`, `toolcall_*`, `done`, …) for debugging / UI trace. */
  onPiAiStreamEvent?: (event: unknown) => void | Promise<void>
}

export type AgentBackendKind = 'pi-ai' | 'pi-cli' | 'pi-embedded' | 'langgraph' | 'vercel-ai'
export type AgentOrchestrationMode = 'none' | 'pi-subagents'
export type AgentOrchestrationPattern = 'chain' | 'parallel'

export interface AgentBackend {
  readonly kind: AgentBackendKind
  readonly currentSettings: AgentRuntimeSettings
  withSettings(next: AgentRuntimeSettings): AgentBackend
  send(input: AgentSendInput): Promise<Message>
}

export type AgentContext = Context
export type AgentMessage = Message
export type AgentModel = Model<Api>
export type AgentTool = Tool
