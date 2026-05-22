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
