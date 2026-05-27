import { RUNTIME_CONTRACT_SCHEMA_VERSION, type RuntimeEvent } from '@/packages/agent-protocol'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DESIGN_BUILD_CHILD_PROFILES } from '../DesignBuildChildContracts'

type MockStreamPiAiRuntimeEvents = (opts: {
  runId: string
  settings: unknown
  message: string
  systemPrompt?: string
  signal?: AbortSignal
  maxToolIterations?: number
  tools?: unknown[]
}) => AsyncGenerator<RuntimeEvent, unknown, void>

const streamPiAiRuntimeEvents = vi.hoisted(() => vi.fn<MockStreamPiAiRuntimeEvents>())

vi.mock('@/packages/agent/runtime/streamPiAiRuntime', () => ({
  streamPiAiRuntimeEvents,
}))

describe('ModelBackedDesignBuildChildRunner model path', () => {
  afterEach(() => {
    streamPiAiRuntimeEvents.mockReset()
  })

  it('calls the pi-ai runtime stream and accepts structured tool output', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield* submitToolEvents({
        artifactId: 'model-artifact',
        kind: 'design-patch',
        title: 'Model artifact',
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
      modelInput: { artifactId: 'model-input-artifact' },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).resolves.toEqual({
      output: {
        artifactId: 'model-artifact',
        kind: 'design-patch',
        title: 'Model artifact',
      },
      source: 'model-backed',
    })

    const request = streamPiAiRuntimeEvents.mock.calls[0][0]
    expect(request.runId).toBe('run-1:worker')
    expect(request.settings).toEqual(expect.objectContaining({
      provider: 'openai',
      modelId: 'gpt-test',
      apiKey: 'test-key',
    }))
    expect(request.maxToolIterations).toBe(6)
    expect(request.tools).toEqual([
      expect.objectContaining({
        name: 'submit_design_child_output',
      }),
    ])
    expect(request.systemPrompt).toContain('submit_design_child_output')
    expect(JSON.parse(request.message) as { input: unknown }).toEqual(expect.objectContaining({
      input: { artifactId: 'model-input-artifact' },
    }))
  })

  it('labels code-artifact model prompts as incremental revisions when revision context is present', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield* submitToolEvents({
        artifactId: 'model-artifact',
        kind: 'design-patch',
        title: 'Model artifact',
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
      modelInput: {
        prompt: 'Add lucide-react to package.json',
        context: {
          revision: {
            parentArtifactId: 'artifact-1',
          },
        },
        artifact: {
          parentArtifactId: 'artifact-1',
        },
      },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })

    const request = streamPiAiRuntimeEvents.mock.calls[0][0]
    expect(request.systemPrompt).toContain('follow-up revision')
    expect(request.systemPrompt).toContain('incremental change request')
    expect(request.systemPrompt).toContain('package.json')
  })

  it('fails when the model answers with text instead of the submit tool', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield {
        type: 'assistant_delta',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: 'run-1:worker',
        requestId: 'req-1',
        text: 'I can help with that, but I need more details.',
        ts: 1,
      }
      yield {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        producerVersion: 'test',
        runId: 'run-1:worker',
        output: {
          role: 'assistant',
          content: 'I can help with that, but I need more details.',
        },
        ts: 2,
      }
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'deterministic-artifact', kind: 'design-patch', title: 'Deterministic artifact' },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).rejects.toThrow('did not call submit_design_child_output')

    expect(streamPiAiRuntimeEvents).toHaveBeenCalledTimes(2)
  })

  it('validates review stage output shape', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield* submitToolEvents({
        review: {
          verdict: 'pass',
          checks: [{ id: 'artifact', passed: true, summary: 'ok' }],
        },
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:reviewer',
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review',
      label: 'Design Reviewer',
      input: { review: { verdict: 'pass', checks: [] } },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).resolves.toEqual({
      output: {
        review: {
          verdict: 'pass',
          checks: [{ id: 'artifact', passed: true, summary: 'ok' }],
        },
      },
      source: 'model-backed',
    })
  })

  it('includes the resolved subagent profile prompt in the child system prompt', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield* submitToolEvents({
        review: {
          verdict: 'pass',
          checks: [{ id: 'profile-review', passed: true, summary: 'profile prompt used' }],
        },
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:reviewer',
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review',
      label: 'Design Reviewer',
      input: { review: { verdict: 'pass', checks: [] } },
      profile: {
        id: DESIGN_BUILD_CHILD_PROFILES.reviewer,
        title: 'Design Reviewer',
        description: 'Review design artifacts.',
        systemPrompt: 'Review the artifact for visual quality and patch safety.',
      },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })

    const request = streamPiAiRuntimeEvents.mock.calls[0][0]
    expect(request.systemPrompt).toContain('Subagent profile: Design Reviewer')
    expect(request.systemPrompt).toContain('Review the artifact for visual quality and patch safety.')
    expect(request.systemPrompt).toContain('submit_design_child_output')
  })

  it('embeds explicitly selected profile skills in the child system prompt', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield* submitToolEvents({
        artifactId: 'model-artifact',
        kind: 'design-patch',
        title: 'Model artifact',
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
      profile: {
        id: DESIGN_BUILD_CHILD_PROFILES.worker,
        title: 'Design Worker',
        description: 'Generate design artifacts.',
        systemPrompt: 'Produce source.',
        skills: ['design-shadcn-generation'],
      },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })

    const request = streamPiAiRuntimeEvents.mock.calls[0][0]
    expect(request.systemPrompt).toContain('<selected_skills>')
    expect(request.systemPrompt).toContain('design-shadcn-generation')
    expect(request.systemPrompt).toContain('shadcn')
    expect(request.systemPrompt).toContain('React Hooks Requirements')
    expect(request.systemPrompt).toContain('Never call `useState`')
  })

  it('fails after repeated malformed stage output', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield* submitToolEvents({
        review: {
          verdict: 'maybe',
          checks: [],
        },
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:reviewer',
      profileId: DESIGN_BUILD_CHILD_PROFILES.reviewer,
      stage: 'review',
      label: 'Design Reviewer',
      input: { review: { verdict: 'pass', checks: [] } },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).rejects.toThrow('review output requires a valid review object')

    expect(streamPiAiRuntimeEvents).toHaveBeenCalledTimes(2)
  })

  it('retries once with contract feedback when the submitted artifact is invalid', async () => {
    streamPiAiRuntimeEvents
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield* submitToolEvents({
          artifact: {
            kind: 'design-patch',
            title: 'Missing id and operations',
          },
        })
      })
      .mockImplementationOnce(async function* () {
        await Promise.resolve()
        yield* submitToolEvents({
          artifactId: 'model-artifact',
          kind: 'design-patch',
          title: 'Model artifact',
        })
      })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).resolves.toEqual({
      output: {
        artifactId: 'model-artifact',
        kind: 'design-patch',
        title: 'Model artifact',
      },
      source: 'model-backed',
    })

    expect(streamPiAiRuntimeEvents).toHaveBeenCalledTimes(2)
    const retryRequest = streamPiAiRuntimeEvents.mock.calls[1][0]
    const retryPayload = JSON.parse(retryRequest.message) as { previousContractError?: { message?: unknown } }
    expect(retryPayload.previousContractError?.message)
      .toBe('code-artifact output contains an invalid artifact.')
  })

  it('requires component retrieval to complete the shadcn tool workflow before submit is accepted', async () => {
    const ledger = componentLedger(['button', 'badge'])
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield toolResult('call-overview', 'get_shadcn_project_llms', { components: [{ name: 'button' }] })
      yield toolResult('call-docs', 'get_shadcn_component_usage', { components: [{ name: 'badge' }] })
      yield toolResult('call-select', 'select_shadcn_components', { ledger })
      yield* submitToolEvents({
        query: 'Create a profile page',
        components: [{ name: 'fake-from-submit' }],
        summary: 'Selected profile components.',
        ledger: componentLedger(['fake-from-submit']),
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:scout',
      profileId: DESIGN_BUILD_CHILD_PROFILES.scout,
      stage: 'component-retrieval',
      label: 'Design Component Scout',
      input: { query: 'Create a profile page', components: [], summary: 'Use tools' },
      tools: [
        workflowTool('get_shadcn_project_llms'),
        workflowTool('get_shadcn_component_usage'),
        workflowTool('select_shadcn_components'),
      ],
      requiredTools: [
        'get_shadcn_project_llms',
        'get_shadcn_component_usage',
        'select_shadcn_components',
      ],
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).resolves.toEqual({
      output: {
        query: 'Create a profile page',
        components: ledger.selected,
        summary: 'Selected profile components.',
        ledger,
      },
      source: 'model-backed',
    })
  })

  it('keeps generated React pins when merging submitted package.json content', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield toolResult('call-create', 'create_shadcn_project', { artifact: designPatchArtifact('project') })
      yield* submitToolEvents({
        artifact: {
          id: 'artifact-project',
          kind: 'design-patch',
          title: 'Artifact project',
          operations: [
            {
              kind: 'update',
              path: 'apps/design/src/generated/project/package.json',
              content: JSON.stringify({
                dependencies: {
                  react: 'latest',
                  'react-dom': '19.3.0-canary-fef12a01-20260413',
                  '@radix-ui/react-slot': '^1.2.3',
                },
              }),
            },
          ],
        },
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    const result = await runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
      tools: [
        workflowTool('create_shadcn_project'),
      ],
      requiredTools: [
        'create_shadcn_project',
      ],
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })

    const output = result.output as {
      artifact?: {
        operations?: Array<{ path: string; content?: string }>
      }
    }
    const packageOperation = output.artifact?.operations?.find(operation => operation.path.endsWith('/package.json'))
    const packageJson = JSON.parse(packageOperation?.content ?? '{}') as {
      dependencies?: Record<string, string>
    }

    expect(packageJson.dependencies).toEqual(expect.objectContaining({
      react: '19.1.0',
      'react-dom': '19.1.0',
      '@radix-ui/react-slot': '^1.2.3',
    }))
    expect(packageOperation?.content).not.toContain('canary')
    expect(packageOperation?.content).not.toContain('"react":"latest"')
  })

  it('rejects component retrieval submit when shadcn selection tools were not completed', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield* submitToolEvents({
        query: 'Create a profile page',
        components: [],
        summary: 'Skipped tools.',
        ledger: componentLedger(['button']),
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:scout',
      profileId: DESIGN_BUILD_CHILD_PROFILES.scout,
      stage: 'component-retrieval',
      label: 'Design Component Scout',
      input: { query: 'Create a profile page', components: [], summary: 'Use tools' },
      tools: [
        workflowTool('get_shadcn_project_llms'),
        workflowTool('get_shadcn_component_usage'),
        workflowTool('select_shadcn_components'),
      ],
      requiredTools: [
        'get_shadcn_project_llms',
        'get_shadcn_component_usage',
        'select_shadcn_components',
      ],
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).rejects.toThrow('component-retrieval did not complete required function-call tools')
  })

  it('rejects code artifact submit when not every selected shadcn component was installed', async () => {
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield toolResult('call-usage', 'get_shadcn_component_usage', {
        components: [
          { name: 'button' },
          { name: 'badge' },
        ],
      })
      yield toolResult('call-create', 'create_shadcn_project', { artifact: designPatchArtifact('project') })
      yield toolResult('call-add-button', 'add_shadcn_component', {
        available: true,
        component: { name: 'button' },
        artifact: designPatchArtifact('button'),
      })
      yield* submitToolEvents({
        artifactId: 'model-artifact',
        kind: 'design-patch',
        title: 'Model artifact',
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
      modelInput: {
        componentLedger: componentLedger(['button', 'badge']),
      },
      tools: [
        workflowTool('create_shadcn_project'),
        workflowTool('add_shadcn_component'),
      ],
      requiredTools: [
        'create_shadcn_project',
        'add_shadcn_component',
      ],
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).rejects.toThrow('code-artifact did not install every selected shadcn component: badge')
  })

  it('rejects code artifact submit when final App.tsx overrides validated shadcn usage', async () => {
    const validatedArtifact = appArtifact([
      'import { Button } from "@/components/ui/button"',
      '',
      'export default function App() {',
      '  return <Button type="button">Save</Button>',
      '}',
      '',
    ].join('\n'))
    streamPiAiRuntimeEvents.mockImplementation(async function* () {
      await Promise.resolve()
      yield toolResult('call-usage', 'get_shadcn_component_usage', {
        components: [{ name: 'button' }],
      })
      yield toolResult('call-create', 'create_shadcn_project', { artifact: designPatchArtifact('project') })
      yield toolResult('call-add-button', 'add_shadcn_component', {
        available: true,
        component: { name: 'button' },
        artifact: componentPrimitiveArtifact('button'),
      })
      yield toolResult('call-validate', 'validate_shadcn_component_usage', {
        passed: true,
        artifact: validatedArtifact,
      })
      yield* submitToolEvents({
        artifact: appArtifact([
          'export default function App() {',
          '  return <main>Plain generated page</main>',
          '}',
          '',
        ].join('\n')),
      })
    })

    const { ModelBackedDesignBuildChildRunner } = await import('../DesignBuildChildRunner')
    const runner = new ModelBackedDesignBuildChildRunner()

    await expect(runner.runChild({
      parentRunId: 'run-1',
      childRunId: 'run-1:worker',
      profileId: DESIGN_BUILD_CHILD_PROFILES.worker,
      stage: 'code-artifact',
      label: 'Design Worker',
      input: { artifactId: 'artifact-1' },
      modelInput: {
        componentLedger: componentLedger(['button']),
      },
      tools: [
        workflowTool('get_shadcn_component_usage'),
        workflowTool('create_shadcn_project'),
        workflowTool('add_shadcn_component'),
        workflowTool('validate_shadcn_component_usage'),
      ],
      requiredTools: [
        'get_shadcn_component_usage',
        'create_shadcn_project',
        'add_shadcn_component',
        'validate_shadcn_component_usage',
      ],
      settings: {
        provider: 'openai',
        modelId: 'gpt-test',
        apiKey: 'test-key',
      },
    })).rejects.toThrow('final artifact did not use every selected shadcn component after merge')
  })
})

function submitToolEvents(output: unknown): RuntimeEvent[] {
  return [
    submitToolCall(output),
    toolResult('call-submit', 'submit_design_child_output', { accepted: true }),
  ]
}

function submitToolCall(output: unknown): RuntimeEvent {
  return {
    type: 'tool_call',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'test',
    runId: 'run-1:worker',
    callId: 'call-submit',
    toolName: 'submit_design_child_output',
    input: { output },
    ts: 1,
  }
}

function toolResult(callId: string, toolName: string, output: unknown): RuntimeEvent {
  return {
    type: 'tool_result',
    schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
    producerVersion: 'test',
    runId: 'run-1:worker',
    callId,
    toolName,
    output,
    ts: 2,
  }
}

function workflowTool(name: string) {
  return {
    name,
    description: `${name} test tool`,
    parameters: {
      type: 'object',
      properties: {},
      additionalProperties: true,
    },
    execute: () => Promise.resolve({ ok: true }),
  }
}

function designPatchArtifact(suffix: string) {
  return {
    id: `artifact-${suffix}`,
    kind: 'design-patch',
    title: `Artifact ${suffix}`,
    operations: [
      {
        kind: 'add',
        path: `apps/design/src/generated/${suffix}/package.json`,
        content: JSON.stringify({
          dependencies: {
            react: '19.1.0',
            'react-dom': '19.1.0',
          },
        }),
      },
    ],
  }
}

function appArtifact(content: string) {
  return {
    id: 'artifact-app',
    kind: 'design-patch',
    title: 'Artifact App',
    operations: [
      {
        kind: 'update',
        path: 'apps/design/src/generated/project/src/App.tsx',
        content,
      },
    ],
  }
}

function componentPrimitiveArtifact(componentName: string) {
  const componentExportName = `${componentName.charAt(0).toUpperCase()}${componentName.slice(1)}`
  return {
    id: `artifact-${componentName}`,
    kind: 'design-patch',
    title: `Artifact ${componentName}`,
    operations: [
      {
        kind: 'add',
        path: `apps/design/src/generated/project/src/components/ui/${componentName}.tsx`,
        content: [
          'import * as React from "react"',
          '',
          `export function ${componentExportName}(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {`,
          '  return <button {...props} />',
          '}',
          '',
        ].join('\n'),
      },
    ],
  }
}

function componentLedger(names: string[]) {
  const selected = names.map(name => ({
    registry: '@shadcn',
    name,
    type: 'registry:ui',
    description: `${name} component`,
    score: 9,
    reason: 'Selected by shadcn tool.',
    dependencies: [],
    files: [`src/components/ui/${name}.tsx`],
    materializedFiles: [`src/components/ui/${name}.tsx`],
    importExamples: [`import { ${name} } from "@/components/ui/${name}"`],
  }))
  return {
    query: {
      prompt: 'Create a profile page',
      pageType: 'test',
      roles: names.map(name => ({ role: name, required: true, examples: [name] })),
    },
    policy: {
      id: 'shadcn-first-standalone',
      mode: 'standalone-preview',
      allowedRegistries: ['@shadcn'],
      handwritePolicy: 'only-when-unavailable',
    },
    trust: {
      allowedRegistries: ['@shadcn'],
      blockedRegistries: [],
      registries: [],
    },
    retrieval: {
      status: 'complete',
      sources: [],
      metrics: {
        candidateCount: names.length,
        selectedCount: names.length,
        rejectedCount: 0,
        fallbackCount: 0,
        hitRate: 1,
        fallbackRate: 0,
        repairRate: 0,
        visualFailureRate: 0,
      },
    },
    candidates: selected,
    selected,
    fallbacks: [],
    rejected: [],
  }
}
