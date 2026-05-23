import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import { RUNTIME_CONTRACT_SCHEMA_VERSION, type AgentEvent } from '@/packages/agent-protocol'
import { describe, expect, it } from 'vitest'
import {
  DesignBuildRuntime,
  TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
} from '../DesignBuildRuntime'
import {
  DESIGN_BUILD_CHILD_CONTRACT_VERSION,
  DESIGN_BUILD_CHILD_PROFILES,
} from '../DesignBuildChildContracts'
import type {
  DesignBuildChildRunRequest,
  DesignBuildChildRunResult,
  DesignBuildChildRunner,
} from '../DesignBuildChildRunner'

describe('DesignBuildRuntime', () => {
  it('emits a design preview artifact as a RuntimeEvent stream', async () => {
    const runtime = createTestRuntime()
    const events = await collect(runtime.run({
      runId: 'run-design-build',
      sessionId: 'session-1',
      message: 'Create a SaaS dashboard landing page',
      settings: {},
    }))

    expect(events.map(event => event.type)).toEqual([
      'run_started',
      'step_started',
      'child_run_started',
      'child_run_completed',
      'step_completed',
      'step_started',
      'step_completed',
      'step_started',
      'child_run_started',
      'child_run_completed',
      'step_completed',
      'step_started',
      'step_completed',
      'step_started',
      'child_run_started',
      'child_run_completed',
      'step_completed',
      'step_started',
      'child_run_started',
      'child_run_completed',
      'step_completed',
      'assistant_delta',
      'run_completed',
    ])
    expect(events[0]).toMatchObject({
      schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
      producerVersion: TELEGRAPH_DESIGN_BUILD_PRODUCER_VERSION,
      origin: {
        framework: 'telegraph',
        runtimeId: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
      },
      pattern: 'prompt_chain',
    })

    const childStarts = events.filter(event => event.type === 'child_run_started')
    expect(childStarts.map(event => event.childRunId)).toEqual([
      'run-design-build:design-product-planner',
      'run-design-build:design-component-scout',
      'run-design-build:design-worker',
      'run-design-build:design-reviewer',
    ])
    expect(childStarts.map(event => event.label)).toEqual([
      'Design Product Planner',
      'Design Component Scout',
      'Design Worker',
      'Design Reviewer',
    ])
    expect(stringField(childStarts[0]?.raw, 'contractVersion')).toBe(DESIGN_BUILD_CHILD_CONTRACT_VERSION)
    expect(stringField(childStarts[0]?.raw, 'profileId')).toBe('design-product-planner')

    const childCompletions = events.filter((event): event is Extract<AgentEvent, { type: 'child_run_completed' }> =>
      event.type === 'child_run_completed'
    )
    expect(childCompletions).toHaveLength(4)
    expect(stringField(recordField(childCompletions[0]?.output, 'brief'), 'summary'))
      .toBe('Create a SaaS dashboard landing page')
    expect(stringField(childCompletions[1]?.output, 'summary'))
      .toBe('Selected 5 component assets for the generated page.')
    expect(arrayField(childCompletions[1]?.output, 'components')
      .some(component => stringField(component, 'name') === 'Button')).toBe(true)
    expect(childCompletions[2]?.output).toMatchObject({
      artifactId: 'run-design-build-patch',
      kind: 'design-patch',
      operationCount: 6,
    })
    expect(stringField(recordField(childCompletions[3]?.output, 'review'), 'verdict')).toBe('pass')

    const terminal = events.at(-1)
    expect(terminal?.type).toBe('run_completed')
    const terminalOutput = terminal?.type === 'run_completed' ? terminal.output : undefined
    const terminalArtifact = recordField(terminalOutput, 'artifact')
    expect(terminalArtifact).toMatchObject({
      id: 'run-design-build-patch',
      kind: 'design-patch',
      title: 'Create a SaaS dashboard landing page source',
    })
    expect(arrayField(recordField(terminalOutput, 'orchestration'), 'childRuns')
      .map(childRun => stringField(childRun, 'profileId'))).toEqual([
      'design-product-planner',
      'design-component-scout',
      'design-worker',
      'design-reviewer',
    ])
    expect(JSON.stringify(terminal)).toContain('apps/design/src/generated/create-a-saas-dashboard-landing-page-page/package.json')
    expect(JSON.stringify(terminal)).toContain('apps/design/src/generated/create-a-saas-dashboard-landing-page-page/src/App.tsx')
  })

  it('emits run_cancelled when aborted before work starts', async () => {
    const runtime = new DesignBuildRuntime()
    const controller = new AbortController()
    controller.abort()

    const events = await collect(runtime.run({
      runId: 'run-cancelled',
      message: 'make a page',
      settings: {},
      signal: controller.signal,
    }))

    expect(events.map(event => event.type)).toEqual(['run_started', 'run_cancelled'])
  })

  it('emits traceable failure taxonomy for invalid prompts', async () => {
    const runtime = new DesignBuildRuntime()
    const events = await collect(runtime.run({
      runId: 'run-empty',
      message: '   ',
      settings: {},
    }))

    const terminal = events.at(-1)
    expect(terminal).toMatchObject({
      type: 'run_failed',
      error: {
        code: 'brief_failed',
        message: 'Design prompt is empty.',
      },
    })
  })

  it('uses artifact revision context from run metadata', async () => {
    const runtime = createTestRuntime()
    const events = await collect(runtime.run({
      runId: 'run-revision',
      message: 'Make the primary button green',
      settings: {},
      metadata: {
        designContext: {
          activeArtifact: {
            id: 'artifact-parent',
            kind: 'design-patch',
            revision: 2,
            operationPaths: ['apps/design/src/generated/page.tsx'],
          },
          selectedComponent: {
            id: 'artifact-parent:update:apps/design/src/generated/page.tsx:0',
            label: 'Hero',
            source: 'patch-operation',
            path: 'apps/design/src/generated/page.tsx',
            operationKind: 'update',
          },
        },
      },
    }))

    const plannerCompletion = events.find((event): event is Extract<AgentEvent, { type: 'child_run_completed' }> =>
      event.type === 'child_run_completed' &&
      event.childRunId === 'run-revision:design-product-planner'
    )
    const plannerBrief = recordField(plannerCompletion?.output, 'brief')
    expect(stringField(plannerBrief, 'summary')).toContain('Selected component: Hero.')
    expect(arrayField(plannerBrief, 'acceptanceCriteria'))
      .toContain('Preserve component-level intent for Hero.')

    const terminal = events.at(-1)
    expect(terminal?.type).toBe('run_completed')
    const artifact = terminal?.type === 'run_completed'
      ? recordField(terminal.output, 'artifact')
      : undefined
    expect(artifact).toMatchObject({
      kind: 'design-patch',
      parentArtifactId: 'artifact-parent',
      revision: 3,
    })
    expect(stringField(artifact, 'changeSummary')).toContain('Target selected component: Hero.')
  })

  it('runs at most one repair attempt when reviewer requests repair', async () => {
    const runtime = createTestRuntime(request => {
      if (request.profileId === DESIGN_BUILD_CHILD_PROFILES.reviewer && request.stage === 'review') {
        return {
          review: {
            verdict: 'repair_required',
            checks: [
              {
                id: 'test-review',
                passed: false,
                summary: 'Test runner requested one repair pass.',
              },
            ],
          },
        }
      }
      if (request.profileId === DESIGN_BUILD_CHILD_PROFILES.reviewer && request.stage === 'review-repair') {
        return {
          review: {
            verdict: 'pass',
            checks: [
              {
                id: 'test-review-repair',
                passed: true,
                summary: 'Test runner accepted the repaired artifact.',
              },
            ],
          },
          repairAttempt: request.attempt,
        }
      }
      return undefined
    })
    const events = await collect(runtime.run({
      runId: 'run-repair',
      message: 'Create a repairable dashboard',
      settings: {},
    }))

    const childStarts = events.filter((event): event is Extract<AgentEvent, { type: 'child_run_started' }> =>
      event.type === 'child_run_started'
    )
    const repairStarts = childStarts.filter(event => event.childRunId.includes(':repair-1'))
    expect(repairStarts.map(event => event.childRunId)).toEqual([
      'run-repair:design-worker:repair-1',
      'run-repair:design-reviewer:repair-1',
    ])
    expect(childStarts.filter(event => event.childRunId.includes(':repair-2'))).toHaveLength(0)

    const childCompletions = events.filter((event): event is Extract<AgentEvent, { type: 'child_run_completed' }> =>
      event.type === 'child_run_completed'
    )
    const firstReview = childCompletions.find(event => event.childRunId === 'run-repair:design-reviewer')
    expect(stringField(recordField(firstReview?.output, 'review'), 'verdict')).toBe('repair_required')
    const repairReview = childCompletions.find(event => event.childRunId === 'run-repair:design-reviewer:repair-1')
    expect(numberField(repairReview?.output, 'repairAttempt')).toBe(1)
    expect(stringField(recordField(repairReview?.output, 'review'), 'verdict')).toBe('pass')

    const terminal = events.at(-1)
    expect(terminal?.type).toBe('run_completed')
    const terminalOutput = terminal?.type === 'run_completed' ? terminal.output : undefined
    expect(recordField(terminalOutput, 'artifact')).toMatchObject({
      id: 'run-repair-patch',
      kind: 'design-patch',
      title: 'Create a repairable dashboard source repaired',
    })
    const childRuns = arrayField(recordField(terminalOutput, 'orchestration'), 'childRuns')
    const repairWorkerRun = childRuns.find(childRun =>
      stringField(childRun, 'childRunId') === 'run-repair:design-worker:repair-1'
    )
    const repairReviewerRun = childRuns.find(childRun =>
      stringField(childRun, 'childRunId') === 'run-repair:design-reviewer:repair-1'
    )
    expect(numberField(recordField(repairWorkerRun, 'output'), 'repairAttempt')).toBe(1)
    expect(numberField(recordField(repairReviewerRun, 'output'), 'repairAttempt')).toBe(1)
    expect(stringField(recordField(recordField(repairReviewerRun, 'output'), 'review'), 'verdict')).toBe('pass')
    expect(JSON.stringify(terminal)).toContain('apps/design/src/generated/create-a-repairable-dashboard-page/package.json')
    const repairedArtifact = recordField(terminalOutput, 'artifact')
    expect(JSON.stringify(arrayField(repairedArtifact, 'operations'))).not.toContain('@/packages/ui/')
  })

  it('consumes model-backed worker output when provided', async () => {
    const runtime = createTestRuntime(request => {
      if (request.profileId !== DESIGN_BUILD_CHILD_PROFILES.worker || request.stage !== 'code-artifact') {
        return undefined
      }
      return {
        artifact: {
          id: 'model-artifact',
          kind: 'design-patch',
          title: 'Model generated source',
          operations: [
            ...modelProjectOperations('model-page'),
          ],
        },
      }
    })
    const events = await collect(runtime.run({
      runId: 'run-model-worker',
      message: 'Create a page',
      settings: {},
    }))

    const terminal = events.at(-1)
    expect(terminal?.type).toBe('run_completed')
    const artifact = terminal?.type === 'run_completed'
      ? recordField(terminal.output, 'artifact')
      : undefined
    expect(artifact).toMatchObject({
      id: 'model-artifact',
      title: 'Model generated source',
    })
  })

  it('fails instead of falling back when the default model-backed runner has no model settings', async () => {
    const runtime = new DesignBuildRuntime()
    const events = await collect(runtime.run({
      runId: 'run-missing-settings',
      message: 'Create a page',
      settings: {},
    }))

    const terminal = events.at(-1)
    expect(terminal).toMatchObject({
      type: 'run_failed',
      error: {
        code: 'codegen_failed',
        message: 'Design build model settings are required: provider, modelId, and apiKey must be configured.',
      },
    })
  })
})

function createTestRuntime(
  override?: (request: DesignBuildChildRunRequest) => unknown,
): DesignBuildRuntime {
  return new DesignBuildRuntime({
    childRunner: new TestDesignBuildChildRunner(override),
  })
}

class TestDesignBuildChildRunner implements DesignBuildChildRunner {
  constructor(
    private readonly override?: (request: DesignBuildChildRunRequest) => unknown,
  ) {}

  runChild(request: DesignBuildChildRunRequest): Promise<DesignBuildChildRunResult> {
    const output = this.override ? this.override(request) : undefined
    return Promise.resolve({
      output: output ?? request.input,
      source: 'model-backed',
    })
  }
}

function modelProjectOperations(slug: string): Array<{ kind: 'add'; path: string; content: string }> {
  const root = `apps/design/src/generated/${slug}`
  return [
    {
      kind: 'add',
      path: `${root}/package.json`,
      content: JSON.stringify({
        dependencies: {
          react: '19.1.0',
          'react-dom': '19.1.0',
        },
        devDependencies: {
          typescript: '5.3.3',
        },
      }, null, 2),
    },
    {
      kind: 'add',
      path: `${root}/index.html`,
      content: '<div id="root"></div><script type="module" src="./src/index.tsx?entry"></script>',
    },
    {
      kind: 'add',
      path: `${root}/src/index.tsx`,
      content: "import { createRoot } from 'react-dom/client'\nimport App from './App'\n\ncreateRoot(document.getElementById('root')!).render(<App />)\n",
    },
    {
      kind: 'add',
      path: `${root}/src/App.tsx`,
      content: 'export default function App() { return <main>Model</main> }\n',
    },
  ]
}

async function collect(input: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of input) {
    events.push(event)
  }
  return events
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' ? field : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'number' ? field : undefined
}

function arrayField(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const field = (value as Record<string, unknown>)[key]
  return Array.isArray(field) ? field : []
}
