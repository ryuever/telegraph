import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { AgentEvent, AgentRunRequest } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { RuntimeExecutor, RuntimeInput } from '@/packages/agent/runtime/AgentRuntime'
import { afterEach, describe, expect, it } from 'vitest'
import { createAgentHarness } from '../AgentHarness'
import { FileAgentSessionStore } from '../node/FileAgentSessionStore'

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

class EchoRuntime implements RuntimeExecutor {
  readonly id = 'fake'
  readonly label = 'Fake Runtime'
  lastInput?: RuntimeInput

  async *run(input: RuntimeInput): AsyncIterable<AgentEvent> {
    this.lastInput = input
    await Promise.resolve()
    yield {
      type: 'run_started',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: input.runId,
      ts: Date.now(),
    }
    yield {
      type: 'assistant_delta',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: input.runId,
      requestId: `req-${input.runId}`,
      text: input.message,
      ts: Date.now(),
    }
    yield {
      type: 'run_completed',
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      runId: input.runId,
      output: { ok: true },
      ts: Date.now(),
    }
  }
}

const tempDirs: string[] = []

describe('FileAgentSessionStore', () => {
  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })))
  })

  it('persists messages across store instances', async () => {
    const dir = await tempStoreDir()
    const first = new FileAgentSessionStore(dir)
    await first.appendMessages('session-1', [
      { id: 'm-1', role: 'user', content: 'hello' },
      { id: 'm-2', role: 'assistant', content: 'hi' },
    ])

    const second = new FileAgentSessionStore(dir)

    await expect(second.getMessages('session-1')).resolves.toEqual([
      { id: 'm-1', role: 'user', content: 'hello' },
      { id: 'm-2', role: 'assistant', content: 'hi' },
    ])
  })

  it('deduplicates messages by id and keeps the latest bounded window', async () => {
    const dir = await tempStoreDir()
    const store = new FileAgentSessionStore(dir, { maxMessages: 2 })

    await store.appendMessages('session-1', [
      { id: 'm-1', role: 'user', content: 'first' },
      { id: 'm-2', role: 'assistant', content: 'second' },
    ])
    await store.appendMessages('session-1', [
      { id: 'm-2', role: 'assistant', content: 'second updated' },
      { id: 'm-3', role: 'user', content: 'third' },
    ])

    await expect(store.getMessages('session-1')).resolves.toEqual([
      { id: 'm-2', role: 'assistant', content: 'second updated' },
      { id: 'm-3', role: 'user', content: 'third' },
    ])
  })

  it('ignores unreadable session files instead of blocking future runs', async () => {
    const dir = await tempStoreDir()
    await writeFile(join(dir, 'bad_session.json'), '{', 'utf8')

    await expect(new FileAgentSessionStore(dir).getMessages('bad/session')).resolves.toEqual([])
  })

  it('restores transcript context for a new harness instance', async () => {
    const dir = await tempStoreDir()
    const store = new FileAgentSessionStore(dir)
    const firstRuntime = new EchoRuntime()
    const secondRuntime = new EchoRuntime()
    const baseRequest: AgentRunRequest = {
      runId: 'run-1',
      sessionId: 'session-restore',
      messages: [{ id: 'u-1', role: 'user', content: 'first prompt' }],
      settings: { backend: 'fake' },
    }

    await collect(createAgentHarness({
      runtimes: [{ id: 'fake', create: () => firstRuntime }],
      sessionStore: store,
    }).run(baseRequest))

    await collect(createAgentHarness({
      runtimes: [{ id: 'fake', create: () => secondRuntime }],
      sessionStore: new FileAgentSessionStore(dir),
    }).run({
      ...baseRequest,
      runId: 'run-2',
      messages: [{ id: 'u-2', role: 'user', content: 'second prompt' }],
    }))

    expect(secondRuntime.lastInput?.messages?.map(message => [message.role, message.content])).toEqual([
      ['user', 'first prompt'],
      ['assistant', 'first prompt'],
      ['user', 'second prompt'],
    ])
  })
})

async function tempStoreDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'telegraph-agent-session-'))
  tempDirs.push(dir)
  return dir
}
