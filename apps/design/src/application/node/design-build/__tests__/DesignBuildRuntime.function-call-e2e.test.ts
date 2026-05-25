import {
  fauxAssistantMessage,
  fauxToolCall,
  registerFauxProvider,
} from '@mariozechner/pi-ai'
import { describe, expect, it, vi } from 'vitest'
import type { AgentEvent } from '@/packages/agent-protocol'

describe('DesignBuildRuntime function-call e2e', () => {
  it('generates a standalone design artifact through shadcn component function calls', async () => {
    const provider = registerFauxProvider({
      provider: 'telegraph-design-build-faux-fc',
      models: [{ id: 'design-build-function-call-model' }],
      tokensPerSecond: 10_000,
    })
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall('submit_design_child_output', {
          output: {
            brief: {
              summary: 'Create a profile settings page with status badges',
              acceptanceCriteria: [
                'Use shadcn UI primitives selected through tools.',
                'Produce a standalone React/Vite project.',
              ],
            },
          },
        }, { id: 'call-planner-submit' }),
        { stopReason: 'toolUse' },
      ),
      fauxAssistantMessage([
        fauxToolCall('get_shadcn_project_llms', {}, { id: 'call-shadcn-overview' }),
        fauxToolCall('get_shadcn_component_usage', {
          components: [
            { componentName: 'Button', componentKnowledgePoint: ['actions'] },
            { componentName: 'Card', componentKnowledgePoint: ['layout'] },
            { componentName: 'Badge', componentKnowledgePoint: ['status'] },
          ],
        }, { id: 'call-shadcn-docs' }),
        fauxToolCall('select_shadcn_components', {
          components: [
            { componentName: 'Button', reason: 'Primary actions' },
            { componentName: 'Card', reason: 'Profile setting groups' },
            { componentName: 'Badge', reason: 'Account status labels' },
          ],
        }, { id: 'call-shadcn-select' }),
        fauxToolCall('submit_design_child_output', {
          output: {
            query: 'Create a profile settings page with status badges',
            components: [],
            summary: 'Selected shadcn primitives for profile settings.',
            ledger: {},
          },
        }, { id: 'call-scout-submit' }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage([
        fauxToolCall('get_shadcn_component_usage', {
          components: [
            { componentName: 'Button', componentKnowledgePoint: ['actions'] },
            { componentName: 'Card', componentKnowledgePoint: ['layout'] },
            { componentName: 'Badge', componentKnowledgePoint: ['status'] },
          ],
        }, { id: 'call-worker-shadcn-docs' }),
        fauxToolCall('create_shadcn_project', {
          title: 'Create a profile settings page with status badges source',
        }, { id: 'call-create-project' }),
        fauxToolCall('add_shadcn_component', {
          componentName: 'Button',
          reason: 'Primary actions',
        }, { id: 'call-add-button' }),
        fauxToolCall('add_shadcn_component', {
          componentName: 'Card',
          reason: 'Profile setting groups',
        }, { id: 'call-add-card' }),
        fauxToolCall('add_shadcn_component', {
          componentName: 'Badge',
          reason: 'Account status labels',
        }, { id: 'call-add-badge' }),
        fauxToolCall('validate_shadcn_component_usage', {
          artifact: {
            id: 'run-fc-e2e-patch',
            kind: 'design-patch',
            title: 'Create a profile settings page with status badges source',
            operations: [
              {
                kind: 'update',
                path: 'apps/design/src/generated/create-a-profile-settings-page-with-status-badge-page/src/App.tsx',
                content: [
                  'import { Badge } from "@/components/ui/badge"',
                  'import { Button } from "@/components/ui/button"',
                  'import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"',
                  '',
                  'export default function App() {',
                  '  return (',
                  '    <main>',
                  '      <Card>',
                  '        <CardHeader>',
                  '          <CardTitle>Profile settings</CardTitle>',
                  '        </CardHeader>',
                  '        <CardContent>',
                  '          <Badge>Active</Badge>',
                  '          <Button type="button">Save changes</Button>',
                  '        </CardContent>',
                  '      </Card>',
                  '    </main>',
                  '  )',
                  '}',
                  '',
                ].join('\n'),
              },
            ],
          },
        }, { id: 'call-validate-shadcn-usage' }),
        fauxToolCall('submit_design_child_output', {
          output: {
            artifact: {
              id: 'run-fc-e2e-patch',
              kind: 'design-patch',
              title: 'Create a profile settings page with status badges source',
              operations: [
                {
                  kind: 'update',
                  path: 'apps/design/src/generated/create-a-profile-settings-page-with-status-badge-page/src/App.tsx',
                  content: [
                    'import { Badge } from "@/components/ui/badge"',
                    'import { Button } from "@/components/ui/button"',
                    'import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"',
                    '',
                    'export default function App() {',
                    '  return (',
                    '    <main>',
                    '      <Card>',
                    '        <CardHeader>',
                    '          <CardTitle>Profile settings</CardTitle>',
                    '        </CardHeader>',
                    '        <CardContent>',
                    '          <Badge>Active</Badge>',
                    '          <Button type="button">Save changes</Button>',
                    '        </CardContent>',
                    '      </Card>',
                    '    </main>',
                    '  )',
                    '}',
                    '',
                  ].join('\n'),
                },
              ],
            },
          },
        }, { id: 'call-worker-submit' }),
      ], { stopReason: 'toolUse' }),
      fauxAssistantMessage(
        fauxToolCall('submit_design_child_output', {
          output: {
            review: {
              verdict: 'pass',
              checks: [
                { id: 'function-call-scout', passed: true, summary: 'Scout used shadcn function calls.' },
              ],
            },
          },
        }, { id: 'call-reviewer-submit' }),
        { stopReason: 'toolUse' },
      ),
    ])

    try {
      vi.resetModules()
      vi.doMock('@/packages/agent/providers/index', () => ({
        resolveModel: () => {
          const model = provider.getModel('design-build-function-call-model')
          if (!model) throw new Error('Missing faux design-build model')
          return model
        },
      }))
      const { DesignBuildRuntime } = await import('../DesignBuildRuntime')
      const runtime = new DesignBuildRuntime()
      const events = await collect(runtime.run({
        runId: 'run-fc-e2e',
        sessionId: 'session-fc-e2e',
        message: 'Create a profile settings page with status badges',
        settings: {
          provider: 'telegraph-design-build-faux-fc',
          modelId: 'design-build-function-call-model',
          apiKey: 'test-key',
        },
      }))

      if (!eventTypes(events).includes('run_completed')) {
        throw new Error(JSON.stringify(events.map(event => ({
          type: event.type,
          runId: 'runId' in event ? event.runId : undefined,
          childRunId: 'childRunId' in event ? event.childRunId : undefined,
          stepId: 'stepId' in event ? event.stepId : undefined,
          toolName: 'toolName' in event ? event.toolName : undefined,
          error: 'error' in event ? event.error : undefined,
          message: 'message' in event ? event.message : undefined,
          output: 'output' in event ? event.output : undefined,
        })), null, 2))
      }
      expect(eventTypes(events)).toContain('run_completed')
      expect(eventTypes(events)).not.toContain('run_failed')

      const scoutRequests = events.filter((event): event is Extract<AgentEvent, { type: 'model_request' }> =>
        event.type === 'model_request' &&
        event.runId === 'run-fc-e2e:design-component-scout'
      )
      expect(toolDefinitionNames(scoutRequests[0]?.payload)).toEqual([
        'get_shadcn_project_llms',
        'get_shadcn_component_usage',
        'select_shadcn_components',
        'submit_design_child_output',
      ])

      expect(toolNames(events)).toEqual(expect.arrayContaining([
        'get_shadcn_project_llms',
        'get_shadcn_component_usage',
        'select_shadcn_components',
        'create_shadcn_project',
        'add_shadcn_component',
        'validate_shadcn_component_usage',
        'submit_design_child_output',
      ]))
      expect(toolResultNames(events)).toEqual(expect.arrayContaining([
        'get_shadcn_project_llms',
        'get_shadcn_component_usage',
        'select_shadcn_components',
        'create_shadcn_project',
        'add_shadcn_component',
        'validate_shadcn_component_usage',
      ]))

      const retrievalStep = events.find((event): event is Extract<AgentEvent, { type: 'step_completed' }> =>
        event.type === 'step_completed' &&
        event.stepId === 'run-fc-e2e:component-retrieval'
      )
      expect(JSON.stringify(retrievalStep?.output)).toContain('"name":"badge"')

      const terminal = events.at(-1)
      expect(terminal?.type).toBe('run_completed')
      const artifact = terminal?.type === 'run_completed'
        ? recordField(terminal.output, 'artifact')
        : undefined
      const operations = arrayField(artifact, 'operations')
      expect(operations.map(operation => stringField(operation, 'path'))).toEqual(expect.arrayContaining([
        'apps/design/src/generated/create-a-profile-settings-page-with-status-badge-page/package.json',
        'apps/design/src/generated/create-a-profile-settings-page-with-status-badge-page/src/App.tsx',
        'apps/design/src/generated/create-a-profile-settings-page-with-status-badge-page/src/components/ui/badge.tsx',
        'apps/design/src/generated/create-a-profile-settings-page-with-status-badge-page/design-system.provenance.json',
      ]))
      const provenance = operations.find(operation =>
        stringField(operation, 'path')?.endsWith('design-system.provenance.json')
      )
      expect(stringField(provenance, 'content')).toContain('"name": "badge"')
    } finally {
      provider.unregister()
      vi.doUnmock('@/packages/agent/providers/index')
      vi.resetModules()
    }
  })
})

async function collect(input: AsyncIterable<AgentEvent>): Promise<AgentEvent[]> {
  const events: AgentEvent[] = []
  for await (const event of input) events.push(event)
  return events
}

function eventTypes(events: AgentEvent[]): string[] {
  return events.map(event => event.type)
}

function toolNames(events: AgentEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentEvent, { type: 'tool_call' }> => event.type === 'tool_call')
    .map(event => event.toolName)
}

function toolResultNames(events: AgentEvent[]): string[] {
  return events
    .filter((event): event is Extract<AgentEvent, { type: 'tool_result' }> => event.type === 'tool_result')
    .map(event => event.toolName)
}

function toolDefinitionNames(payload: unknown): string[] {
  const tools = arrayField(payload, 'tools')
  return tools
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
