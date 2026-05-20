import type {
  AgentEvent,
  AgentRunRequest,
  HookHandler,
  HookName,
  HookPayload,
  InputHookEvent,
  RuntimeSettings,
} from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import {
  TELEGRAPH_SUBAGENTS_RUNTIME_ID,
  isTelegraphSubagentsSelector,
} from '@/packages/agent/extensions/harness/constants'
import {
  CapabilityHost,
  type AgentCapability,
} from './CapabilityHost'
import {
  HookBus,
  HookExecutionError,
  InputHookBlockedError,
} from './HookBus'

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
  capabilities?: AgentCapability[]
}

export interface AgentRunOptions {
  signal?: AbortSignal
}

export interface AgentHarness {
  readonly capabilities: CapabilityHost
  run(request: AgentRunRequest, options?: AgentRunOptions): AsyncIterable<AgentEvent>
}

export type AgentHarnessHookHandler<N extends HookName = HookName> = HookHandler<N>

export type AgentHarnessHooks = {
  [N in HookName]?: HookHandler<N> | HookHandler<N>[]
}

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
  if (isTelegraphSubagentsSelector(settings.orchestration) || isTelegraphSubagentsSelector(settings.backend)) {
    return TELEGRAPH_SUBAGENTS_RUNTIME_ID
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
  private readonly hookBus = new HookBus()
  private readonly capabilitiesReady: Promise<void>
  readonly capabilities: CapabilityHost

  constructor(options: AgentHarnessOptions) {
    this.registry = new RuntimeRegistry(options.runtimes)
    this.defaultRuntimeId = options.defaultRuntimeId ?? 'pi-ai'
    this.traceSink = options.traceSink
    this.capabilities = new CapabilityHost(this.hookBus)
    this.registerHooks(options.hooks)
    this.capabilitiesReady = this.registerCapabilities(options.capabilities ?? [])
  }

  async *run(request: AgentRunRequest, options: AgentRunOptions = {}): AsyncIterable<AgentEvent> {
    let preparedRequest: AgentRunRequest
    try {
      await this.capabilitiesReady
      preparedRequest = await this.prepareRequest(request)
    } catch (error) {
      yield failureEvent(request.runId, normalizeHookError(error))
      return
    }

    const runtimeId = selectRuntimeId(preparedRequest.settings, this.defaultRuntimeId)
    const runtime = this.registry.create(runtimeId, preparedRequest)
    const input = toRuntimeInput(preparedRequest, options.signal)
    let sawTerminal = false
    let lastEvent: AgentEvent | undefined

    this.dispatchHook('beforeRun', { request: preparedRequest, runtimeId })

    try {
      for await (const rawEvent of runtime.run(input)) {
        const event = validateAgentEvent(rawEvent)
        lastEvent = event
        if (isTerminalAgentEvent(event)) {
          sawTerminal = true
        }
        this.pushTrace(event, preparedRequest)
        this.dispatchHook('onRuntimeEvent', { event, request: preparedRequest, runtimeId })
        yield event
        if (sawTerminal) break
      }
    } catch (error) {
      if (!sawTerminal) {
        const event = failureEvent(request.runId, error, options.signal?.aborted)
        lastEvent = event
        sawTerminal = true
        this.pushTrace(event, preparedRequest)
        this.dispatchHook('onRuntimeEvent', { event, request: preparedRequest, runtimeId })
        yield event
      }
    }

    if (!sawTerminal) {
      const event = options.signal?.aborted
        ? cancelledEvent(request.runId)
        : failureEvent(request.runId, new Error('Runtime ended without a terminal AgentEvent'))
      lastEvent = event
      sawTerminal = true
      this.pushTrace(event, preparedRequest)
      this.dispatchHook('onRuntimeEvent', { event, request: preparedRequest, runtimeId })
      yield event
    }

    this.dispatchHook('afterRun', { request: preparedRequest, runtimeId, terminalEvent: lastEvent })
  }

  private registerHooks(hooks?: AgentHarnessHooks): void {
    if (!hooks) return
    for (const name of Object.keys(hooks) as HookName[]) {
      const handlers = hooks[name]
      if (!handlers) continue
      const list = Array.isArray(handlers) ? handlers : [handlers]
      for (const handler of list) {
        this.hookBus.on(name, handler)
      }
    }
  }

  private async registerCapabilities(capabilities: AgentCapability[]): Promise<void> {
    for (const capability of capabilities) {
      await capability({ host: this.capabilities, hooks: this.hookBus })
    }
  }

  private async prepareRequest(request: AgentRunRequest): Promise<AgentRunRequest> {
    if (this.hookBus.listenerCount('input') === 0) {
      return request
    }

    const result = await this.hookBus.runInputHooks(toInputHookEvent(request))
    return {
      ...request,
      messages: result.messages,
      metadata: {
        ...request.metadata,
        ...result.metadata,
      },
    }
  }

  private pushTrace(event: AgentEvent, request: AgentRunRequest): void {
    if (!this.traceSink) return
    try {
      void Promise.resolve(this.traceSink.push(event, request)).catch(() => {})
    } catch {
      // Trace is observability only; it must never block or fail the run stream.
    }
  }

  private dispatchHook<N extends Exclude<HookName, 'input'>>(name: N, payload: HookPayload<N>): void {
    void this.hookBus
      .emit(name, payload)
      .catch(() => {})
  }
}

function toInputHookEvent(request: AgentRunRequest): InputHookEvent {
  const lastUserMessage = [...request.messages].reverse().find(message => message.role === 'user')
  const lastMessage = lastUserMessage ?? request.messages.at(-1)

  return {
    type: 'input',
    runId: request.runId,
    sessionId: request.sessionId,
    text: lastMessage?.content ?? '',
    messages: request.messages,
    metadata: request.metadata,
    ts: Date.now(),
  }
}

function normalizeHookError(error: unknown): Error {
  if (error instanceof InputHookBlockedError) {
    return new Error(`Input blocked: ${error.reason}`)
  }
  if (error instanceof HookExecutionError) {
    return error
  }
  return error instanceof Error ? error : new Error(String(error))
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
