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
  /** Provider authentication mode for pi-ai core. */
  authMode?: 'api-key' | 'subscription'
  /** OAuth provider id used when authMode is 'subscription'. */
  subscriptionProvider?: string
  /** OAuth credentials payload used to mint an API key on demand. */
  subscriptionCredentials?: {
    refresh: string
    access: string
    expires: number
    [key: string]: unknown
  }
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
   * Values are the stable runtime / contribution ids the extension registers under
   * (e.g. the `telegraph-subagents` extension contributes that id).
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

/**
 * Built-in runtime backend kinds known to the agent kernel.
 *
 * Extensions contribute additional runtime IDs at registration time (e.g. the
 * `telegraph-subagents` extension registers under that id). Those extra IDs
 * are intentionally *not* enumerated here — the agent package has no
 * compile-time knowledge of which extensions are installed. The
 * `(string & {})` widening keeps IntelliSense for the well-known names while
 * accepting any extension-contributed id.
 */
export type AgentBackendKind =
  | 'pi-ai'
  | 'pi-cli'
  | 'pi-embedded'
  | 'langgraph'
  | 'vercel-ai'
  | 'telegraph-orchestrator'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {})

/**
 * Multi-agent orchestration mode. `'none'` disables routing; any other value
 * is the runtime id of an orchestration-contributing extension (e.g.
 * `'telegraph-subagents'` for the first-party subagent platform). See
 * `selectRuntimeId` in `harness/AgentHarness.ts` for how this maps to a
 * registered runtime.
 */
export type AgentOrchestrationMode =
  | 'none'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {})

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
