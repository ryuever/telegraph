import type {
  AgentEvent,
  AgentRunRequest,
  HookName,
  RuntimeSettings,
} from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'

export type AgentRuntimeFactory = (request: AgentRunRequest) => RuntimeExecutor

export interface RuntimeRegistration {
  id: string
  aliases?: string[]
  create: AgentRuntimeFactory
}

export interface AgentTraceSink {
  push(event: AgentEvent, request: AgentRunRequest): void | Promise<void>
}

export interface AgentHarnessOptions {
  defaultRuntimeId?: string
  runtimes: RuntimeRegistration[]
  traceSink?: AgentTraceSink
  hooks?: AgentHarnessHooks
}

export interface AgentRunOptions {
  signal?: AbortSignal
}

export interface AgentHarness {
  run(request: AgentRunRequest, options?: AgentRunOptions): AsyncIterable<AgentEvent>
}

export type AgentHarnessHookHandler = (payload: unknown) => void | Promise<void>

export type AgentHarnessHooks = Partial<Record<HookName, AgentHarnessHookHandler | AgentHarnessHookHandler[]>>

export class RuntimeRegistry {
  private readonly factories = new Map<string, AgentRuntimeFactory>()

  constructor(registrations: RuntimeRegistration[]) {
    for (const registration of registrations) {
      this.register(registration)
    }
  }

  register(registration: RuntimeRegistration): void {
    this.factories.set(registration.id, registration.create)
    for (const alias of registration.aliases ?? []) {
      this.factories.set(alias, registration.create)
    }
  }

  create(id: string, request: AgentRunRequest): RuntimeExecutor {
    const factory = this.factories.get(id)
    if (!factory) {
      throw new Error(`Unknown agent runtime "${id}"`)
    }
    return factory(request)
  }
}

export function createAgentHarness(options: AgentHarnessOptions): AgentHarness {
  return new DefaultAgentHarness(options)
}

export function selectRuntimeId(settings: RuntimeSettings, defaultRuntimeId = 'pi-ai'): string {
  if (settings.orchestration === 'pi-subagents' || settings.backend === 'pi-subagents') {
    return 'pi-subagents'
  }
  return settings.backend ?? defaultRuntimeId
}

export function isAgentEvent(value: unknown): value is AgentEvent {
  if (!value || typeof value !== 'object') return false
  const event = value as Partial<AgentEvent>
  return (
    typeof event.type === 'string' &&
    event.schemaVersion === RUNTIME_CONTRACT_SCHEMA_VERSION &&
    typeof event.ts === 'number'
  )
}

export function validateAgentEvent(event: unknown): AgentEvent {
  if (!isAgentEvent(event)) {
    throw new Error('Runtime emitted an invalid AgentEvent')
  }
  return event
}

export function isTerminalAgentEvent(event: AgentEvent): boolean {
  return event.type === 'run_completed' || event.type === 'run_failed' || event.type === 'run_cancelled'
}

class DefaultAgentHarness implements AgentHarness {
  private readonly registry: RuntimeRegistry
  private readonly defaultRuntimeId: string
  private readonly traceSink?: AgentTraceSink
  private readonly hooks?: AgentHarnessHooks

  constructor(options: AgentHarnessOptions) {
    this.registry = new RuntimeRegistry(options.runtimes)
    this.defaultRuntimeId = options.defaultRuntimeId ?? 'pi-ai'
    this.traceSink = options.traceSink
    this.hooks = options.hooks
  }

  async *run(request: AgentRunRequest, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    const runtimeId = selectRuntimeId(request.settings, this.defaultRuntimeId)
    const runtime = this.registry.create(runtimeId, request)
    const input = toRuntimeInput(request, options.signal)
    let sawTerminal = false
    let lastEvent: AgentEvent | undefined

    this.dispatchHook('beforeRun', { request, runtimeId })

    try {
      for await (const rawEvent of runtime.run(input)) {
        const event = validateAgentEvent(rawEvent)
        lastEvent = event
        if (isTerminalAgentEvent(event)) {
          sawTerminal = true
        }
        this.pushTrace(event, request)
        this.dispatchHook('onRuntimeEvent', { event, request, runtimeId })
        yield event
        if (sawTerminal) break
      }
    } catch (error) {
      if (!sawTerminal) {
        const event = failureEvent(request.runId, error, options.signal?.aborted)
        lastEvent = event
        sawTerminal = true
        this.pushTrace(event, request)
        this.dispatchHook('onRuntimeEvent', { event, request, runtimeId })
        yield event
      }
    }

    if (!sawTerminal) {
      const event = options.signal?.aborted
        ? cancelledEvent(request.runId)
        : failureEvent(request.runId, new Error('Runtime ended without a terminal AgentEvent'))
      lastEvent = event
      sawTerminal = true
      this.pushTrace(event, request)
      this.dispatchHook('onRuntimeEvent', { event, request, runtimeId })
      yield event
    }

    this.dispatchHook('afterRun', { request, runtimeId, terminalEvent: lastEvent })
  }

  private pushTrace(event: AgentEvent, request: AgentRunRequest): void {
    if (!this.traceSink) return
    try {
      void Promise.resolve(this.traceSink.push(event, request)).catch(() => {})
    } catch {
      // Trace is observability only; it must never block or fail the run stream.
    }
  }

  private dispatchHook(name: HookName, payload: unknown): void {
    const handlers = this.hooks?.[name]
    if (!handlers) return
    const list = Array.isArray(handlers) ? handlers : [handlers]
    for (const handler of list) {
      try {
        void Promise.resolve(handler(payload)).catch(() => {})
      } catch {
        // Hooks are extension points; hook failures must not poison the run stream.
      }
    }
  }
}

function toRuntimeInput(request: AgentRunRequest, signal?: AbortSignal): RuntimeInput {
  const lastUserMessage = [...request.messages].reverse().find(message => message.role === 'user')
  const lastMessage = lastUserMessage ?? request.messages.at(-1)

  return {
    runId: request.runId,
    sessionId: request.sessionId,
    message: lastMessage?.content ?? '',
    settings: request.settings,
    signal,
  }
}

function cancelledEvent(runId: string): AgentEvent {
  return {
    type: 'run_cancelled',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-agent-harness@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'agent-harness' },
    runId,
    reason: 'Cancelled',
    ts: Date.now(),
  }
}

function failureEvent(runId: string, error: unknown, cancelled = false): AgentEvent {
  if (cancelled) return cancelledEvent(runId)
  return {
    type: 'run_failed',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'telegraph-agent-harness@0.0.0',
    origin: { framework: 'telegraph', runtimeId: 'agent-harness' },
    runId,
    error: {
      code: 'agent_harness_runtime_error',
      message: error instanceof Error ? error.message : String(error),
      details: error instanceof Error ? { name: error.name, message: error.message } : { value: String(error) },
    },
    ts: Date.now(),
  }
}
