import {
  CapabilityHost,
  type CapabilityHookRegistrar,
} from '@/packages/agent-capabilities'
import type {
  AfterRunHookPayload,
  AgentRunRequest,
  HookHandler,
  HookName,
  RuntimeError,
} from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { describe, expect, it, vi } from 'vitest'
import extension, {
  CHAT_NOTIFY_CAPABILITY_KEY,
  COMPLETION_NOTIFY_EXTENSION_ID,
  COMPLETION_NOTIFY_RENDERER_COMPONENT_ID,
  buildCompletionMessage,
  notificationLevelFor,
  type ChatNotifyCapability,
} from '../extension'

/**
 * Tiny fake hook registry that captures handlers so tests can fire them
 * synchronously. Mirrors how `ChatPageletWorker` exposes its persistent
 * HookBus through CapabilityHookRegistrar (`on: (n, h) => bus.on(n, h)`),
 * but without dragging in the real HookBus implementation — keeps this
 * extension's test suite reachable without the agent package on the path.
 */
function createCapturingHooks(): {
  hooks: CapabilityHookRegistrar
  fire<N extends HookName>(name: N, payload: Parameters<HookHandler<N>>[0]): Promise<void>
  handlerCount: (name: HookName) => number
} {
  const handlers = new Map<HookName, Array<(payload: unknown) => unknown>>()
  return {
    hooks: {
      on: <N extends HookName>(name: N, handler: HookHandler<N>) => {
        const list = handlers.get(name) ?? []
        list.push(handler as (payload: unknown) => unknown)
        handlers.set(name, list)
        return () => {
          const next = handlers.get(name)?.filter(h => h !== handler)
          if (!next?.length) handlers.delete(name)
          else handlers.set(name, next)
        }
      },
    },
    fire: async <N extends HookName>(name: N, payload: Parameters<HookHandler<N>>[0]) => {
      const list = handlers.get(name) ?? []
      for (const handler of list) {
        await (handler as (p: typeof payload) => unknown)(payload)
      }
    },
    handlerCount: (name: HookName) => handlers.get(name)?.length ?? 0,
  }
}

function createRequest(overrides: Partial<AgentRunRequest> = {}): AgentRunRequest {
  return {
    runId: 'run_test',
    sessionId: 'session_test',
    messages: [],
    settings: { provider: 'pi-ai', modelId: 'gpt-4o' },
    ...overrides,
  }
}

function expectCleanup(value: unknown): () => void {
  expect(typeof value).toBe('function')
  return value as () => void
}

describe('telegraph-completion-notify extension factory', () => {
  it('registers the MessageRenderer contribution so listMessageRenderers picks it up', () => {
    const { hooks } = createCapturingHooks()
    const host = new CapabilityHost({ on: () => () => {} })
    const cleanup = expectCleanup(extension({ host, hooks }))

    const renderers = host.listMessageRenderers()
    expect(renderers).toHaveLength(1)
    expect(renderers[0]).toMatchObject({
      id: 'completion-notify-banner',
      match: 'system:run-completed',
      componentId: COMPLETION_NOTIFY_RENDERER_COMPONENT_ID,
    })
    cleanup()
  })

  it('subscribes exactly one afterRun handler on activation and unsubscribes on cleanup', () => {
    const { hooks, handlerCount } = createCapturingHooks()
    const host = new CapabilityHost({ on: () => () => {} })

    const cleanup = expectCleanup(extension({ host, hooks }))
    expect(handlerCount('afterRun')).toBe(1)

    cleanup()
    expect(handlerCount('afterRun')).toBe(0)
  })

  it('emits a notification through the chat-notify capability when afterRun fires for a completed run', async () => {
    const { hooks, fire } = createCapturingHooks()
    const host = new CapabilityHost({ on: () => () => {} })
    const notify = vi.fn() as ChatNotifyCapability & ReturnType<typeof vi.fn>
    host.registerCustom(CHAT_NOTIFY_CAPABILITY_KEY, notify)

    const cleanup = expectCleanup(extension({ host, hooks }))
    const payload: AfterRunHookPayload = {
      request: createRequest({ runId: 'run_42', sessionId: 'session_99' }),
      runtimeId: 'pi-ai',
      terminalEvent: {
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        type: 'run_completed',
        runId: 'run_42',
        output: { ok: true },
        ts: 1,
      },
    }
    await fire('afterRun', payload)

    expect(notify).toHaveBeenCalledTimes(1)
    expect(notify).toHaveBeenCalledWith({
      extensionId: COMPLETION_NOTIFY_EXTENSION_ID,
      level: 'info',
      message: 'Run completed (runtime=pi-ai).',
      runId: 'run_42',
      sessionId: 'session_99',
    })
    cleanup()
  })

  it('uses level=error and surfaces the RuntimeError message when the terminal event is run_failed', async () => {
    const { hooks, fire } = createCapturingHooks()
    const host = new CapabilityHost({ on: () => () => {} })
    const notify = vi.fn() as ChatNotifyCapability & ReturnType<typeof vi.fn>
    host.registerCustom(CHAT_NOTIFY_CAPABILITY_KEY, notify)
    const cleanup = expectCleanup(extension({ host, hooks }))

    const err: RuntimeError = { code: 'NET_FAIL', message: 'connection reset' }
    await fire('afterRun', {
      request: createRequest(),
      runtimeId: 'pi-embedded',
      terminalEvent: {
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        type: 'run_failed',
        runId: 'run_test',
        error: err,
        ts: 2,
      },
    })

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      message: 'Run failed (runtime=pi-embedded): connection reset.',
    }))
    cleanup()
  })

  it('uses level=warn when the terminal event is run_cancelled', async () => {
    const { hooks, fire } = createCapturingHooks()
    const host = new CapabilityHost({ on: () => () => {} })
    const notify = vi.fn() as ChatNotifyCapability & ReturnType<typeof vi.fn>
    host.registerCustom(CHAT_NOTIFY_CAPABILITY_KEY, notify)
    const cleanup = expectCleanup(extension({ host, hooks }))

    await fire('afterRun', {
      request: createRequest(),
      runtimeId: 'pi-ai',
      terminalEvent: {
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        type: 'run_cancelled',
        runId: 'run_test',
        reason: 'user',
        ts: 3,
      },
    })

    expect(notify).toHaveBeenCalledWith(expect.objectContaining({
      level: 'warn',
      message: 'Run cancelled (runtime=pi-ai): user.',
    }))
    cleanup()
  })

  it('silently no-ops when the chat-notify capability is not registered on the host', async () => {
    const { hooks, fire } = createCapturingHooks()
    const host = new CapabilityHost({ on: () => () => {} })
    const cleanup = expectCleanup(extension({ host, hooks }))

    // No registerCustom call — getCustom returns undefined. The handler
    // must not throw; otherwise it would poison the shared HookBus for
    // every other extension on every subsequent run.
    await expect(
      fire('afterRun', {
        request: createRequest(),
        runtimeId: 'pi-ai',
        terminalEvent: {
          schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
          type: 'run_completed',
          runId: 'run_test',
          output: null,
          ts: 1,
        },
      }),
    ).resolves.toBeUndefined()
    cleanup()
  })
})

describe('completion-notify pure helpers', () => {
  it('buildCompletionMessage falls back to runtimeId-only text when terminalEvent is missing', () => {
    const message = buildCompletionMessage({
      request: createRequest(),
      runtimeId: 'pi-ai',
    })
    expect(message).toBe('Run completed (runtime=pi-ai).')
  })

  it('buildCompletionMessage uses RuntimeError.code if message is empty', () => {
    const message = buildCompletionMessage({
      request: createRequest(),
      runtimeId: 'pi-ai',
      terminalEvent: {
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        type: 'run_failed',
        runId: 'run_test',
        error: { code: 'TIMEOUT', message: '' },
        ts: 1,
      },
    })
    expect(message).toBe('Run failed (runtime=pi-ai): TIMEOUT.')
  })

  it('notificationLevelFor maps terminal types to severity', () => {
    expect(notificationLevelFor({
      request: createRequest(),
      runtimeId: 'pi-ai',
      terminalEvent: {
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        type: 'run_completed',
        runId: 'r',
        output: null,
        ts: 1,
      },
    })).toBe('info')
    expect(notificationLevelFor({
      request: createRequest(),
      runtimeId: 'pi-ai',
      terminalEvent: {
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        type: 'run_failed',
        runId: 'r',
        error: { code: 'X', message: 'y' },
        ts: 1,
      },
    })).toBe('error')
    expect(notificationLevelFor({
      request: createRequest(),
      runtimeId: 'pi-ai',
      terminalEvent: {
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        type: 'run_cancelled',
        runId: 'r',
        ts: 1,
      },
    })).toBe('warn')
    expect(notificationLevelFor({
      request: createRequest(),
      runtimeId: 'pi-ai',
    })).toBe('info')
  })
})
