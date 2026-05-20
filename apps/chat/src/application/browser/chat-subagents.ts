import type { ChatMessage, ChatSubagentGroup, ChatSubagentUpdate } from '@/apps/chat/application/common'

type SubagentGroups = NonNullable<ChatMessage['subagentGroups']>

export function upsertSubagentUpdate(
  groups: SubagentGroups,
  update: ChatSubagentUpdate,
): ChatSubagentGroup[] {
  const now = Date.now()
  const groupId = update.parentRunId
  const existingGroup = groups.find(group => group.id === groupId)
  const group: ChatSubagentGroup = existingGroup ?? {
    id: groupId,
    parentRunId: update.parentRunId,
    title: 'Subagents',
    agents: [],
    updatedAt: now,
  }

  const existingAgent = group.agents.find(agent => agent.runId === update.childRunId)
  const nextAgent = {
    runId: update.childRunId,
    name: update.name ?? existingAgent?.name ?? compactRunLabel(update.childRunId),
    task: update.task ?? existingAgent?.task,
    status: update.status,
    lastUpdate: update.lastUpdate ?? existingAgent?.lastUpdate,
    summary: update.summary ?? existingAgent?.summary,
    elapsedMs: update.elapsedMs ?? existingAgent?.elapsedMs,
    startedAt: update.startedAt ?? existingAgent?.startedAt,
    completedAt: update.completedAt ?? existingAgent?.completedAt,
  }

  const nextGroup: ChatSubagentGroup = {
    ...group,
    agents: existingAgent
      ? group.agents.map(agent => (agent.runId === update.childRunId ? nextAgent : agent))
      : [...group.agents, nextAgent],
    updatedAt: now,
  }

  return existingGroup
    ? groups.map(candidate => (candidate.id === groupId ? nextGroup : candidate))
    : [...groups, nextGroup]
}

function compactRunLabel(runId: string): string {
  const last = runId.split('-').filter(Boolean).at(-1)
  return last ? titleCase(last) : 'Subagent'
}

function titleCase(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}
