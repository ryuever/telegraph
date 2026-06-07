import type {
  ContextProviderContribution,
  FeedbackConfirmationRequest,
  FeedbackEvent,
  FeedbackProgressEvent,
  HookHandler,
  HookName,
  MessageRendererContribution,
  RuntimeEventType,
  SubagentProfile,
  ToolDefinition,
} from '@/packages/agent-protocol'

export interface FeedbackAPI {
  notify(input: Omit<FeedbackEvent, 'type' | 'ts'> & { ts?: number }): void | Promise<void>
  progress?(input: Omit<FeedbackProgressEvent, 'type' | 'ts'> & { ts?: number }): void | Promise<void>
  confirm?(input: Omit<FeedbackConfirmationRequest, 'type' | 'ts'> & { ts?: number }): Promise<boolean>
}

export interface ProcessExecResult {
  stdout: string
  stderr: string
  code: number | null
}

export interface ProcessCapability {
  exec(
    command: string,
    args: string[],
    options: {
      timeoutMs?: number
      cwd?: string
      env?: Record<string, string>
      permission: { type: 'shell'; risk: 'low' | 'medium' | 'high' }
    },
  ): Promise<ProcessExecResult>
}

export interface FilesystemCapability {
  readText(path: string): Promise<string>
  writeText?(path: string, content: string): Promise<void>
}

export interface PatchFileOperation {
  path: string
  kind: 'add' | 'update' | 'delete'
  content?: string
  expectedOriginal?: string
}

export interface PatchPreview {
  operations: PatchFileOperation[]
  summary: {
    adds: number
    updates: number
    deletes: number
  }
}

export interface PatchApplyResult extends PatchPreview {
  applied: boolean
}

export interface PatchCapability {
  preview(operations: PatchFileOperation[]): Promise<PatchPreview>
  apply(operations: PatchFileOperation[]): Promise<PatchApplyResult>
}

export interface ToolCapability {
  definition: ToolDefinition
  execute(input: unknown): Promise<unknown>
}

/**
 * Runtime contribution descriptor — what an extension supplies via
 * `telegraph.registerRuntime()`. The actual factory remains opaque to this
 * layer; the host pagelet wires it into RuntimeRegistry at assembly time.
 */
export interface RuntimeContribution {
  id: string
  aliases?: string[]
  /** Opaque factory; typed as unknown to avoid pulling AgentRunRequest here. */
  create: (request: unknown) => unknown
  label?: string
}

/** Subagent profile registered via `telegraph.registerSubagentProfile()`. */
export type { SubagentProfile }

/** Context provider implementation registered via `telegraph.registerContextProvider()`. */
export interface ContextProvider extends ContextProviderContribution {
  /** Returns a string to prepend to a subagent's input, given parent context. */
  provide(parentSessionId: string | undefined, parentRunId: string): Promise<string> | string
}

/** Message renderer registered via `telegraph.registerMessageRenderer()`. */
export type MessageRenderer = MessageRendererContribution

/** Command registered via `telegraph.registerCommand()`. */
export interface CommandRegistration {
  id: string
  title: string
  command: string
  /** Optional handler. Undefined = renderer-side handled. */
  invoke?: (args?: unknown) => Promise<unknown> | unknown
}

/** Model provider registered via `telegraph.registerProvider()`. */
export interface ProviderRegistration {
  id: string
  label?: string
  /** Free-form descriptor (auth mode, base URL, etc). Schema lives provider-side. */
  config: Record<string, unknown>
}

export type CapabilityKind =
  | 'feedback'
  | 'process'
  | 'filesystem'
  | 'patch'
  | 'tool'
  | 'runtime'
  | 'subagent'
  | 'context-provider'
  | 'message-renderer'
  | 'command'
  | 'provider'
  | 'custom'

export interface CapabilityHookRegistrar {
  on<N extends HookName>(name: N, handler: HookHandler<N>): () => void
}

export interface AgentCapabilityContext {
  host: CapabilityHost
  hooks: CapabilityHookRegistrar
}

/**
 * Extension factory signature — the canonical contract for both
 * host-injected capabilities and extension-contributed capabilities. The
 * `TelegraphExtension` alias is the preferred public name (D-016 §5.6); the
 * `AgentCapability` name is kept for backward compatibility.
 *
 * Factories may optionally return a cleanup function which the host calls
 * during teardown (extension deactivation or pagelet shutdown).
 */
export type AgentCapability = (
  context: AgentCapabilityContext,
) => void | Promise<void> | (() => void | Promise<void>) | Promise<() => void | Promise<void>>

/** Preferred public name per D-016 §5.6. Same shape as AgentCapability. */
export type TelegraphExtension = AgentCapability

export class CapabilityHost {
  private feedbackApi?: FeedbackAPI
  private processCapability?: ProcessCapability
  private filesystemCapability?: FilesystemCapability
  private patchCapability?: PatchCapability
  private readonly tools = new Map<string, ToolCapability>()
  private readonly runtimes = new Map<string, RuntimeContribution>()
  private readonly subagentProfiles = new Map<string, SubagentProfile>()
  private readonly contextProviders = new Map<string, ContextProvider>()
  private readonly messageRenderers = new Map<string, MessageRenderer>()
  private readonly commands = new Map<string, CommandRegistration>()
  private readonly providers = new Map<string, ProviderRegistration>()
  private readonly custom = new Map<string, unknown>()

  constructor(private readonly hooks: CapabilityHookRegistrar) {}

  registerFeedback(api: FeedbackAPI): void {
    this.feedbackApi = api
  }

  get feedback(): FeedbackAPI | undefined {
    return this.feedbackApi
  }

  registerProcess(capability: ProcessCapability): void {
    this.processCapability = capability
  }

  get process(): ProcessCapability | undefined {
    return this.processCapability
  }

  registerFilesystem(capability: FilesystemCapability): void {
    this.filesystemCapability = capability
  }

  get filesystem(): FilesystemCapability | undefined {
    return this.filesystemCapability
  }

  registerPatch(capability: PatchCapability): void {
    this.patchCapability = capability
  }

  get patch(): PatchCapability | undefined {
    return this.patchCapability
  }

  registerTool(tool: ToolCapability): void {
    this.tools.set(tool.definition.name, tool)
  }

  getTool(name: string): ToolCapability | undefined {
    return this.tools.get(name)
  }

  listTools(): ToolDefinition[] {
    return [...this.tools.values()].map(tool => tool.definition)
  }

  listToolCapabilities(): ToolCapability[] {
    return [...this.tools.values()]
  }

  registerRuntime(contribution: RuntimeContribution): void {
    if (!contribution.id) throw new Error('RuntimeContribution.id is required')
    this.runtimes.set(contribution.id, contribution)
    for (const alias of contribution.aliases ?? []) {
      this.runtimes.set(alias, contribution)
    }
  }

  listRuntimes(): RuntimeContribution[] {
    // Dedupe — aliases share the same contribution reference.
    return [...new Set(this.runtimes.values())]
  }

  getRuntime(id: string): RuntimeContribution | undefined {
    return this.runtimes.get(id)
  }

  registerSubagentProfile(profile: SubagentProfile): void {
    if (!profile.name) throw new Error('SubagentProfile.name is required')
    this.subagentProfiles.set(profile.name, profile)
  }

  listSubagentProfiles(): SubagentProfile[] {
    return [...this.subagentProfiles.values()]
  }

  getSubagentProfile(name: string): SubagentProfile | undefined {
    return this.subagentProfiles.get(name)
  }

  registerContextProvider(provider: ContextProvider): void {
    if (!provider.name) throw new Error('ContextProvider.name is required')
    this.contextProviders.set(provider.name, provider)
  }

  listContextProviders(): ContextProvider[] {
    return [...this.contextProviders.values()]
  }

  getContextProvider(name: string): ContextProvider | undefined {
    return this.contextProviders.get(name)
  }

  registerMessageRenderer(renderer: MessageRenderer): void {
    if (!renderer.id) throw new Error('MessageRenderer.id is required')
    this.messageRenderers.set(renderer.id, renderer)
  }

  listMessageRenderers(): MessageRenderer[] {
    return [...this.messageRenderers.values()]
  }

  registerCommand(command: CommandRegistration): void {
    if (!command.id) throw new Error('CommandRegistration.id is required')
    this.commands.set(command.id, command)
  }

  listCommands(): CommandRegistration[] {
    return [...this.commands.values()]
  }

  getCommand(id: string): CommandRegistration | undefined {
    return this.commands.get(id)
  }

  registerProvider(provider: ProviderRegistration): void {
    if (!provider.id) throw new Error('ProviderRegistration.id is required')
    this.providers.set(provider.id, provider)
  }

  listProviders(): ProviderRegistration[] {
    return [...this.providers.values()]
  }

  getProvider(id: string): ProviderRegistration | undefined {
    return this.providers.get(id)
  }

  registerCustom(key: string, capability: unknown): void {
    this.custom.set(key, capability)
  }

  getCustom(key: string): unknown {
    return this.custom.get(key)
  }

  on<N extends HookName>(name: N, handler: HookHandler<N>): () => void {
    return this.hooks.on(name, handler)
  }

  /**
   * Convenience: subscribe to a specific RuntimeEvent type. Implemented as an
   * `onRuntimeEvent` hook that filters by event.type. Matches the
   * `telegraph.on(type, handler)` ergonomics in D-016 §5.4.
   *
   * Handler payload is the bare `RuntimeEvent` (not the hook envelope) — the
   * RuntimeEventHookPayload's other fields (request / runtimeId) are dropped
   * for ergonomics. If a caller needs the full envelope, use `on('onRuntimeEvent', ...)`.
   */
  onEvent<T extends RuntimeEventType>(
    type: T,
    handler: (event: Extract<import('@/packages/agent-protocol').RuntimeEvent, { type: T }>) => void | Promise<void>,
  ): () => void {
    return this.hooks.on('onRuntimeEvent', payload => {
      if (payload.event.type === type) {
        // Defer to avoid blocking the runtime stream's yield loop (D-016 §8.3.1).
        queueMicrotask(() => {
          void handler(payload.event as Extract<import('@/packages/agent-protocol').RuntimeEvent, { type: T }>)
        })
      }
    })
  }

  has(kind: CapabilityKind, key?: string): boolean {
    switch (kind) {
      case 'feedback':
        return Boolean(this.feedbackApi)
      case 'process':
        return Boolean(this.processCapability)
      case 'filesystem':
        return Boolean(this.filesystemCapability)
      case 'patch':
        return Boolean(this.patchCapability)
      case 'tool':
        return key ? this.tools.has(key) : this.tools.size > 0
      case 'runtime':
        return key ? this.runtimes.has(key) : this.runtimes.size > 0
      case 'subagent':
        return key ? this.subagentProfiles.has(key) : this.subagentProfiles.size > 0
      case 'context-provider':
        return key ? this.contextProviders.has(key) : this.contextProviders.size > 0
      case 'message-renderer':
        return key ? this.messageRenderers.has(key) : this.messageRenderers.size > 0
      case 'command':
        return key ? this.commands.has(key) : this.commands.size > 0
      case 'provider':
        return key ? this.providers.has(key) : this.providers.size > 0
      case 'custom':
        return key ? this.custom.has(key) : this.custom.size > 0
      default:
        return false
    }
  }
}

/**
 * Preferred public name per D-016 §5.6. CapabilityHost is the implementation
 * class; consumers should refer to it via this alias when treating it as the
 * extension API surface.
 */
export type TelegraphExtensionHost = CapabilityHost
export { CapabilityHost as TelegraphExtensionHostImpl }
