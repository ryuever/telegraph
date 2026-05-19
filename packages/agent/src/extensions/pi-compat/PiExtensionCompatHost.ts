import type {
  FeedbackAPI,
  ProcessCapability,
} from '@/packages/agent/harness/CapabilityHost'
import type { HookBus } from '@/packages/agent/harness/HookBus'
import type { InputHookEvent, InputHookResult } from '@/packages/agent-protocol'

export type PiInputHandler = (
  event: PiInputEvent,
  ctx: PiExtensionContext,
) => InputHookResult | Promise<InputHookResult>

export interface PiInputEvent {
  text: string
  images?: unknown[]
  raw: InputHookEvent
}

export interface PiExtensionContext {
  hasUI: boolean
  ui: {
    notify(message: string, level?: 'info' | 'warn' | 'error'): void | Promise<void>
  }
}

export interface PiExtensionCompatAPI {
  on(event: string, handler: PiInputHandler): void
  exec(command: string, args: string[], options?: {
    timeout?: number
    cwd?: string
    env?: Record<string, string>
  }): Promise<{ stdout: string; stderr: string; code: number | null }>
  [key: string]: unknown
}

export interface PiExtensionCompatHostOptions {
  process?: ProcessCapability
  feedback?: FeedbackAPI
  hookBus: HookBus
}

export class PiExtensionCompatHost {
  private readonly process?: ProcessCapability
  private readonly feedback?: FeedbackAPI
  private readonly hookBus: HookBus
  private readonly inputHandlers: PiInputHandler[] = []
  private inputHookRegistered = false

  constructor(options: PiExtensionCompatHostOptions) {
    this.process = options.process
    this.feedback = options.feedback
    this.hookBus = options.hookBus
  }

  createAPI(): PiExtensionCompatAPI {
    const api: PiExtensionCompatAPI = {
      on: (event, handler) => {
        if (event !== 'input') {
          throw new Error(`Unsupported Pi extension event "${event}"`)
        }
        this.inputHandlers.push(handler)
        this.ensureInputHook()
      },
      exec: (command, args, options) => this.exec(command, args, options),
    }

    return new Proxy(api, {
      get: (target, property, receiver) => {
        if (typeof property !== 'string') {
          return Reflect.get(target, property, receiver) as unknown
        }
        if (property === 'on') {
          return (event: string, handler: PiInputHandler) => { target.on(event, handler) }
        }
        if (property === 'exec') {
          return (
            command: string,
            args: string[],
            options?: { timeout?: number; cwd?: string; env?: Record<string, string> },
          ) => target.exec(command, args, options)
        }
        return async () => {
          const message = `Unsupported Pi extension API "${property}"`
          await this.feedback?.notify({
            level: 'warn',
            message,
            raw: { source: 'pi-extension-compat', api: property },
          })
          throw new Error(message)
        }
      },
    })
  }

  registerInlineBashExtension(): void {
    const pi = this.createAPI()
    pi.on('input', async (event, ctx) => {
      const matches = [...event.text.matchAll(/!\{([^}]+)\}/g)]
      if (matches.length === 0) {
        return { action: 'continue' }
      }

      let text = event.text
      for (const match of matches) {
        const command = match[1].trim()
        if (!command) continue
        const result = await pi.exec('bash', ['-c', command], { timeout: 30_000 })
        text = text.replace(match[0], result.stdout.trimEnd())
      }

      await ctx.ui.notify('Expanded inline commands', 'info')
      return {
        action: 'transform',
        text,
        images: event.images,
      }
    })
  }

  private ensureInputHook(): void {
    if (this.inputHookRegistered) return
    this.inputHookRegistered = true
    this.hookBus.on('input', async event => {
      let current = event
      for (const handler of this.inputHandlers) {
        const result = await handler(
          {
            text: current.text,
            images: current.images,
            raw: current,
          },
          this.createContext(current),
        )

        if (result.action === 'continue') {
          await this.feedback?.notify({
            runId: current.runId,
            sessionId: current.sessionId,
            level: 'debug',
            message: 'Pi extension input hook continued',
            raw: { source: 'pi-extension-compat', hook: 'input', action: 'continue' },
          })
          continue
        }
        if (result.action === 'block') {
          await this.feedback?.notify({
            runId: current.runId,
            sessionId: current.sessionId,
            level: 'warn',
            message: 'Pi extension input hook blocked input',
            raw: { source: 'pi-extension-compat', hook: 'input', action: 'block' },
          })
          return result
        }
        await this.feedback?.notify({
          runId: current.runId,
          sessionId: current.sessionId,
          level: 'debug',
          message: 'Pi extension input hook transformed input',
          raw: { source: 'pi-extension-compat', hook: 'input', action: 'transform' },
        })
        current = {
          ...current,
          text: result.text,
          images: result.images ?? current.images,
          metadata: {
            ...current.metadata,
            ...result.metadata,
          },
        }
      }

      return current.text === event.text
        ? { action: 'continue' }
        : {
            action: 'transform',
            text: current.text,
            images: current.images,
            metadata: current.metadata,
          }
    })
  }

  private createContext(event: InputHookEvent): PiExtensionContext {
    return {
      hasUI: Boolean(this.feedback),
      ui: {
        notify: async (message, level = 'info') => {
          await this.feedback?.notify({
            runId: event.runId,
            sessionId: event.sessionId,
            level,
            message,
            raw: { source: 'pi-extension-compat' },
          })
        },
      },
    }
  }

  private async exec(
    command: string,
    args: string[],
    options: { timeout?: number; cwd?: string; env?: Record<string, string> } = {},
  ): Promise<{ stdout: string; stderr: string; code: number | null }> {
    if (!this.process) {
      throw new Error('Pi extension exec requires process capability')
    }
    return this.process.exec(command, args, {
      timeoutMs: options.timeout,
      cwd: options.cwd,
      env: options.env,
      permission: { type: 'shell', risk: command === 'bash' ? 'medium' : 'high' },
    })
  }
}

export function piExtensionCompatProfile(options: { inlineBash?: boolean } = {}): import('@/packages/agent/harness/CapabilityHost').AgentCapability {
  return ({ host, hooks }) => {
    const compat = new PiExtensionCompatHost({
      process: host.process,
      feedback: host.feedback,
      hookBus: hooks,
    })
    host.registerCustom('pi-extension-compat', compat)
    if (options.inlineBash) {
      compat.registerInlineBashExtension()
    }
  }
}
