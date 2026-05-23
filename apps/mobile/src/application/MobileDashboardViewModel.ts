import type { DeviceBinding, ChannelReply, RemoteArtifactRef } from '@/packages/remote-protocol'
import type { ApprovalRequestRecord, RunProjectionRecord, RunProjectionStatus } from '@/packages/run-protocol'

export type MobileConnectionState = 'offline' | 'connecting' | 'live'

export interface MobileDashboardSnapshot {
  connection: MobileConnectionState
  devices: DeviceBinding[]
  runs: RunProjectionRecord[]
  approvals: ApprovalRequestRecord[]
  replies: ChannelReply[]
  selectedRunId?: string
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
  latestReply?: ChannelReply
  selectedRun?: MobileRunItem
}

export function createMobileDashboardModel(snapshot: MobileDashboardSnapshot): MobileDashboardModel {
  const selectedRunId = snapshot.selectedRunId ?? latestRunId(snapshot.runs)
  const runs = snapshot.runs
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(runItem)
  const selectedRun = runs.find(run => run.runId === selectedRunId)
  const relevantReplies = snapshot.replies.filter(reply => !selectedRunId || reply.runId === selectedRunId)
  const artifacts = collectArtifactPreviews(snapshot.runs, relevantReplies, selectedRunId)
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
    latestReply: relevantReplies.slice().sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))[0],
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

function statusTone(status: RunProjectionStatus): MobileRunItem['statusTone'] {
  if (status === 'running' || status === 'queued') return 'active'
  if (status === 'completed') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'danger'
  return 'neutral'
}

function latestRunId(runs: RunProjectionRecord[]): string | undefined {
  return runs.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0]?.runId
}

function isImageArtifact(ref: RemoteArtifactRef): boolean {
  return ref.mediaType?.startsWith('image/') === true ||
    ref.uri.startsWith('https://') && /\.(png|jpe?g|webp|gif)$/i.test(ref.uri)
}
