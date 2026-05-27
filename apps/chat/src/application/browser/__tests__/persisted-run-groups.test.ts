import type { ChatAgentRunRecordSnapshot } from '@/apps/chat/application/common'
import { describe, expect, it } from 'vitest'
import { groupPersistedRuns, sortRunsForSessionTimeline } from '../persisted-run-groups'

describe('persisted run groups', () => {
  it('groups multiple turns from the same chat session into one console item', () => {
    const groups = groupPersistedRuns([
      runFixture({ runId: 'run-2', sessionId: 'session-1', inputPreview: 'second', createdAt: 20, eventCount: 5 }),
      runFixture({ runId: 'run-1', sessionId: 'session-1', inputPreview: 'first', createdAt: 10, eventCount: 3 }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      sessionId: 'session-1',
      title: 'first',
      eventCount: 8,
      status: 'completed',
    })
    expect(groups[0]?.runs.map(run => run.runId)).toEqual(['run-1', 'run-2'])
    expect(groups[0]?.latestRun.runId).toBe('run-2')
  })

  it('sorts session groups by their latest update', () => {
    const groups = groupPersistedRuns([
      runFixture({ runId: 'run-old', sessionId: 'session-old', createdAt: 10, completedAt: 20 }),
      runFixture({ runId: 'run-new', sessionId: 'session-new', createdAt: 5, completedAt: 30 }),
    ])

    expect(groups.map(group => group.sessionId)).toEqual(['session-new', 'session-old'])
  })

  it('keeps session timeline runs in chronological order', () => {
    expect(sortRunsForSessionTimeline([
      runFixture({ runId: 'run-2', createdAt: 20 }),
      runFixture({ runId: 'run-1', createdAt: 10 }),
    ]).map(run => run.runId)).toEqual(['run-1', 'run-2'])
  })
})

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
