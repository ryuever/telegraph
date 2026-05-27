import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { RUNTIME_CONTRACT_SCHEMA_VERSION } from '@/packages/agent-protocol'
import type { ChatAgentRunRecordSnapshot } from '@/apps/chat/application/common'
import { afterEach, describe, expect, it } from 'vitest'
import { LlmTracePanel } from '../components/LlmTracePanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | undefined
let host: HTMLDivElement | undefined

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount()
    })
  }
  root = undefined
  host?.remove()
  host = undefined
})

describe('LlmTracePanel persisted session list', () => {
  it('shows one run console item for a chat session with multiple model calls', () => {
    renderPanel({
      persistedRuns: [
        runFixture({ runId: 'run-1', sessionId: 'session-1', inputPreview: 'first', eventCount: 2 }),
        runFixture({ runId: 'run-2', sessionId: 'session-1', inputPreview: 'second', eventCount: 3 }),
      ],
    })

    const text = document.body.textContent
    expect(text).toContain('session-1')
    expect(text).toContain('5 ev')
    expect(text).not.toContain('Turn 1')
    expect(text).not.toContain('Turn 2')
  })

  it('renders selected persisted chat session as one merged event stream', () => {
    renderPanel({
      persistedRuns: [
        runFixture({ runId: 'run-1', sessionId: 'session-1', inputPreview: 'first', eventCount: 1 }),
        runFixture({ runId: 'run-2', sessionId: 'session-1', inputPreview: 'second', eventCount: 1 }),
      ],
      selectedPersistedSessionId: 'session-1',
      selectedRunRows: [
        runtimeRow('session-1', 'run-1'),
        runtimeRow('session-1', 'run-2'),
      ],
    })

    const text = document.body.textContent
    expect(text).toContain('Session')
    expect(text).not.toContain('Root run')
    expect(text).not.toContain('Turn')
  })
})

function renderPanel({
  persistedRuns,
  selectedPersistedSessionId = null,
  selectedRunRows = [],
}: {
  persistedRuns: ChatAgentRunRecordSnapshot[]
  selectedPersistedSessionId?: string | null
  selectedRunRows?: React.ComponentProps<typeof LlmTracePanel>['selectedRunRows']
}): void {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => {
    root?.render(
      <LlmTracePanel
        open
        rows={[]}
        storedTraceRowCount={0}
        persistedRuns={persistedRuns}
        selectedPersistedSessionId={selectedPersistedSessionId}
        selectedRunRows={selectedRunRows}
        runConsoleLoading={false}
        scopeAllChats
        onScopeAllChatsChange={() => {}}
        onSelectPersistedRunGroup={() => {}}
        onRefreshPersistedRuns={() => {}}
        onForkPersistedNode={() => {}}
        onImportTraceBundle={() => {}}
        onClear={() => {}}
        onClose={() => {}}
      />,
    )
  })
}

function runFixture(
  patch: Partial<ChatAgentRunRecordSnapshot> = {},
): ChatAgentRunRecordSnapshot {
  return {
    runId: patch.runId ?? 'run-1',
    sessionId: patch.sessionId ?? 'session-1',
    status: patch.status ?? 'completed',
    runtimeId: patch.runtimeId ?? 'pi-ai',
    artifactRefs: patch.artifactRefs ?? [],
    settings: patch.settings ?? {
      backend: 'pi-ai',
      modelId: 'model',
    },
    input: patch.input,
    inputPreview: patch.inputPreview,
    eventCount: patch.eventCount ?? 0,
    createdAt: patch.createdAt ?? 1,
    startedAt: patch.startedAt,
    completedAt: patch.completedAt ?? patch.createdAt,
    lastEventAt: patch.lastEventAt,
  }
}

function runtimeRow(sessionId: string, runId: string): React.ComponentProps<typeof LlmTracePanel>['selectedRunRows'][number] {
  return {
    sessionId,
    runId,
    seq: 1,
    ts: 1,
    trace: {
      kind: 'runtime_event',
      event: {
        type: 'run_started',
        schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
        runId,
        ts: 1,
      },
    },
  }
}
