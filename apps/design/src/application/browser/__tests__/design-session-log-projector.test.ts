import { describe, expect, it } from 'vitest'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import {
  initialDesignSessionLogItemsFromEvents,
  reduceDesignSessionLogItems,
} from '../design-session-log-projector'

describe('design-session-log-projector', () => {
  it('shows model request tool definitions in the session log', () => {
    const items = reduceDesignSessionLogItems([], {
      type: 'agent_event',
      runId: 'run-1',
      event: {
        type: 'model_request',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1:design-component-scout',
        requestId: 'req-1',
        payload: {
          messages: [{ role: 'user', content: 'Create a profile page' }],
          tools: [
            { name: 'get_shadcn_project_llms' },
            { name: 'get_shadcn_component_usage' },
            { name: 'select_shadcn_components' },
            { name: 'submit_design_child_output' },
          ],
        },
        ts: 5,
      },
    })

    expect(items[0]?.detail).toContain(
      'tools: get_shadcn_project_llms, get_shadcn_component_usage, select_shadcn_components, submit_design_child_output',
    )
  })

  it('projects component retrieval snapshots with selected components and retrieval metrics', () => {
    const items = reduceDesignSessionLogItems([], {
      type: 'agent_event',
      runId: 'run-1',
      sessionId: 'session-1',
      event: {
        type: 'step_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        stepId: 'run-1:component-retrieval',
        output: {
          ledger: {
            retrieval: {
              status: 'complete',
              metrics: {
                selectedCount: 2,
                rejectedCount: 1,
                fallbackCount: 0,
              },
            },
            selected: [
              { name: 'button' },
              { name: 'card' },
            ],
            rejected: [{ name: 'calendar' }],
            fallbacks: [],
          },
        },
        ts: 10,
      },
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      kind: 'step',
      label: 'Step completed: run-1:component-retrieval',
      detail: 'components: button, card / status: complete / selected 2 / rejected 1 / fallback 0',
      status: 'completed',
    })
  })

  it('projects child model invocation, submit tool calls, and failed review checks', () => {
    let items = reduceDesignSessionLogItems([], {
      type: 'agent_event',
      runId: 'run-1',
      event: {
        type: 'child_run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        parentRunId: 'run-1',
        childRunId: 'run-1:design-reviewer',
        label: 'Design Reviewer',
        raw: {
          profileId: 'design-reviewer',
          stage: 'review',
          profile: {
            sourcePath: '/repo/extensions/telegraph-subagents/agents/design-reviewer.md',
            skills: ['shadcn'],
          },
        },
        ts: 20,
      },
    })

    items = reduceDesignSessionLogItems(items, {
      type: 'agent_event',
      runId: 'run-1',
      event: {
        type: 'tool_call',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1:design-reviewer',
        callId: 'call-1',
        toolName: 'submit_design_child_output',
        input: {
          output: {
            review: {
              verdict: 'repair_required',
              checks: [
                { id: 'policy:standalone-imports', passed: false, summary: 'Unresolved import alias.' },
                { id: 'visual-compile-runtime-errors', passed: false, summary: 'useState is not imported.' },
              ],
            },
          },
        },
        ts: 21,
      },
    })

    items = reduceDesignSessionLogItems(items, {
      type: 'agent_event',
      runId: 'run-1',
      event: {
        type: 'child_run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        parentRunId: 'run-1',
        childRunId: 'run-1:design-reviewer',
        output: {
          review: {
            verdict: 'repair_required',
            checks: [
              { id: 'policy:standalone-imports', passed: false, summary: 'Unresolved import alias.' },
              { id: 'visual-compile-runtime-errors', passed: false, summary: 'useState is not imported.' },
            ],
          },
        },
        ts: 22,
      },
    })

    expect(items.map(item => item.label)).toEqual([
      'Tool call: submit_design_child_output',
      'Model completed: Design Reviewer',
    ])
    expect(items[0]?.detail).toContain('useState is not imported')
    expect(items[1]?.detail).toContain('failed: policy:standalone-imports, visual-compile-runtime-errors')
    expect(items[1]?.status).toBe('failed')
  })

  it('adds a completed session snapshot when replaying persisted run events', () => {
    const items = initialDesignSessionLogItemsFromEvents([
      {
        type: 'run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        ts: 1,
      },
      {
        type: 'run_completed',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId: 'run-1',
        output: {
          artifact: {
            id: 'artifact-1',
            kind: 'design-patch',
            title: 'Generated page',
            operations: [
              { path: 'package.json', kind: 'add' },
            ],
          },
        },
        ts: 2,
      },
    ], 'session-1')

    expect(items.map(item => item.label)).toEqual([
      'Run started',
      'Run completed',
      'Session snapshot captured',
    ])
    expect(items.at(-1)?.detail).toContain('run run-1')
    expect(items[1]?.detail).toContain('design-patch / Generated page / 1 operations')
  })
})
