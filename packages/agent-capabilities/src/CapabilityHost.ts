import type {
  FeedbackConfirmationRequest,
  FeedbackEvent,
  FeedbackProgressEvent,
  HookHandler,
  HookName,
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

export type CapabilityKind =
  | 'feedback'
  | 'process'
  | 'filesystem'
  | 'patch'
  | 'tool'
  | 'custom'

export interface CapabilityHookRegistrar {
  on<N extends HookName>(name: N, handler: HookHandler<N>): () => void
}

export interface AgentCapabilityContext {
  host: CapabilityHost
  hooks: CapabilityHookRegistrar
}

export type AgentCapability = (context: AgentCapabilityContext) => void | Promise<void>

export class CapabilityHost {
  private feedbackApi?: FeedbackAPI
  private processCapability?: ProcessCapability
  private filesystemCapability?: FilesystemCapability
  private patchCapability?: PatchCapability
  private readonly tools = new Map<string, ToolCapability>()
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

  registerCustom(key: string, capability: unknown): void {
    this.custom.set(key, capability)
  }

  getCustom(key: string): unknown {
    return this.custom.get(key)
  }

  on<N extends HookName>(name: N, handler: HookHandler<N>): () => void {
    return this.hooks.on(name, handler)
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
      case 'custom':
        return key ? this.custom.has(key) : this.custom.size > 0
      default:
        return false
    }
  }
}
