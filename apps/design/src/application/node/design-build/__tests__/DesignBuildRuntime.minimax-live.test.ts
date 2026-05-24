import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { AgentEvent } from '@/packages/agent-protocol'
import { createDefaultDesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import { DESIGN_BUILD_CHILD_PROFILES } from '../DesignBuildChildContracts'
import {
  ModelBackedDesignBuildChildRunner,
  type DesignBuildChildRunRequest,
  type DesignBuildChildRunResult,
  type DesignBuildChildRunner,
} from '../DesignBuildChildRunner'
import { DesignBuildRuntime } from '../DesignBuildRuntime'
import {
  createDesignBuildShadcnTools,
  SHADCN_COMPONENT_RETRIEVAL_TOOL_NAMES,
} from '../DesignBuildShadcnTools'

const RUN_LIVE = process.env.TELEGRAPH_RUN_MINIMAX_LIVE === '1'
const MINIMAX_LIVE_MODEL_ID = process.env.MINIMAX_LIVE_MODEL_ID ?? 'MiniMax-M2.7'

describe.runIf(RUN_LIVE)('DesignBuildRuntime MiniMax live', () => {
  it('generates a design artifact with live MiniMax shadcn retrieval', {
    timeout: 150_000,
  }, async () => {
    const apiKey = loadMiniMaxApiKey()
    const liveScoutRunner = new LiveScoutOnlyChildRunner(apiKey)
    const runtime = new DesignBuildRuntime({
      childRunner: liveScoutRunner,
    })
    const events = await collect(runtime.run({
      runId: `run-minimax-hybrid-${String(Date.now())}`,
      sessionId: 'session-minimax-hybrid',
      message: 'Create an account settings page with status badges and primary actions.',
      settings: {
        provider: 'minimax-cn',
        modelId: MINIMAX_LIVE_MODEL_ID,
        apiKey,
        backend: 'pi-ai',
      },
    }))

    const summary = eventSummary(events)
    if (!summary.eventTypes.includes('run_completed')) {
      throw new Error(JSON.stringify(summary, null, 2))
    }

    expect(summary.eventTypes).not.toContain('run_failed')
    expect(summary.toolCalls).toEqual(expect.arrayContaining([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
      'submit_design_child_output',
    ]))
    expect(summary.toolResults).toEqual(expect.arrayContaining([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
      'submit_design_child_output',
    ]))
    expect(summary.finalOperationPaths).toEqual(expect.arrayContaining([
      expect.stringMatching(/package\.json$/),
      expect.stringMatching(new RegExp('src/App\\.tsx$')),
      expect.stringMatching(/design-system\.provenance\.json$/),
    ]))
  })

  it('triggers shadcn component retrieval function calls', {
    timeout: 120_000,
  }, async () => {
    const apiKey = loadMiniMaxApiKey()
    const events: AgentEvent[] = []
    const runner = new ModelBackedDesignBuildChildRunner()
    const result = await runner.runChild({
      parentRunId: 'run-minimax-scout-live',
      childRunId: 'run-minimax-scout-live:design-component-scout',
      profileId: DESIGN_BUILD_CHILD_PROFILES.scout,
      stage: 'component-retrieval',
      label: 'Design Component Scout',
      input: {
        query: 'Create an account settings page with status badges and primary actions.',
        components: [],
        summary: 'Use shadcn function tools.',
      },
      modelInput: {
        prompt: 'Create an account settings page with status badges and primary actions.',
        requiredToolWorkflow: [
          ...SHADCN_COMPONENT_RETRIEVAL_TOOL_NAMES,
          'submit_design_child_output',
        ],
      },
      settings: {
        provider: 'minimax-cn',
        modelId: MINIMAX_LIVE_MODEL_ID,
        apiKey,
        backend: 'pi-ai',
      },
      tools: createDesignBuildShadcnTools({
        prompt: 'Create an account settings page with status badges and primary actions.',
        policy: createDefaultDesignSystemPolicy(),
      }),
      requiredTools: [...SHADCN_COMPONENT_RETRIEVAL_TOOL_NAMES],
      emitEvent: event => {
        events.push(event)
      },
    })

    const summary = eventSummary(events)
    if (!summary.toolCalls.includes('select_shadcn_components')) {
      throw new Error(JSON.stringify({
        ...summary,
        output: result.output,
      }, null, 2))
    }
    expect(summary.modelRequestToolNames).toContainEqual([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
      'submit_design_child_output',
    ])
    expect(summary.toolCalls).toEqual(expect.arrayContaining([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
      'submit_design_child_output',
    ]))
    expect(summary.toolResults).toEqual(expect.arrayContaining([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
      'submit_design_child_output',
    ]))
    expect(JSON.stringify(result.output)).toContain('"ledger"')
  })

  it('generates a standalone design artifact and triggers shadcn function-call retrieval', {
    timeout: 420_000,
  }, async () => {
    const apiKey = loadMiniMaxApiKey()
    expect(apiKey.length).toBeGreaterThan(0)

    const runtime = new DesignBuildRuntime()
    const events = await collect(runtime.run({
      runId: `run-minimax-live-${String(Date.now())}`,
      sessionId: 'session-minimax-live',
      message: 'Create a compact account settings page with profile status badges and clear primary actions.',
        settings: {
          provider: 'minimax-cn',
          modelId: MINIMAX_LIVE_MODEL_ID,
          apiKey,
          backend: 'pi-ai',
        },
    }))

    const summary = eventSummary(events)
    if (!summary.eventTypes.includes('run_completed')) {
      throw new Error(JSON.stringify(summary, null, 2))
    }

    expect(summary.eventTypes).not.toContain('run_failed')
    expect(summary.modelRequestToolNames).toContainEqual([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
      'submit_design_child_output',
    ])
    expect(summary.toolCalls).toEqual(expect.arrayContaining([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
    ]))
    expect(summary.toolResults).toEqual(expect.arrayContaining([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
    ]))
      expect(summary.finalOperationPaths).toEqual(expect.arrayContaining([
        expect.stringMatching(/package\.json$/),
        expect.stringMatching(new RegExp('src/App\\.tsx$')),
        expect.stringMatching(/design-system\.provenance\.json$/),
      ]))
  })
})

class LiveScoutOnlyChildRunner implements DesignBuildChildRunner {
  private readonly modelRunner = new ModelBackedDesignBuildChildRunner()

  constructor(private readonly apiKey: string) {}

  async runChild(request: DesignBuildChildRunRequest): Promise<DesignBuildChildRunResult> {
    if (request.stage === 'component-retrieval') {
      return this.modelRunner.runChild({
        ...request,
        settings: {
          ...request.settings,
          provider: 'minimax-cn',
          modelId: MINIMAX_LIVE_MODEL_ID,
          apiKey: this.apiKey,
          backend: 'pi-ai',
        },
      })
    }
    return {
      output: request.input,
      source: 'model-backed',
    }
  }
}

async function collect(input: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of input) events.push(event)
  return events
}

function loadMiniMaxApiKey(): string {
  const fromEnv = process.env.MINIMAX_API_KEY ?? process.env.MINIMAX_CN_API_KEY
  if (fromEnv) return fromEnv

  const localStorageFile = join(
    process.env.HOME ?? '',
    'Library/Application Support/Telegraph/Local Storage/leveldb/000038.ldb',
  )
  const strings = execFileSync('strings', ['-a', localStorageFile], {
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  })
  const apiKeyLine = strings.split('\n').find(line => line.includes('"apiKey":"'))
  const match = apiKeyLine?.match(/"apiKey":"([^"]+)"/)
  if (match?.[1]) return match[1]

  const raw = readFileSync(localStorageFile, 'utf8')
  const fallbackMatch = raw.match(/"apiKey":"([^"]+)"/)
  return fallbackMatch?.[1] ?? ''
}

function eventSummary(events: AgentEvent[]): {
  eventTypes: string[]
  errors: unknown[]
  modelRequestToolNames: string[][]
  toolCalls: string[]
  toolResults: string[]
  finalOperationPaths: string[]
} {
  const terminal = events.at(-1)
  const artifact = terminal?.type === 'run_completed'
    ? recordField(terminal.output, 'artifact')
    : undefined
  return {
    eventTypes: events.map(event => event.type),
    errors: events
      .filter((event): event is Extract<AgentEvent, { type: 'run_failed' | 'tool_error' }> =>
        event.type === 'run_failed' || event.type === 'tool_error'
      )
      .map(event => event.type === 'run_failed' ? event.error : event.error),
    modelRequestToolNames: events
      .filter((event): event is Extract<AgentEvent, { type: 'model_request' }> => event.type === 'model_request')
      .map(event => toolDefinitionNames(event.payload)),
    toolCalls: events
      .filter((event): event is Extract<AgentEvent, { type: 'tool_call' }> => event.type === 'tool_call')
      .map(event => event.toolName),
    toolResults: events
      .filter((event): event is Extract<AgentEvent, { type: 'tool_result' }> => event.type === 'tool_result')
      .map(event => event.toolName),
    finalOperationPaths: arrayField(artifact, 'operations')
      .map(operation => stringField(operation, 'path'))
      .filter((path): path is string => Boolean(path)),
  }
}

function toolDefinitionNames(payload: unknown): string[] {
  return arrayField(payload, 'tools')
    .map(tool => stringField(tool, 'name'))
    .filter((name): name is string => Boolean(name))
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}

function arrayField(value: unknown, key: string): Record<string, unknown>[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const field = (value as Record<string, unknown>)[key]
  return Array.isArray(field)
    ? field.filter((item): item is Record<string, unknown> =>
        Boolean(item) && typeof item === 'object' && !Array.isArray(item)
      )
    : []
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}
