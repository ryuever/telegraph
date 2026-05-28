import type { DeviceBinding, ChannelReply, RemoteArtifactRef } from '@/packages/remote-protocol'
import type { ApprovalRequestRecord, RunIntentRecord, RunProjectionRecord, RunProjectionStatus } from '@/packages/run-protocol'

export type MobileConnectionState = 'offline' | 'connecting' | 'live'

export interface MobileDashboardSnapshot {
  connection: MobileConnectionState
  devices: DeviceBinding[]
  runs: RunProjectionRecord[]
  intents?: RunIntentRecord[]
  approvals: ApprovalRequestRecord[]
  replies: ChannelReply[]
  selectedRunId?: string
  selectedChatSessionId?: string
  now?: number
}

export interface MobileDeviceItem {
  id: string
  title: string
  subtitle: string
  status: DeviceBinding['status']
  active: boolean
}

export interface MobileRunItem {
  runId: string
  title: string
  subtitle: string
  status: RunProjectionStatus
  statusTone: 'neutral' | 'active' | 'success' | 'danger'
  artifactCount: number
  updatedAt: number
}

export interface MobileApprovalItem {
  approvalId: string
  runId: string
  title: string
  body?: string
  status: ApprovalRequestRecord['status']
  pending: boolean
}

export interface MobileArtifactPreviewItem {
  artifactId: string
  title: string
  uri: string
  mediaType?: string
  previewKind: 'image' | 'link'
}

export interface MobileChatSessionItem {
  sessionId: string
  title: string
  subtitle: string
  status: RunProjectionStatus
  statusTone: MobileRunItem['statusTone']
  messageCount: number
  updatedAt: number
}

export interface MobileChatMessageItem {
  id: string
  sessionId: string
  runId: string
  role: 'user' | 'assistant'
  content: string
  status: 'queued' | 'streaming' | 'done' | 'error'
  createdAt: number
}

export interface MobileChatModel {
  sessions: MobileChatSessionItem[]
  selectedSessionId?: string
  selectedSession?: MobileChatSessionItem
  messages: MobileChatMessageItem[]
}

export interface MobileDashboardModel {
  connection: MobileConnectionState
  summary: {
    activeDevices: number
    runningRuns: number
    pendingApprovals: number
    artifactPreviews: number
  }
  devices: MobileDeviceItem[]
  runs: MobileRunItem[]
  approvals: MobileApprovalItem[]
  artifacts: MobileArtifactPreviewItem[]
  chat: MobileChatModel
  latestReply?: ChannelReply
  selectedRun?: MobileRunItem
}

export function createMobileDashboardModel(snapshot: MobileDashboardSnapshot): MobileDashboardModel {
  const sourceRuns = mergeProjectedAndIntentRuns(snapshot.runs, snapshot.intents ?? [])
  const selectedRunId = snapshot.selectedRunId ?? latestRunId(sourceRuns)
  const runs = sourceRuns
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(runItem)
  const selectedRun = runs.find(run => run.runId === selectedRunId)
  const relevantReplies = snapshot.replies.filter(reply => !selectedRunId || reply.runId === selectedRunId)
  const artifacts = collectArtifactPreviews(snapshot.runs, relevantReplies, selectedRunId)
  const chat = createMobileChatModel(sourceRuns, snapshot.replies, snapshot.selectedChatSessionId)
  const approvals = snapshot.approvals
    .slice()
    .sort((a, b) => Number(b.status === 'pending') - Number(a.status === 'pending') || b.updatedAt - a.updatedAt)
    .map(approvalItem)
  const devices = snapshot.devices
    .slice()
    .sort((a, b) => Number(b.status === 'active') - Number(a.status === 'active') || b.updatedAt - a.updatedAt)
    .map(deviceItem)

  return {
    connection: snapshot.connection,
    summary: {
      activeDevices: devices.filter(device => device.active).length,
      runningRuns: runs.filter(run => run.status === 'running').length,
      pendingApprovals: approvals.filter(approval => approval.pending).length,
      artifactPreviews: artifacts.length,
    },
    devices,
    runs,
    approvals,
    artifacts,
    chat,
    latestReply: relevantReplies.slice().sort((a, b) => b.createdAt - a.createdAt)[0],
    selectedRun,
  }
}

function deviceItem(binding: DeviceBinding): MobileDeviceItem {
  return {
    id: binding.bindingId,
    title: binding.label ?? binding.deviceId,
    subtitle: `${binding.actor.displayName ?? binding.actor.actorId} / ${binding.deviceId}`,
    status: binding.status,
    active: binding.status === 'active',
  }
}

function runItem(run: RunProjectionRecord): MobileRunItem {
  return {
    runId: run.runId,
    title: run.title ?? run.promptPreview ?? run.runId,
    subtitle: `${run.pageletId} / cursor ${String(run.cursor)} / ${String(run.eventCount)} events`,
    status: run.status,
    statusTone: statusTone(run.status),
    artifactCount: run.artifactRefs?.length ?? run.artifactCount ?? 0,
    updatedAt: run.updatedAt,
  }
}

function approvalItem(approval: ApprovalRequestRecord): MobileApprovalItem {
  return {
    approvalId: approval.approvalId,
    runId: approval.runId,
    title: approval.title,
    body: approval.body,
    status: approval.status,
    pending: approval.status === 'pending',
  }
}

function collectArtifactPreviews(
  runs: RunProjectionRecord[],
  replies: ChannelReply[],
  selectedRunId: string | undefined,
): MobileArtifactPreviewItem[] {
  const refs = new Map<string, RemoteArtifactRef>()
  for (const run of runs) {
    if (selectedRunId && run.runId !== selectedRunId) continue
    for (const ref of run.artifactRefs ?? []) refs.set(ref.uri, ref)
  }
  for (const reply of replies) {
    for (const ref of reply.artifactRefs ?? []) refs.set(ref.uri, ref)
  }
  return Array.from(refs.values()).map(ref => ({
    artifactId: ref.artifactId,
    title: ref.title ?? ref.uri.split('/').pop() ?? ref.artifactId,
    uri: ref.uri,
    mediaType: ref.mediaType,
    previewKind: isImageArtifact(ref) ? 'image' : 'link',
  }))
}

function createMobileChatModel(
  runs: RunProjectionRecord[],
  replies: ChannelReply[],
  selectedSessionHint: string | undefined,
): MobileChatModel {
  const chatRuns = runs
    .filter(run => run.pageletId === 'chat')
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt)
  const repliesByRunId = groupRepliesByRunId(replies)
  const sessionMap = new Map<string, {
    session: MobileChatSessionItem
    messages: MobileChatMessageItem[]
  }>()

  for (const run of chatRuns) {
    const sessionId = run.sessionId ?? run.runId
    const existing = sessionMap.get(sessionId)
    const prompt = projectionPrompt(run)
    const assistantText = projectionAssistantText(run) ?? latestReplyText(repliesByRunId.get(run.runId))
    const messages: MobileChatMessageItem[] = []

    if (prompt) {
      messages.push({
        id: `${run.runId}:user`,
        sessionId,
        runId: run.runId,
        role: 'user',
        content: prompt,
        status: 'done',
        createdAt: run.createdAt,
      })
    }

    messages.push({
      id: `${run.runId}:assistant`,
      sessionId,
      runId: run.runId,
      role: 'assistant',
      content: assistantText ?? assistantPlaceholder(run),
      status: assistantStatus(run.status),
      createdAt: run.updatedAt,
    })

    const currentMessages = existing?.messages ?? []
    const nextMessages = currentMessages.concat(messages)
    sessionMap.set(sessionId, {
      session: {
        sessionId,
        title: existing?.session.title ?? deriveChatSessionTitle(run, prompt),
        subtitle: `${String(nextMessages.length)} messages / ${run.status}`,
        status: run.status,
        statusTone: statusTone(run.status),
        messageCount: nextMessages.length,
        updatedAt: Math.max(existing?.session.updatedAt ?? 0, run.updatedAt),
      },
      messages: nextMessages,
    })
  }

  const sessions = Array.from(sessionMap.values())
    .map(item => item.session)
    .sort((a, b) => b.updatedAt - a.updatedAt)
  const selectedSessionId = selectedSessionHint && sessionMap.has(selectedSessionHint)
    ? selectedSessionHint
    : sessions[0]?.sessionId
  const selectedSession = selectedSessionId ? sessions.find(session => session.sessionId === selectedSessionId) : undefined
  const messages = selectedSessionId
    ? (sessionMap.get(selectedSessionId)?.messages ?? []).sort((a, b) => a.createdAt - b.createdAt)
    : []

  return {
    sessions,
    selectedSessionId,
    selectedSession,
    messages,
  }
}

function groupRepliesByRunId(replies: ChannelReply[]): Map<string, ChannelReply[]> {
  const grouped = new Map<string, ChannelReply[]>()
  for (const reply of replies) {
    if (!reply.runId) continue
    grouped.set(reply.runId, (grouped.get(reply.runId) ?? []).concat(reply))
  }
  return grouped
}

function projectionPrompt(run: RunProjectionRecord): string {
  const chat = projectionChatMetadata(run)
  const metadataPrompt = stringRecordValue(chat, 'prompt')
  return (metadataPrompt ?? run.promptPreview ?? run.title ?? '').trim()
}

function projectionAssistantText(run: RunProjectionRecord): string | undefined {
  const chat = projectionChatMetadata(run)
  const value = stringRecordValue(chat, 'assistantText') ?? stringRecordValue(chat, 'assistantPreview')
  const text = value?.trim()
  return text ? text : undefined
}

function projectionChatMetadata(run: RunProjectionRecord): Record<string, unknown> | undefined {
  const value = run.metadata?.chat
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  return value as Record<string, unknown>
}

function stringRecordValue(record: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = record?.[key]
  return typeof value === 'string' ? value : undefined
}

function latestReplyText(replies: ChannelReply[] | undefined): string | undefined {
  const text = replies
    ?.slice()
    .sort((a, b) => b.createdAt - a.createdAt)
    .find(reply => reply.text && reply.text !== 'Run queued.')
    ?.text
    ?.trim()
  return text ? text : undefined
}

function assistantPlaceholder(run: RunProjectionRecord): string {
  if (run.status === 'failed') return run.error ?? 'Run failed.'
  if (run.status === 'cancelled') return 'Run cancelled.'
  if (run.status === 'completed') return 'Run completed.'
  if (run.status === 'queued') return 'Queued on desktop.'
  return 'Desktop agent is working...'
}

function assistantStatus(status: RunProjectionStatus): MobileChatMessageItem['status'] {
  if (status === 'failed' || status === 'cancelled' || status === 'recovered') return 'error'
  if (status === 'completed') return 'done'
  if (status === 'running') return 'streaming'
  return 'queued'
}

function deriveChatSessionTitle(run: RunProjectionRecord, prompt: string): string {
  const candidate = (run.title ?? prompt).replace(/\s+/g, ' ').trim()
  const title = candidate || run.runId
  return title.length > 40 ? `${title.slice(0, 37)}...` : title
}

function statusTone(status: RunProjectionStatus): MobileRunItem['statusTone'] {
  if (status === 'running' || status === 'queued') return 'active'
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  return 'neutral'
}

function latestRunId(runs: RunProjectionRecord[]): string | undefined {
  return runs.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]?.runId
}

function mergeProjectedAndIntentRuns(
  projections: RunProjectionRecord[],
  intents: RunIntentRecord[],
): RunProjectionRecord[] {
  const projectedRunIds = new Set(projections.map(run => run.runId))
  const projectedIntentIds = new Set(projections.map(run => run.sourceIntentId).filter(Boolean))
  const intentRuns = intents
    .filter(intent => !projectedIntentIds.has(intent.intentId))
    .filter(intent => !intent.runId || !projectedRunIds.has(intent.runId))
    .map(runProjectionFromIntent)
  return projections.concat(intentRuns)
}

function runProjectionFromIntent(intent: RunIntentRecord): RunProjectionRecord {
  return {
    runId: intent.runId ?? `intent:${intent.intentId}`,
    sessionId: intent.sessionId,
    pageletId: intent.targetPagelet,
    status: runProjectionStatusFromIntent(intent),
    title: intent.prompt,
    promptPreview: intent.prompt,
    cursor: 0,
    eventCount: 0,
    sourceIntentId: intent.intentId,
    metadata: intent.metadata,
    createdAt: intent.createdAt,
    updatedAt: intent.updatedAt,
  }
}

function runProjectionStatusFromIntent(intent: RunIntentRecord): RunProjectionStatus {
  if (intent.status === 'cancelled' || intent.status === 'expired') return 'cancelled'
  return 'queued'
}

function isImageArtifact(ref: RemoteArtifactRef): boolean {
  return ref.mediaType?.startsWith('image/') === true ||
    ref.uri.startsWith('https://') && /\.(png|jpe?g|webp|gif)$/i.test(ref.uri)
}
