import type { ChatAgentRunRecordSnapshot } from '@/apps/chat/application/common'

export interface PersistedRunGroup {
  id: string
  sessionId: string
  runs: ChatAgentRunRecordSnapshot[]
  firstRun: ChatAgentRunRecordSnapshot
  latestRun: ChatAgentRunRecordSnapshot
  title: string
  status: ChatAgentRunRecordSnapshot['status']
  eventCount: number
  updatedAt: number
}

export function groupPersistedRuns(runs: ChatAgentRunRecordSnapshot[]): PersistedRunGroup[] {
  const bySession = new Map<string, ChatAgentRunRecordSnapshot[]>()

  for (const run of runs) {
    const sessionRuns = bySession.get(run.sessionId) ?? []
    sessionRuns.push(run)
    bySession.set(run.sessionId, sessionRuns)
  }

  return Array.from(bySession.entries())
    .map(([sessionId, sessionRuns]) => makePersistedRunGroup(sessionId, sessionRuns))
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function sortRunsForSessionTimeline(
  runs: ChatAgentRunRecordSnapshot[],
): ChatAgentRunRecordSnapshot[] {
  return [...runs].sort((a, b) => a.createdAt - b.createdAt)
}

function makePersistedRunGroup(
  sessionId: string,
  runs: ChatAgentRunRecordSnapshot[],
): PersistedRunGroup {
  const timelineRuns = sortRunsForSessionTimeline(runs)
  const firstRun = timelineRuns[0] ?? runs[0]
  const latestRun = runs.reduce((latest, run) => (
    runUpdatedAt(run) > runUpdatedAt(latest) ? run : latest
  ), runs[0] ?? firstRun)

  return {
    id: sessionId,
    sessionId,
    runs: timelineRuns,
    firstRun,
    latestRun,
    title: groupTitle(firstRun, latestRun),
    status: groupStatus(timelineRuns, latestRun),
    eventCount: timelineRuns.reduce((total, run) => total + run.eventCount, 0),
    updatedAt: runUpdatedAt(latestRun),
  }
}

function groupTitle(
  firstRun: ChatAgentRunRecordSnapshot,
  latestRun: ChatAgentRunRecordSnapshot,
): string {
  return firstRun.inputPreview ??
    firstRun.input?.message ??
    latestRun.inputPreview ??
    latestRun.input?.message ??
    `${latestRun.settings.backend ?? latestRun.runtimeId} · ${latestRun.settings.modelId ?? 'model'}`
}

function groupStatus(
  runs: ChatAgentRunRecordSnapshot[],
  latestRun: ChatAgentRunRecordSnapshot,
): ChatAgentRunRecordSnapshot['status'] {
  if (runs.some(run => run.status === 'running')) return 'running'
  if (runs.some(run => run.status === 'queued')) return 'queued'
  return latestRun.status
}

function runUpdatedAt(run: ChatAgentRunRecordSnapshot): number {
  return run.lastEventAt ?? run.completedAt ?? run.startedAt ?? run.createdAt
}
