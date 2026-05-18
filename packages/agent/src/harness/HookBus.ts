import type {
  HookHandler,
  HookName,
  HookPayload,
  InputHookEvent,
  InputHookResult,
} from '@/packages/agent-protocol'

export class HookExecutionError extends Error {
  constructor(
    readonly hookName: HookName,
    cause: unknown,
  ) {
    super(`Hook "${hookName}" failed: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = 'HookExecutionError'
    this.cause = cause
  }
}

export class InputHookBlockedError extends Error {
  constructor(readonly reason: string) {
    super(reason)
    this.name = 'InputHookBlockedError'
  }
}

export class HookBus {
  private readonly handlers = new Map<HookName, Array<(payload: unknown) => unknown | Promise<unknown>>>()

  on<N extends HookName>(name: N, handler: HookHandler<N>): () => void {
    const list = this.handlers.get(name) ?? []
    list.push(handler as (payload: unknown) => unknown | Promise<unknown>)
    this.handlers.set(name, list)

    return () => {
      const next = this.handlers.get(name)?.filter(item => item !== handler)
      if (!next?.length) {
        this.handlers.delete(name)
        return
      }
      this.handlers.set(name, next)
    }
  }

  listenerCount(name: HookName): number {
    return this.handlers.get(name)?.length ?? 0
  }

  async emit<N extends Exclude<HookName, 'input'>>(name: N, payload: HookPayload<N>): Promise<void> {
    const handlers = this.handlers.get(name) ?? []
    for (const handler of handlers) {
      try {
        await handler(payload)
      } catch (error) {
        throw new HookExecutionError(name, error)
      }
    }
  }

  async runInputHooks(event: InputHookEvent): Promise<InputHookEvent> {
    let current = event
    const handlers = this.handlers.get('input') ?? []

    for (const handler of handlers) {
      let result: InputHookResult | undefined
      try {
        result = await handler(current) as InputHookResult | undefined
      } catch (error) {
        throw new HookExecutionError('input', error)
      }

      if (!result || result.action === 'continue') {
        continue
      }
      if (result.action === 'block') {
        throw new InputHookBlockedError(result.reason)
      }

      current = {
        ...current,
        text: result.text,
        messages: result.messages ?? replaceLastInputMessage(current.messages, result.text),
        images: result.images ?? current.images,
        metadata: {
          ...current.metadata,
          ...result.metadata,
        },
      }
    }

    return current
  }
}

function replaceLastInputMessage(
  messages: InputHookEvent['messages'],
  text: string,
): InputHookEvent['messages'] {
  const index = findLastInputMessageIndex(messages)
  if (index < 0) {
    return messages
  }

  return messages.map((message, messageIndex) => (
    messageIndex === index
      ? { ...message, content: text }
      : message
  ))
}

function findLastInputMessageIndex(messages: InputHookEvent['messages']): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const role = messages[index]?.role
    if (role === 'user' || role === 'system') {
      return index
    }
  }
  return messages.length - 1
}
