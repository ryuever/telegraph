import { createId } from '@x-oasis/di'
import type {
  ChannelReply,
  ChannelReplyDeliveryStatus,
  ChannelReplyStatus,
  DeviceBinding,
  ExternalMessage,
  RemoteActorSnapshot,
} from '@/packages/remote-protocol'
import type {
  ApprovalRequestChangeEvent,
  ApprovalRequestRecord,
  DecideApprovalInput,
  ListApprovalChangesOptions,
  ListApprovalRequestsOptions,
  ListRunControlCommandsOptions,
  ListRunIntentsOptions,
  ListRunProjectionChangesOptions,
  ListRunProjectionsOptions,
  CreateRunControlCommandInput,
  RunControlCommandChangeEvent,
  RunControlCommandRecord,
  RunIntentRecord,
  RunProjectionChangeEvent,
  RunProjectionRecord,
} from '@/packages/run-protocol'

export const REMOTE_CONTROL_PARTICIPANT_ID = 'remote-control'
export const REMOTE_CONTROL_PAGELET_SERVICE_PATH = 'remote-control-pagelet-api'

export interface RemoteControlSubmitOptions {
  targetPagelet?: string
  sessionId?: string
  requireDeviceBinding?: boolean
  settings?: RemoteControlRuntimeSettingsInput
}

export interface RemoteControlRuntimeSettingsInput {
  provider?: string
  modelId?: string
  apiKey?: string
  baseUrl?: string
  backend?: string
  orchestration?: string
  orchestrationPattern?: string
  worktreeIsolation?: boolean
  extensionBlocklist?: string[]
  taskCapabilityProfile?: unknown
}

export interface RemoteControlSubmissionResult {
  intent: RunIntentRecord
  reply: ChannelReply
}

export interface ListChannelRepliesOptions {
  channelId?: string
  threadId?: string
  runId?: string
  status?: ChannelReplyStatus
  deliveryStatus?: ChannelReplyDeliveryStatus
  afterCursor?: number
  limit?: number
}

export interface AckChannelReplyInput {
  replyId: string
  status: ChannelReplyDeliveryStatus
  deliveredBy?: RemoteActorSnapshot
  error?: string
  now?: number
}

export interface CreateDeviceBindingInput {
  bindingId?: string
  deviceId: string
  actor: RemoteActorSnapshot
  label?: string
  expiresAt?: number
}

export type SlackBindingStatus = 'active' | 'revoked'

export type SlackTeamRole = 'member' | 'operator' | 'admin'

export type SlackGovernanceAction =
  | 'ask'
  | 'runs'
  | 'approve'
  | 'deny'
  | 'block_approve'
  | 'block_deny'
  | 'app_installed'
  | 'device_bound'
  | 'device_revoked'
  | 'tokens_revoked'
  | 'user_left_workspace'
  | 'app_uninstalled'

export type SlackLifecycleEventKind =
  | 'tokens_revoked'
  | 'user_left_workspace'
  | 'app_uninstalled'

export interface SlackWorkspaceBinding {
  workspaceId: string
  teamDomain?: string
  status: SlackBindingStatus
  policyProfileId?: string
  createdAt: number
  updatedAt: number
  revokedAt?: number
}

export interface SlackUserBinding {
  workspaceId: string
  userId: string
  actorId: string
  status: SlackBindingStatus
  role: SlackTeamRole
  policyProfileId?: string
  createdAt: number
  updatedAt: number
  revokedAt?: number
}

export interface SlackDeviceBinding {
  bindingId: string
  workspaceId: string
  userId: string
  deviceId: string
  actorId: string
  label?: string
  status: SlackBindingStatus
  createdAt: number
  updatedAt: number
  revokedAt?: number
  expiresAt?: number
}

export interface SlackAppInstallation {
  installationId: string
  workspaceId: string
  teamDomain?: string
  enterpriseId?: string
  appId?: string
  botUserId?: string
  botTokenRef?: string
  userTokenRef?: string
  scopes: string[]
  status: SlackBindingStatus
  installedByUserId?: string
  policyProfileId?: string
  createdAt: number
  updatedAt: number
  revokedAt?: number
}

export interface SlackTeamAuditEvent {
  auditId: string
  ts: number
  action: SlackGovernanceAction
  status: 'accepted' | 'rejected'
  workspaceId?: string
  actorId: string
  channelId?: string
  threadId?: string
  policyProfileId?: string
  approvalId?: string
  reason?: string
}

export interface SlackTeamGovernanceSnapshot {
  installations: SlackAppInstallation[]
  workspaces: SlackWorkspaceBinding[]
  users: SlackUserBinding[]
  devices: SlackDeviceBinding[]
  auditEvents: SlackTeamAuditEvent[]
}

export interface SlackLifecycleEvent {
  kind: SlackLifecycleEventKind
  workspaceId: string
  userIds?: string[]
  actorId?: string
  reason?: string
  now?: number
}

export interface SlackLifecycleRevokeResult {
  kind: SlackLifecycleEventKind
  workspaceId: string
  revokedWorkspace: SlackWorkspaceBinding | null
  revokedUsers: SlackUserBinding[]
  revokedDevices: SlackDeviceBinding[]
  auditEvent: SlackTeamAuditEvent
}

export interface SlackOAuthCallbackInput {
  code: string
  state?: string
  redirectUri?: string
  policyProfileId?: string
  installerRole?: SlackTeamRole
  now?: number
}

export interface SlackOAuthCallbackResult {
  installation: SlackAppInstallation
  tokenRefs: {
    botTokenRef?: string
    userTokenRef?: string
  }
}

export interface CreateSlackWorkspaceBindingInput {
  workspaceId: string
  teamDomain?: string
  policyProfileId?: string
  now?: number
}

export interface CreateSlackAppInstallationInput {
  installationId?: string
  workspaceId: string
  teamDomain?: string
  enterpriseId?: string
  appId?: string
  botUserId?: string
  botTokenRef?: string
  userTokenRef?: string
  scopes?: string[]
  installedByUserId?: string
  installerRole?: SlackTeamRole
  policyProfileId?: string
  now?: number
}

export interface CreateSlackUserBindingInput {
  workspaceId: string
  userId: string
  actorId?: string
  role?: SlackTeamRole
  policyProfileId?: string
  now?: number
}

export interface CreateSlackDeviceBindingInput {
  bindingId?: string
  workspaceId: string
  userId: string
  deviceId: string
  actorId?: string
  label?: string
  expiresAt?: number
  now?: number
}

export interface IRemoteControlPageletService {
  info(): Promise<string>
  submitExternalMessage(
    message: ExternalMessage,
    options?: RemoteControlSubmitOptions,
  ): Promise<RemoteControlSubmissionResult>
  listChannelReplies(options?: ListChannelRepliesOptions): Promise<ChannelReply[]>
  subscribeChannelReplies(
    callback: (reply: ChannelReply) => void,
    options?: ListChannelRepliesOptions,
  ): Promise<EventSubscription>
  ackChannelReply(input: AckChannelReplyInput): Promise<ChannelReply | null>
  listApprovals(options?: ListApprovalRequestsOptions): Promise<ApprovalRequestRecord[]>
  listApprovalChanges(options?: ListApprovalChangesOptions): Promise<ApprovalRequestChangeEvent[]>
  subscribeApprovals(
    callback: (event: ApprovalRequestChangeEvent) => void,
    options?: ListApprovalChangesOptions,
  ): Promise<EventSubscription>
  decideApproval(approvalId: string, input: DecideApprovalInput): Promise<ApprovalRequestRecord | null>
  requestRunControlCommand(input: CreateRunControlCommandInput): Promise<RunControlCommandRecord>
  listRunControlCommands(options?: ListRunControlCommandsOptions): Promise<RunControlCommandRecord[]>
  listRunControlChanges(options?: ListRunControlCommandsOptions): Promise<RunControlCommandChangeEvent[]>
  subscribeRunControlCommands(
    callback: (event: RunControlCommandChangeEvent) => void,
    options?: ListRunControlCommandsOptions,
  ): Promise<EventSubscription>
  listRunIntents(options?: ListRunIntentsOptions): Promise<RunIntentRecord[]>
  listRunProjections(options?: ListRunProjectionsOptions): Promise<RunProjectionRecord[]>
  getRunProjection(runId: string): Promise<RunProjectionRecord | null>
  listRunProjectionChanges(options?: ListRunProjectionChangesOptions): Promise<RunProjectionChangeEvent[]>
  subscribeRunProjections(
    callback: (event: RunProjectionChangeEvent) => void,
    options?: ListRunProjectionChangesOptions,
  ): Promise<EventSubscription>
  listDeviceBindings(): Promise<DeviceBinding[]>
  createDeviceBinding(input: CreateDeviceBindingInput): Promise<DeviceBinding>
  revokeDeviceBinding(bindingId: string): Promise<DeviceBinding | null>
  listSlackWorkspaceBindings(): Promise<SlackWorkspaceBinding[]>
  createSlackWorkspaceBinding(input: CreateSlackWorkspaceBindingInput): Promise<SlackWorkspaceBinding>
  revokeSlackWorkspaceBinding(workspaceId: string): Promise<SlackWorkspaceBinding | null>
  listSlackAppInstallations(): Promise<SlackAppInstallation[]>
  createSlackAppInstallation(input: CreateSlackAppInstallationInput): Promise<SlackAppInstallation>
  revokeSlackAppInstallation(installationId: string): Promise<SlackAppInstallation | null>
  listSlackUserBindings(): Promise<SlackUserBinding[]>
  createSlackUserBinding(input: CreateSlackUserBindingInput): Promise<SlackUserBinding>
  revokeSlackUserBinding(workspaceId: string, userId: string): Promise<SlackUserBinding | null>
  listSlackDeviceBindings(): Promise<SlackDeviceBinding[]>
  createSlackDeviceBinding(input: CreateSlackDeviceBindingInput): Promise<SlackDeviceBinding>
  revokeSlackDeviceBinding(bindingId: string): Promise<SlackDeviceBinding | null>
  handleSlackOAuthCallback(input: SlackOAuthCallbackInput): Promise<SlackOAuthCallbackResult>
  listSlackTeamAuditEvents(): Promise<SlackTeamAuditEvent[]>
  handleSlackLifecycleEvent(event: SlackLifecycleEvent): Promise<SlackLifecycleRevokeResult>
  handleSlackSlashCommand(payload: unknown): Promise<ChannelReply>
  handleSlackEventCallback(payload: unknown): Promise<ChannelReply[]>
  handleSlackInteraction(payload: unknown): Promise<ChannelReply[]>
}

export interface EventSubscription {
  unsubscribe(): void
}

export interface IRemoteControlApplication {
  start(): Promise<void>
}

export const RemoteControlApplicationId = createId('RemoteControlApplication')
