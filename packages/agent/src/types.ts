import type { Api, Context, Message, Model, Tool } from '@mariozechner/pi-ai'
import type { RuntimeTaskCapabilityProfile } from '@/packages/agent-protocol'

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
  /** Telegraph-native multi-agent orchestration mode. External CLI agents are spawned outside this embedded harness. */
  orchestration?: AgentOrchestrationMode
  /** Multi-agent orchestration pattern used by the Telegraph native subagent harness. */
  orchestrationPattern?: AgentOrchestrationPattern
  /** Hint for parallel task workspace isolation in Telegraph native subagent mode. */
  worktreeIsolation?: boolean
  /**
   * Extension capability ids denied for this run (renderer + optional daemon registry merge).
   * Example: `['telegraph-subagents']` blocks Telegraph native subagent orchestration paths.
   */
  extensionBlocklist?: string[]
  /** Run-scoped capability profile requested by the pagelet/user for permission brokerage. */
  taskCapabilityProfile?: RuntimeTaskCapabilityProfile
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

export type AgentBackendKind = 'pi-ai' | 'pi-cli' | 'pi-embedded' | 'telegraph-subagents' | 'langgraph' | 'vercel-ai' | 'telegraph-orchestrator'
export type AgentOrchestrationMode = 'none' | 'telegraph-subagents'
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
