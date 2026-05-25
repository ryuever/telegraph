import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'
import { TAILWIND_PLAY_CDN_SCRIPT_URL } from '@/apps/design/application/common/design-project-contract'
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
      'step_started',
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
      .toContain('shadcn registry assets')
    expect(arrayField(childCompletions[1]?.output, 'components')
      .some(component => stringField(component, 'name') === 'button')).toBe(true)
    const retrievalLedger = recordField(childCompletions[1]?.output, 'ledger')
    expect(recordField(retrievalLedger, 'retrieval')).toMatchObject({
      status: 'complete',
    })
    expect(arrayField(retrievalLedger, 'selected')
      .some(component => stringField(component, 'name') === 'card')).toBe(true)
    expect(recordField(childCompletions[2]?.output, 'artifact')).toMatchObject({
      id: 'run-design-build-patch',
      kind: 'design-patch',
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
    const artifactLedger = recordField(recordField(terminalArtifact, 'metadata'), 'componentRetrievalLedger')
    expect(recordField(artifactLedger, 'retrieval')).toMatchObject({ status: 'complete' })
    expect(arrayField(artifactLedger, 'selected')
      .some(component => stringField(component, 'name') === 'card')).toBe(true)
    const visualReview = recordField(recordField(terminalArtifact, 'metadata'), 'visualReview')
    expect(visualReview).toMatchObject({ status: 'pass' })
    expect(arrayField(visualReview, 'viewports').map(viewport => stringField(viewport, 'id'))).toEqual(['desktop', 'mobile'])
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

  it('emits and passes the resolved design system policy through child model inputs', async () => {
    const requests: DesignBuildChildRunRequest[] = []
    const runtime = createTestRuntime(request => {
      requests.push(request)
      return undefined
    })
    const events = await collect(runtime.run({
      runId: 'run-design-system',
      message: 'Create a login page',
      settings: {},
    }))

    const contextCompletion = events.find((event): event is Extract<AgentEvent, { type: 'step_completed' }> =>
      event.type === 'step_completed' &&
      event.stepId === 'run-design-system:context'
    )
    const contextPolicy = recordField(contextCompletion?.output, 'designSystem')
    expect(contextPolicy).toMatchObject({
      id: 'shadcn-first-standalone',
      mode: 'standalone-preview',
    })

    const modelInputPolicies = requests
      .map(request => recordField(request.modelInput, 'designSystem'))
      .filter(Boolean)
    expect(modelInputPolicies).toHaveLength(4)
    expect(modelInputPolicies.every(policy =>
      stringField(policy, 'id') === 'shadcn-first-standalone' &&
      stringField(policy, 'mode') === 'standalone-preview'
    )).toBe(true)

    const scoutRequest = requests.find(request => request.profileId === DESIGN_BUILD_CHILD_PROFILES.scout)
    expect(scoutRequest?.tools?.map(tool => tool.name)).toEqual([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
    ])
    expect(scoutRequest?.requiredTools).toEqual([
      'get_shadcn_project_llms',
      'get_shadcn_component_usage',
      'select_shadcn_components',
    ])
    const workerRequest = requests.find(request => request.profileId === DESIGN_BUILD_CHILD_PROFILES.worker)
    expect(workerRequest?.tools?.map(tool => tool.name)).toEqual([
      'get_shadcn_component_usage',
      'create_shadcn_project',
      'add_shadcn_component',
      'validate_shadcn_component_usage',
    ])
    expect(workerRequest?.requiredTools).toEqual([
      'get_shadcn_component_usage',
      'create_shadcn_project',
      'add_shadcn_component',
      'validate_shadcn_component_usage',
    ])

    const reviewRequest = requests.find(request => request.profileId === DESIGN_BUILD_CHILD_PROFILES.reviewer)
    const review = recordField(reviewRequest?.input, 'review')
    expect(arrayField(review, 'checks')
      .some(check => stringField(check, 'id') === 'design-system-policy-resolved')).toBe(true)
  })

  it('uses artifact revision context from run metadata', async () => {
    const requests: DesignBuildChildRunRequest[] = []
    const runtime = createTestRuntime(request => {
      requests.push(request)
      return undefined
    })
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
            operationSummaries: [
              {
                kind: 'update',
                path: 'apps/design/src/generated/page.tsx',
                contentPreview: 'export function Hero() { return <button className="bg-green-600">Go</button> }',
                contentLength: 75,
              },
            ],
          },
          selectedComponent: {
            id: 'artifact-parent:update:apps/design/src/generated/page.tsx:0',
            label: 'Hero',
            source: 'patch-operation',
            path: 'apps/design/src/generated/page.tsx',
            operationKind: 'update',
          },
          componentEdit: {
            kind: 'component-edit',
            artifactId: 'artifact-parent',
            prompt: 'Make the primary button green',
            target: {
              id: 'artifact-parent:preview-dom:button',
              artifactId: 'artifact-parent',
              label: 'Primary button',
              source: 'preview-dom',
              path: 'apps/design/src/generated/page.tsx',
              elementTag: 'button',
              className: 'bg-primary',
              sourceLocation: {
                filePath: 'apps/design/src/generated/page.tsx',
                line: 1,
                column: 40,
              },
            },
            binding: {
              sourcePath: 'apps/design/src/generated/page.tsx',
              sourceLocation: {
                filePath: 'apps/design/src/generated/page.tsx',
                line: 1,
                column: 40,
              },
              editScope: 'composition',
              preferredOperationPath: 'apps/design/src/generated/page.tsx',
              protectedPrimitivePaths: ['apps/design/src/generated/src/components/ui/button.tsx'],
              provenance: 'composition',
            },
            dirtyOperations: [
              {
                kind: 'update',
                path: 'apps/design/src/generated/page.tsx',
                source: 'style-editor',
                contentPreview: '<button className="bg-green-600 px-5">Go</button>',
                contentLength: 52,
              },
            ],
            dirtyOperationPaths: ['apps/design/src/generated/page.tsx'],
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

    const contextCompletion = events.find((event): event is Extract<AgentEvent, { type: 'step_completed' }> =>
      event.type === 'step_completed' &&
      event.stepId === 'run-revision:context'
    )
    const revision = recordField(contextCompletion?.output, 'revision')
    expect(stringField(revision, 'changeKind')).toBe('component-edit')
    const operationSummary = arrayField(revision, 'operationSummaries')[0]
    expect(operationSummary).toMatchObject({
      kind: 'update',
      path: 'apps/design/src/generated/page.tsx',
      contentLength: 75,
    })
    expect(stringField(operationSummary, 'contentPreview')).toContain('bg-green-600')
    const componentEdit = recordField(revision, 'componentEdit')
    expect(componentEdit).toMatchObject({
      kind: 'component-edit',
      artifactId: 'artifact-parent',
      dirtyOperationPaths: ['apps/design/src/generated/page.tsx'],
    })

    const workerRequest = requests.find(request => request.profileId === DESIGN_BUILD_CHILD_PROFILES.worker)
    const workerComponentEdit = recordField(workerRequest?.modelInput, 'componentEdit')
    expect(workerComponentEdit).toMatchObject({
      kind: 'component-edit',
      dirtyOperationPaths: ['apps/design/src/generated/page.tsx'],
    })

    const reviewerRequest = requests.find(request => request.profileId === DESIGN_BUILD_CHILD_PROFILES.reviewer)
    const review = recordField(reviewerRequest?.modelInput, 'review')
    expect(arrayField(review, 'checks')
      .some(check => stringField(check, 'id') === 'component-edit-primitive-guard')).toBe(true)

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
    expect(stringField(artifact, 'changeSummary')).toContain('Current artifact operations: update apps/design/src/generated/page.tsx')
  })

  it('does not run a follow-up worker when reviewer requests changes', async () => {
    const runtime = createTestRuntime(request => {
      if (request.profileId === DESIGN_BUILD_CHILD_PROFILES.reviewer && request.stage === 'review') {
        return {
          review: {
            verdict: 'repair_required',
            checks: [
              {
                id: 'test-review',
                passed: false,
                summary: 'Test runner requested another pass.',
              },
            ],
          },
        }
      }
      return undefined
    })
    const events = await collect(runtime.run({
      runId: 'run-review-warning',
      message: 'Create a dashboard',
      settings: {},
    }))

    const childStarts = events.filter((event): event is Extract<AgentEvent, { type: 'child_run_started' }> =>
      event.type === 'child_run_started'
    )
    const repairStarts = childStarts.filter(event => event.childRunId.includes(':repair-1'))
    expect(repairStarts).toHaveLength(0)

    const childCompletions = events.filter((event): event is Extract<AgentEvent, { type: 'child_run_completed' }> =>
      event.type === 'child_run_completed'
    )
    const firstReview = childCompletions.find(event => event.childRunId === 'run-review-warning:design-reviewer')
    expect(stringField(recordField(firstReview?.output, 'review'), 'verdict')).toBe('repair_required')

    const terminal = events.at(-1)
    expect(terminal?.type).toBe('run_completed')
    const terminalOutput = terminal?.type === 'run_completed' ? terminal.output : undefined
    expect(recordField(terminalOutput, 'artifact')).toMatchObject({
      id: 'run-review-warning-patch',
      kind: 'design-patch',
      title: 'Create a dashboard source',
    })
    const childRuns = arrayField(recordField(terminalOutput, 'orchestration'), 'childRuns')
    expect(childRuns.map(childRun => stringField(childRun, 'childRunId'))).not.toContain('run-review-warning:design-worker:repair-1')
    expect(childRuns.map(childRun => stringField(childRun, 'childRunId'))).not.toContain('run-review-warning:design-reviewer:repair-1')
    expect(JSON.stringify(terminal)).toContain('apps/design/src/generated/create-a-dashboard-page/package.json')
  })

  it('leaves visual review failures for preview instead of running a follow-up worker', async () => {
    const runtime = createTestRuntime(request => {
      if (request.profileId === DESIGN_BUILD_CHILD_PROFILES.worker && request.stage === 'code-artifact') {
        return {
          artifact: {
            id: 'visual-bad-artifact',
            kind: 'design-patch',
            title: 'Blank source',
            operations: modelProjectOperationsForRequest(request, 'visual-bad').map(operation => operation.path.endsWith('/src/App.tsx')
              ? { ...operation, content: 'export default function App() { return null }\n' }
              : operation),
          },
        }
      }
      return undefined
    })

    const events = await collect(runtime.run({
      runId: 'run-visual-failure',
      message: 'Create a blank page',
      settings: {},
    }))

    const visualReview = events.find((event): event is Extract<AgentEvent, { type: 'step_completed' }> =>
      event.type === 'step_completed' &&
      event.stepId === 'run-visual-failure:visual-review'
    )
    expect(stringField(visualReview?.output, 'status')).toBe('repair_required')

    const repairWorker = events.find((event): event is Extract<AgentEvent, { type: 'child_run_completed' }> =>
      event.type === 'child_run_completed' &&
      event.childRunId === 'run-visual-failure:design-worker:repair-1'
    )
    expect(repairWorker).toBeUndefined()

    const terminal = events.at(-1)
    expect(terminal?.type).toBe('run_completed')
    const artifact = terminal?.type === 'run_completed'
      ? recordField(terminal.output, 'artifact')
      : undefined
    expect(artifact).toMatchObject({
      id: 'visual-bad-artifact',
      kind: 'design-patch',
      title: 'Blank source',
    })
  })

  it('does not run a partial follow-up pass before preview', async () => {
    const runtime = createTestRuntime(request => {
      if (request.profileId === DESIGN_BUILD_CHILD_PROFILES.worker && request.stage === 'code-artifact') {
        return {
          artifact: {
            id: 'partial-bad-artifact',
            kind: 'design-patch',
            title: 'Partial bad source',
            operations: modelProjectOperationsForRequest(request, 'partial-preview').map(operation => operation.path.endsWith('/src/App.tsx')
              ? { ...operation, content: 'export default function App() { return null }\n' }
              : operation),
          },
        }
      }
      return undefined
    })

    const events = await collect(runtime.run({
      runId: 'run-partial-preview',
      message: 'Create a blank page with partial output',
      settings: {},
    }))

    const terminal = events.at(-1)
    expect(terminal?.type).toBe('run_completed')
    const artifact = terminal?.type === 'run_completed'
      ? recordField(terminal.output, 'artifact')
      : undefined
    const operationPaths = arrayField(artifact, 'operations').map(operation => stringField(operation, 'path'))
    expect(artifact).toMatchObject({
      id: 'partial-bad-artifact',
      kind: 'design-patch',
      title: 'Partial bad source',
    })
    const packagePath = operationPaths.find(path => path?.endsWith('/package.json'))
    if (!packagePath) throw new Error('Expected generated project package.json operation.')
    const projectRoot = packagePath.replace(/\/package\.json$/, '')
    expect(operationPaths).toContain(`${projectRoot}/package.json`)
    expect(operationPaths).toContain(`${projectRoot}/index.html`)
    expect(operationPaths).toContain(`${projectRoot}/src/index.tsx`)
    const app = arrayField(artifact, 'operations').find(operation =>
      stringField(operation, 'path') === `${projectRoot}/src/App.tsx`
    )
    expect(stringField(app, 'content')).toContain('return null')
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
            ...modelProjectOperationsForRequest(request, 'model-page'),
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

  it('keeps the standalone shell when model worker output omits entry files', async () => {
    const runtime = createTestRuntime(request => {
      if (request.profileId !== DESIGN_BUILD_CHILD_PROFILES.worker || request.stage !== 'code-artifact') {
        return undefined
      }
      return {
        artifact: {
          id: 'partial-model-artifact',
          kind: 'design-patch',
          title: 'Partial model source',
          operations: [
            {
              kind: 'add',
              path: 'apps/design/src/generated/generated-design-page/package.json',
              content: JSON.stringify({
                dependencies: {
                  react: '19.1.0',
                  'react-dom': '19.1.0',
                },
              }, null, 2),
            },
            {
              kind: 'add',
              path: 'apps/design/src/generated/generated-design-page/src/App.tsx',
              content: [
                'import { Button } from "@/components/ui/button"',
                'import { Card, CardContent } from "@/components/ui/card"',
                '',
                "export default function App() { return <main style={{ color: '#dc2626' }}><Card><CardContent>Tasks<Button type=\"button\">Open</Button></CardContent></Card></main> }",
                '',
              ].join('\n'),
            },
            {
              kind: 'add',
              path: 'apps/design/src/generated/generated-design-page/src/components/ui/button.tsx',
              content: 'export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} /> }\n',
            },
            {
              kind: 'add',
              path: 'apps/design/src/generated/generated-design-page/src/components/ui/card.tsx',
              content: 'export function Card(props: React.HTMLAttributes<HTMLDivElement>) { return <div {...props} /> }\nexport function CardContent(props: React.HTMLAttributes<HTMLDivElement>) { return <div {...props} /> }\n',
            },
          ],
        },
      }
    })
    const events = await collect(runtime.run({
      runId: 'run-partial-worker',
      message: '设计一个任务管理界面',
      settings: {},
    }))

    const terminal = events.at(-1)
    expect(terminal?.type).toBe('run_completed')
    const artifact = terminal?.type === 'run_completed'
      ? recordField(terminal.output, 'artifact')
      : undefined
    const operations = arrayField(artifact, 'operations')
    const operationPaths = operations.map(operation => stringField(operation, 'path'))
    expect(operationPaths).toContain('apps/design/src/generated/generated-design-page/index.html')
    expect(operationPaths).toContain('apps/design/src/generated/generated-design-page/src/index.tsx')
    const app = operations.find(operation =>
      stringField(operation, 'path') === 'apps/design/src/generated/generated-design-page/src/App.tsx'
    )
    expect(stringField(app, 'content')).toContain('var(--primary)')
    expect(JSON.stringify(operations.filter(operation =>
      !stringField(operation, 'path')?.endsWith('/src/styles.css')
    ))).not.toContain('#dc2626')
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
      output: output ?? defaultChildOutput(request),
      source: 'model-backed',
    })
  }
}

function defaultChildOutput(request: DesignBuildChildRunRequest): unknown {
  if (request.stage === 'component-retrieval') {
    return testComponentRetrievalOutput(request)
  }
  if (request.stage === 'code-artifact') {
    const artifact = recordField(request.modelInput, 'artifact')
    const operations = arrayField(artifact, 'operations')
    if (operations.length > 0) {
      return {
        artifact: {
          ...artifact,
          operations: withTestShadcnUsage(operations),
        },
      }
    }
  }
  return request.input
}

function testComponentRetrievalOutput(request: DesignBuildChildRunRequest): unknown {
  const ledger = {
    query: {
      prompt: stringField(request.modelInput, 'prompt') ?? 'Create a page',
      pageType: 'test-tool-selected',
      roles: [
        { role: 'button', required: true, examples: ['button'] },
        { role: 'card', required: true, examples: ['card'] },
      ],
      selectedThemePack: 'shadcn-new-york-neutral',
    },
    policy: {
      id: 'shadcn-first-standalone',
      mode: 'standalone-preview',
      allowedRegistries: ['@shadcn'],
      handwritePolicy: 'app-composition-only',
    },
    trust: {
      allowedRegistries: ['@shadcn'],
      blockedRegistries: [],
      registries: [
        {
          id: '@shadcn',
          label: 'shadcn/ui',
          trustLevel: 'official',
        },
      ],
    },
    retrieval: {
      status: 'complete',
      sources: [
        {
          kind: 'static-shadcn-catalog',
          registry: '@shadcn',
          query: 'tool-catalog',
          status: 'ok',
        },
      ],
      metrics: {
        candidateCount: 2,
        selectedCount: 2,
        rejectedCount: 0,
        fallbackCount: 0,
        hitRate: 1,
        fallbackRate: 0,
        repairRate: 0,
        visualFailureRate: 0,
      },
    },
    candidates: [
      componentAsset('button', ['@radix-ui/react-slot', 'class-variance-authority']),
      componentAsset('card', []),
    ],
    selected: [
      componentAsset('button', ['@radix-ui/react-slot', 'class-variance-authority']),
      componentAsset('card', []),
    ],
    fallbacks: [],
    rejected: [],
  }
  return {
    query: ledger.query.prompt,
    components: ledger.selected,
    summary: `Selected ${String(ledger.selected.length)} shadcn registry assets for the generated page.`,
    ledger,
  }
}

function componentAsset(name: string, dependencies: string[]): Record<string, unknown> {
  return {
    registry: '@shadcn',
    name,
    type: 'registry:ui',
    description: `${name} selected by test shadcn tool output.`,
    score: 9,
    reason: 'Selected by the shadcn component tool.',
    dependencies,
    files: [`src/components/ui/${name}.tsx`],
    materializedFiles: [`src/components/ui/${name}.tsx`],
    importExamples: [`import { ${name.slice(0, 1).toUpperCase()}${name.slice(1)} } from "@/components/ui/${name}"`],
  }
}

function modelProjectOperationsForRequest(
  request: DesignBuildChildRunRequest,
  fallbackSlug: string,
): Array<{ kind: 'add'; path: string; content: string }> {
  return modelProjectOperationsForRoot(projectRootFromRequest(request, fallbackSlug))
}

function projectRootFromRequest(request: DesignBuildChildRunRequest, fallbackSlug: string): string {
  const artifact = recordField(request.modelInput, 'artifact')
  const packageOperation = arrayField(artifact, 'operations').find(operation =>
    stringField(operation, 'path')?.endsWith('/package.json')
  )
  return stringField(packageOperation, 'path')?.replace(/\/package\.json$/, '') ??
    `apps/design/src/generated/${fallbackSlug}`
}

function modelProjectOperationsForRoot(root: string): Array<{ kind: 'add'; path: string; content: string }> {
  return [
    {
      kind: 'add',
      path: `${root}/package.json`,
      content: JSON.stringify({
        dependencies: {
          '@radix-ui/react-slot': '^1.2.3',
          'class-variance-authority': '^0.7.1',
          clsx: '^2.1.1',
          react: '19.1.0',
          'react-dom': '19.1.0',
          'tailwind-merge': '^3.3.1',
        },
        devDependencies: {
          typescript: '5.3.3',
        },
      }, null, 2),
    },
    {
      kind: 'add',
      path: `${root}/index.html`,
      content: `<script src="${TAILWIND_PLAY_CDN_SCRIPT_URL}"></script><div id="root"></div><script type="module" src="./src/index.tsx?entry"></script>`,
    },
    {
      kind: 'add',
      path: `${root}/src/index.tsx`,
      content: "import { createRoot } from 'react-dom/client'\nimport App from './App'\n\ncreateRoot(document.getElementById('root')!).render(<App />)\n",
    },
    {
      kind: 'add',
      path: `${root}/src/App.tsx`,
      content: shadcnAppSource('Model'),
    },
    {
      kind: 'add',
      path: `${root}/src/components/ui/button.tsx`,
      content: 'export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} /> }\n',
    },
    {
      kind: 'add',
      path: `${root}/src/components/ui/card.tsx`,
      content: 'export function Card(props: React.HTMLAttributes<HTMLDivElement>) { return <div {...props} /> }\nexport function CardContent(props: React.HTMLAttributes<HTMLDivElement>) { return <div {...props} /> }\n',
    },
    {
      kind: 'add',
      path: `${root}/components.json`,
      content: JSON.stringify({ aliases: { ui: '@/components/ui' } }),
    },
    {
      kind: 'add',
      path: `${root}/design-system.provenance.json`,
      content: JSON.stringify({ components: [{ name: 'button' }, { name: 'card' }] }),
    },
  ]
}

function withTestShadcnUsage(operations: unknown[]): unknown[] {
  const appPath = operations
    .map(operation => stringField(operation, 'path'))
    .find(path => path?.endsWith('/src/App.tsx'))
  const root = appPath ? appPath.replace(/\/src\/App\.tsx$/, '') : 'apps/design/src/generated/generated-design-page'
  const byPath = new Map<string, unknown>()
  for (const operation of operations) {
    const path = stringField(operation, 'path')
    if (path) byPath.set(path, operation)
  }
  byPath.set(`${root}/src/App.tsx`, {
    kind: 'add',
    path: `${root}/src/App.tsx`,
    content: shadcnAppSource('Generated'),
  })
  byPath.set(`${root}/src/components/ui/button.tsx`, {
    kind: 'add',
    path: `${root}/src/components/ui/button.tsx`,
    content: 'export function Button(props: React.ButtonHTMLAttributes<HTMLButtonElement>) { return <button {...props} /> }\n',
  })
  byPath.set(`${root}/src/components/ui/card.tsx`, {
    kind: 'add',
    path: `${root}/src/components/ui/card.tsx`,
    content: 'export function Card(props: React.HTMLAttributes<HTMLDivElement>) { return <div {...props} /> }\nexport function CardContent(props: React.HTMLAttributes<HTMLDivElement>) { return <div {...props} /> }\n',
  })
  return [...byPath.values()]
}

function shadcnAppSource(label: string): string {
  return [
    'import { Button } from "@/components/ui/button"',
    'import { Card, CardContent } from "@/components/ui/card"',
    '',
    'export default function App() {',
    `  return <main><Card><CardContent>${label}<Button type="button">Open</Button></CardContent></Card></main>`,
    '}',
    '',
  ].join('\n')
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

function arrayField(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const field = (value as Record<string, unknown>)[key]
  return Array.isArray(field) ? field : []
}
