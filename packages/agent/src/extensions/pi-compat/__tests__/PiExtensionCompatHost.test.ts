import type { InputHookEvent } from '@/packages/agent-protocol'
import { HookBus } from '@/packages/agent/harness/HookBus'
import type { FeedbackAPI, ProcessCapability } from '@/packages/agent/harness/CapabilityHost'
import { PiExtensionCompatHost, piExtensionCompatProfile } from '../PiExtensionCompatHost'
import { CapabilityHost } from '@/packages/agent/harness/CapabilityHost'
import { describe, expect, it } from 'vitest'

const inputEvent: InputHookEvent = {
  type: 'input',
  runId: 'run-pi-compat',
  sessionId: 'session-pi-compat',
  text: 'value !{echo hello}',
  messages: [{ id: 'm1', role: 'user', content: 'value !{echo hello}' }],
  ts: 1,
}

describe('PiExtensionCompatHost', () => {
  it('maps inline bash input extension to process capability and feedback notify', async () => {
    const hookBus = new HookBus()
    const notifications: string[] = []
    const processCalls: Array<{ command: string; args: string[]; risk: string }> = []
    const process: ProcessCapability = {
      exec: (command, args, options) => {
        processCalls.push({ command, args, risk: options.permission.risk })
        return Promise.resolve({ stdout: 'hello\n', stderr: '', code: 0 })
      },
    }
    const feedback: FeedbackAPI = {
      notify: input => { notifications.push(`${input.level}:${input.message}`); },
    }
    const compat = new PiExtensionCompatHost({ hookBus, process, feedback })

    compat.registerInlineBashExtension()
    const result = await hookBus.runInputHooks(inputEvent)

    expect(result.text).toBe('value hello')
    expect(processCalls).toEqual([
      { command: 'bash', args: ['-c', 'echo hello'], risk: 'medium' },
    ])
    expect(notifications).toEqual([
      'info:Expanded inline commands',
      'debug:Pi extension input hook transformed input',
    ])
  })

  it('registers as an explicit compatibility profile on CapabilityHost', async () => {
    const hookBus = new HookBus()
    const host = new CapabilityHost(hookBus)
    host.registerProcess({
      exec: () => Promise.resolve({ stdout: 'ok', stderr: '', code: 0 }),
    })
    host.registerFeedback({
      notify: () => {},
    })

    await piExtensionCompatProfile({ inlineBash: true })({ host, hooks: hookBus })

    expect(host.getCustom('pi-extension-compat')).toBeInstanceOf(PiExtensionCompatHost)
    expect((await hookBus.runInputHooks(inputEvent)).text).toBe('value ok')
  })

  it('throws unsupported errors for missing process exec capability', async () => {
    const hookBus = new HookBus()
    const compat = new PiExtensionCompatHost({ hookBus })
    const pi = compat.createAPI()

    await expect(pi.exec('bash', ['-c', 'echo nope'])).rejects.toThrow('process capability')
  })

  it('maps unsupported Pi APIs to warn feedback and unsupported errors', async () => {
    const hookBus = new HookBus()
    const notifications: string[] = []
    const compat = new PiExtensionCompatHost({
      hookBus,
      feedback: {
        notify: input => { notifications.push(`${input.level}:${input.message}`); },
      },
    })
    const pi = compat.createAPI()
    const unsupported = pi.someFutureApi

    expect(typeof unsupported).toBe('function')
    await expect((unsupported as () => Promise<void>)()).rejects.toThrow('Unsupported Pi extension API')
    expect(notifications).toEqual(['warn:Unsupported Pi extension API "someFutureApi"'])
  })
})
