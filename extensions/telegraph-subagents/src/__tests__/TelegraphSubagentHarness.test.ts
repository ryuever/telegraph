import type { RuntimeEvent, RuntimeSettings } from '@/packages/agent-protocol'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { streamPiAiRuntimeEvents } from '@/packages/agent/runtime/streamPiAiRuntime'
import { agentCatalogText } from '@/packages/agent/extensions/harness'
import { createTelegraphSubagentsSnapshot, discoverAgents } from '../agentDiscovery'
import { SubagentManager } from '../SubagentManager'
import { TelegraphSubagentHarness } from '../TelegraphSubagentHarness'

vi.mock('@/packages/agent/runtime/streamPiAiRuntime', () => ({
  streamPiAiRuntimeEvents: vi.fn(),
}))

const streamMock = vi.mocked(streamPiAiRuntimeEvents)
const SV = RUNTIME_CONTRACT_SCHEMA_VERSION
type StreamOptions = Parameters<typeof streamPiAiRuntimeEvents>[0]

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = []
  for await (const item of iterable) result.push(item)
  return result
}

function settings(overrides: Partial<RuntimeSettings> = {}): RuntimeSettings {
  return {
    provider: 'minimax-cn',
    modelId: 'MiniMax-M2.7',
    apiKey: 'test-key',
    orchestration: 'telegraph-subagents',
    orchestrationPattern: 'chain',
    ...overrides,
  }
}

function runtimeInput(overrides: Partial<Parameters<TelegraphSubagentHarness['run']>[0]> = {}) {
  return {
    runId: 'run-subagents-test',
    sessionId: 'session-subagents-test',
    message: 'Build the smallest useful Telegraph native subagents MVP',
    settings: settings(),
    ...overrides,
  }
}

async function* childSuccess(runId: string): AsyncGenerator<RuntimeEvent, undefined, void> {
  yield {
    type: 'assistant_delta',
    schemaVersion: SV,
    producerVersion: 'test-pi-ai@0.0.0',
    runId,
    requestId: `req-${runId}`,
    text: `output from ${runId}`,
    ts: Date.now(),
  } satisfies RuntimeEvent
  yield {
    type: 'run_completed',
    schemaVersion: SV,
    producerVersion: 'test-pi-ai@0.0.0',
    runId,
    output: { text: `output from ${runId}` },
    ts: Date.now(),
  } satisfies RuntimeEvent
  return undefined
}

async function* childFailure(runId: string): AsyncGenerator<RuntimeEvent, undefined, void> {
  yield {
    type: 'assistant_delta',
    schemaVersion: SV,
    producerVersion: 'test-pi-ai@0.0.0',
    runId,
    requestId: `req-${runId}`,
    text: 'partial child output',
    ts: Date.now(),
  } satisfies RuntimeEvent
  yield {
    type: 'run_failed',
    schemaVersion: SV,
    producerVersion: 'test-pi-ai@0.0.0',
    runId,
    error: {
      code: 'child_failed',
      message: `child failed: ${runId}`,
    },
    ts: Date.now(),
  } satisfies RuntimeEvent
  return undefined
}

function mockRouterSelectionAndChildRuns(
  selection: Record<string, unknown>,
  childRun: (runId: string) => AsyncGenerator<RuntimeEvent, undefined, void> = childSuccess,
): void {
  streamMock.mockImplementation(async function* (options: StreamOptions) {
    const subagentTool = options.tools?.find(tool => tool.name === 'subagent')
    if (subagentTool) {
      yield {
        type: 'model_request',
        schemaVersion: SV,
        producerVersion: 'test-pi-ai@0.0.0',
        runId: options.runId,
        requestId: `req-${options.runId}`,
        payload: { tools: options.tools?.map(tool => tool.name) },
        ts: Date.now(),
      } satisfies RuntimeEvent
      yield {
        type: 'tool_call',
        schemaVersion: SV,
        producerVersion: 'test-pi-ai@0.0.0',
        runId: options.runId,
        callId: 'call-subagent',
        toolName: 'subagent',
        input: selection,
        ts: Date.now(),
      } satisfies RuntimeEvent
      const output = await subagentTool.execute(selection, {
        runId: options.runId,
        callId: 'call-subagent',
        toolName: 'subagent',
        signal: options.signal,
      })
      yield {
        type: 'tool_result',
        schemaVersion: SV,
        producerVersion: 'test-pi-ai@0.0.0',
        runId: options.runId,
        callId: 'call-subagent',
        toolName: 'subagent',
        output,
        ts: Date.now(),
      } satisfies RuntimeEvent
      yield {
        type: 'run_completed',
        schemaVersion: SV,
        producerVersion: 'test-pi-ai@0.0.0',
        runId: options.runId,
        output: { text: 'subagent plan accepted' },
        ts: Date.now(),
      } satisfies RuntimeEvent
      return undefined
    }

    const resultTool = options.tools?.find(tool => tool.name === 'get_subagent_result')
    if (resultTool) {
      const childRunId = readFirstChildRunId(options.message) ?? `${options.runId}-chain-3-reviewer`
      const input = { childRunId, consume: true }
      yield {
        type: 'model_request',
        schemaVersion: SV,
        producerVersion: 'test-pi-ai@0.0.0',
        runId: options.runId,
        requestId: `req-${options.runId}-synthesis`,
        payload: { tools: options.tools?.map(tool => tool.name) },
        ts: Date.now(),
      } satisfies RuntimeEvent
      yield {
        type: 'tool_call',
        schemaVersion: SV,
        producerVersion: 'test-pi-ai@0.0.0',
        runId: options.runId,
        callId: 'call-get-subagent-result',
        toolName: 'get_subagent_result',
        input,
        ts: Date.now(),
      } satisfies RuntimeEvent
      const output = await resultTool.execute(input, {
        runId: options.runId,
        callId: 'call-get-subagent-result',
        toolName: 'get_subagent_result',
        signal: options.signal,
      })
      yield {
        type: 'tool_result',
        schemaVersion: SV,
        producerVersion: 'test-pi-ai@0.0.0',
        runId: options.runId,
        callId: 'call-get-subagent-result',
        toolName: 'get_subagent_result',
        output,
        ts: Date.now(),
      } satisfies RuntimeEvent
      yield {
        type: 'assistant_delta',
        schemaVersion: SV,
        producerVersion: 'test-pi-ai@0.0.0',
        runId: options.runId,
        requestId: `req-${options.runId}-synthesis-2`,
        text: `synthesized answer from ${childRunId}`,
        ts: Date.now(),
      } satisfies RuntimeEvent
      yield {
        type: 'run_completed',
        schemaVersion: SV,
        producerVersion: 'test-pi-ai@0.0.0',
        runId: options.runId,
        output: { text: `synthesized answer from ${childRunId}` },
        ts: Date.now(),
      } satisfies RuntimeEvent
      return undefined
    }

    yield* childRun(options.runId)
    return undefined
  })
}

function mockRouterDirectAnswer(): void {
  streamMock.mockImplementation(async function* (options: StreamOptions) {
    yield {
      type: 'assistant_delta',
      schemaVersion: SV,
      producerVersion: 'test-pi-ai@0.0.0',
      runId: options.runId,
      requestId: `req-${options.runId}`,
      text: 'direct parent answer',
      ts: Date.now(),
    } satisfies RuntimeEvent
    yield {
      type: 'run_completed',
      schemaVersion: SV,
      producerVersion: 'test-pi-ai@0.0.0',
      runId: options.runId,
      output: { text: 'direct parent answer' },
      ts: Date.now(),
    } satisfies RuntimeEvent
    return undefined
  })
}

describe('TelegraphSubagentHarness', () => {
  beforeEach(() => {
    streamMock.mockReset()
  })

  it('discovers Telegraph fallback agents from the subagents extension manifest', () => {
    const agents = discoverAgents({
      scopes: ['builtin'],
    })

    expect([...agents.keys()]).toEqual(
      expect.arrayContaining(['scout', 'planner', 'worker', 'reviewer']),
    )
    expect(agents.get('scout')?.sourcePath).toContain('extensions/telegraph-subagents/agents/scout.md')
  })

  it('discovers custom agents by filename without requiring a name frontmatter field', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegraph-subagent-discovery-'))

    try {
      await writeFile(
        join(dir, 'db-migrator.md'),
        [
          '---',
          'description: Database migration specialist',
          'prompt_mode: append',
          'fallback_models: [haiku, sonnet]',
          'tools:',
          '  - read',
          '  - grep',
          '---',
          '',
          'Inspect migration files and report the smallest safe next step.',
        ].join('\n'),
        'utf8',
      )

      const agents = discoverAgents({
        scopes: [],
        extraDirs: [{ path: dir, scope: 'project' }],
      })

      expect([...agents.keys()]).toEqual(['db-migrator'])
      expect(agents.get('db-migrator')).toMatchObject({
        name: 'db-migrator',
        description: 'Database migration specialist',
        fallbackModels: ['haiku', 'sonnet'],
        systemPromptMode: 'append',
        tools: ['read', 'grep'],
        systemPrompt: 'Inspect migration files and report the smallest safe next step.',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('uses agent markdown frontmatter as the final profile metadata source', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'telegraph-subagent-manifest-drift-'))

    try {
      await mkdir(join(dir, 'agents'), { recursive: true })
      await writeFile(
        join(dir, 'telegraph.extension.json'),
        JSON.stringify({
          id: '@telegraph/subagents',
          displayName: 'Telegraph Subagents',
          version: '0.1.0',
          contributes: {
            agents: [
              {
                id: 'scout',
                title: 'Stale Scout',
                description: 'Stale description from manifest.',
                prompt: './agents/scout.md',
                tools: ['read'],
              },
            ],
          },
        }),
        'utf8',
      )
      await writeFile(
        join(dir, 'agents', 'scout.md'),
        [
          '---',
          'title: Fresh Scout',
          'description: Fresh description from markdown.',
          'tools: read, grep',
          '---',
          '',
          'Fresh scout prompt.',
        ].join('\n'),
        'utf8',
      )

      const snapshot = createTelegraphSubagentsSnapshot({
        extensionRoot: dir,
        scopes: ['builtin'],
      })
      const scout = snapshot.agents.find(agent => agent.alias === 'scout')
      const agents = discoverAgents({
        extensionRoot: dir,
        scopes: ['builtin'],
      })

      expect(scout).toMatchObject({
        title: 'Fresh Scout',
        description: 'Fresh description from markdown.',
        tools: ['read', 'grep'],
      })
      expect(agentCatalogText(snapshot)).toContain('scout: Fresh description from markdown.')
      expect(agents.get('scout')).toMatchObject({
        title: 'Fresh Scout',
        description: 'Fresh description from markdown.',
        tools: ['read', 'grep'],
        systemPrompt: 'Fresh scout prompt.',
      })
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('routes the default chain preference into a Team Router review handoff', async () => {
    mockRouterSelectionAndChildRuns({})

    const runtime = new TelegraphSubagentHarness()
    const events = await collect(runtime.run(runtimeInput()))

    expect(events[0]).toMatchObject({
      type: 'run_started',
      runId: 'run-subagents-test',
      pattern: 'prompt_chain',
    })
    expect(events.at(-1)).toMatchObject({
      type: 'run_completed',
      runId: 'run-subagents-test',
      output: { mode: 'chain' },
      raw: {
        route: {
          kind: 'review',
        },
      },
    })
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'step_started',
          runId: 'run-subagents-test',
          label: 'Team Router',
          kind: 'router',
        }),
        expect.objectContaining({
          type: 'step_completed',
          runId: 'run-subagents-test',
          stepId: 'run-subagents-test:team-router',
          output: expect.objectContaining({
            teamId: 'telegraph-default-team',
            taskCount: 2,
            decision: expect.objectContaining({
              kind: 'review',
            }),
          }),
        }),
      ]),
    )
    expect(events.filter(event => event.type === 'assistant_delta' && event.runId === 'run-subagents-test'))
      .toEqual([
        expect.objectContaining({
          text: 'synthesized answer from run-subagents-test-chain-0-worker',
        }),
      ])
    expect(events.filter(event => event.type === 'child_run_started').map(event => event.label))
      .toEqual(['worker', 'reviewer'])
    expect(streamMock).toHaveBeenCalledTimes(4)
    expect(streamMock.mock.calls[0]?.[0].tools?.map(tool => tool.name)).toEqual(['subagent'])
    expect(streamMock.mock.calls[1]?.[0].tools?.map(tool => tool.name)).toEqual(['read', 'grep', 'glob'])
    expect(streamMock.mock.calls[2]?.[0].tools?.map(tool => tool.name)).toEqual(['read', 'grep', 'glob'])
    expect(streamMock.mock.calls[3]?.[0].tools?.map(tool => tool.name)).toEqual(['get_subagent_result'])
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'tool_call',
          runId: 'run-subagents-test',
          toolName: 'get_subagent_result',
        }),
      ]),
    )
  })

  it('marks child results consumed when the parent synthesis tool reads them', async () => {
    mockRouterSelectionAndChildRuns({
      agent: 'scout',
      task: 'Find auth files',
    })

    const manager = new SubagentManager()
    const runtime = new TelegraphSubagentHarness({ subagentManager: manager })
    await collect(runtime.run(runtimeInput()))

    expect(manager.getRecord('run-subagents-test-scout')).toMatchObject({
      resultConsumed: true,
      status: 'completed',
    })
  })

  it('converts child run failure into a parent terminal run_failed event', async () => {
    mockRouterSelectionAndChildRuns({}, childFailure)

    const runtime = new TelegraphSubagentHarness()
    const events = await collect(runtime.run(runtimeInput()))

    expect(events.some(event => event.type === 'run_failed' && event.runId !== 'run-subagents-test'))
      .toBe(true)
    expect(events.at(-1)).toMatchObject({
      type: 'run_failed',
      runId: 'run-subagents-test',
      error: {
        code: 'telegraph_subagents_child_failed',
      },
    })
    expect(events.some(event => event.type === 'run_completed' && event.runId === 'run-subagents-test'))
      .toBe(false)
    expect(streamMock).toHaveBeenCalledTimes(2)
  })

  it('runs the model-selected parallel subagent tool call instead of the default four-agent fanout', async () => {
    mockRouterSelectionAndChildRuns({
      task: 'Check Chat subagent visibility.',
      concurrency: 2,
      tasks: [
        {
          agent: 'scout',
          label: 'Runtime Scout',
          task: 'Read only the runtime projection path and summarize child_run handling.',
        },
        {
          agent: 'reviewer',
          label: 'UI Reviewer',
          task: 'Read only the ChatMessages rendering path and summarize the visible card.',
        },
      ],
    })

    const runtime = new TelegraphSubagentHarness()
    const events = await collect(runtime.run(runtimeInput({
      message: 'Use two subagents to check Chat subagent visibility.',
      settings: settings({ orchestrationPattern: 'parallel' }),
    })))

    expect(events[0]).toMatchObject({
      type: 'run_started',
      runId: 'run-subagents-test',
      pattern: 'parallelization',
    })
    expect(events.filter(event => event.type === 'child_run_started').map(event => event.label))
      .toEqual(['Runtime Scout', 'UI Reviewer'])
    expect(streamMock).toHaveBeenCalledTimes(4)
    expect(streamMock.mock.calls[1]?.[0].message).toContain('Read only the runtime projection path')
    expect(streamMock.mock.calls[2]?.[0].message).toContain('Read only the ChatMessages rendering path')
    expect(streamMock.mock.calls[3]?.[0].tools?.map(tool => tool.name)).toEqual(['get_subagent_result'])
    expect(events.at(-1)).toMatchObject({
      type: 'run_completed',
      runId: 'run-subagents-test',
      output: { mode: 'parallel' },
    })
  })

  it('does not parse natural-language numbered plans in the runtime', async () => {
    mockRouterDirectAnswer()

    const runtime = new TelegraphSubagentHarness()
    const events = await collect(runtime.run(runtimeInput({
      message: [
        '请使用 Telegraph native subagents 的 parallel 模式并行完成一次有边界的检查。',
        '',
        '目标：',
        '验证 Telegraph Chat 是否已经能在 UI 中展示 subagents 能力。',
        '',
        '请启动 2 个子代理：',
        '',
        '1. Runtime Scout',
        '任务：',
        '- 只检查 runtime projection path。',
        '- 输出不超过 5 条 bullet。',
        '',
        '2. UI Scout',
        '任务：',
        '- 只检查 ChatMessages 渲染路径。',
        '- 输出不超过 5 条 bullet。',
        '',
        '主 agent 最后合并两个子代理的结果。',
        '',
        '整体限制：',
        '- 不要创建或修改文件。',
        '- 不要运行测试。',
      ].join('\n'),
      settings: settings({ orchestrationPattern: 'parallel' }),
    })))

    expect(events.filter(event => event.type === 'child_run_started')).toHaveLength(0)
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'step_completed',
          runId: 'run-subagents-test',
          output: expect.objectContaining({
            taskCount: 0,
            decision: expect.objectContaining({
              kind: 'direct',
            }),
          }),
        }),
      ]),
    )
    expect(events.filter(event => event.type === 'assistant_delta').map(event => event.text).join(''))
      .toBe('direct parent answer')
    expect(streamMock).toHaveBeenCalledTimes(1)
    expect(events.at(-1)).toMatchObject({
      type: 'run_completed',
      runId: 'run-subagents-test',
      output: { mode: 'direct' },
    })
  })

  it('fails before spawning child runs when Telegraph native subagents are blocklisted', async () => {
    mockRouterSelectionAndChildRuns({})

    const runtime = new TelegraphSubagentHarness()
    const events = await collect(runtime.run(runtimeInput({
      settings: settings({ extensionBlocklist: ['telegraph-subagents'] }),
    })))

    expect(events).toHaveLength(2)
    expect(events.at(-1)).toMatchObject({
      type: 'run_failed',
      runId: 'run-subagents-test',
      error: {
        code: 'telegraph_subagents_blocked',
      },
    })
    expect(streamMock).not.toHaveBeenCalled()
  })

})

function readFirstChildRunId(message: string): string | undefined {
  const match = message.match(/Child runs available for result lookup:[\s\S]*?\n- ([^\n]+)/)
  return match?.[1]
}
