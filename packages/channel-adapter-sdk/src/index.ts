import type {
  ChannelReply,
  DeviceBinding,
  ExternalChannelKind,
  ExternalMessage,
  RemoteActorSnapshot,
} from '@/packages/remote-protocol';
import type {
  ApprovalRequestChangeEvent,
  ApprovalRequestRecord,
  DecideApprovalInput,
  ListApprovalChangesOptions,
  ListApprovalRequestsOptions,
  ListRunProjectionChangesOptions,
  ListRunProjectionsOptions,
  RunIntentRecord,
  RunProjectionChangeEvent,
  RunProjectionRecord,
} from '@/packages/run-protocol';

export const CHANNEL_ADAPTER_SDK_SCHEMA_VERSION = 1;

export type ChannelAdapterDeliveryStatus = 'sent' | 'failed' | 'skipped';

export interface ChannelAdapterManifest {
  schemaVersion: typeof CHANNEL_ADAPTER_SDK_SCHEMA_VERSION;
  adapterId: string;
  channelKind: ExternalChannelKind | (string & {});
  displayName: string;
  capabilities: ChannelAdapterCapabilities;
}

export interface ChannelAdapterCapabilities {
  intake: boolean;
  replies: boolean;
  artifacts: boolean;
  approvals: boolean;
  projectionChanges: boolean;
  deviceBinding: boolean;
}

export interface ChannelAdapterSubmitOptions {
  targetPagelet?: string;
  sessionId?: string;
  requireDeviceBinding?: boolean;
}

export interface ChannelAdapterSubmissionResult {
  intent: RunIntentRecord;
  reply: ChannelReply;
}

export interface ChannelAdapterReplyListOptions {
  channelId?: string;
  threadId?: string;
  runId?: string;
  afterCursor?: number;
  deliveryStatus?: ChannelReply['deliveryStatus'];
  limit?: number;
}

export interface ChannelAdapterReplyAckInput {
  replyId: string;
  status: ChannelAdapterDeliveryStatus;
  deliveredBy: RemoteActorSnapshot;
  error?: string;
}

export interface ChannelAdapterDeviceBindingInput {
  bindingId?: string;
  deviceId: string;
  actor: RemoteActorSnapshot;
  label?: string;
  expiresAt?: number;
}

export interface ChannelAdapterHost {
  submitExternalMessage(
    message: ExternalMessage,
    options?: ChannelAdapterSubmitOptions,
  ): Promise<ChannelAdapterSubmissionResult>;
  listChannelReplies(options?: ChannelAdapterReplyListOptions): Promise<ChannelReply[]>;
  ackChannelReply(input: ChannelAdapterReplyAckInput): Promise<ChannelReply | null>;
  listRunProjections(options?: ListRunProjectionsOptions): Promise<RunProjectionRecord[]>;
  getRunProjection(runId: string): Promise<RunProjectionRecord | null>;
  listRunProjectionChanges(options?: ListRunProjectionChangesOptions): Promise<RunProjectionChangeEvent[]>;
  listApprovals(options?: ListApprovalRequestsOptions): Promise<ApprovalRequestRecord[]>;
  listApprovalChanges(options?: ListApprovalChangesOptions): Promise<ApprovalRequestChangeEvent[]>;
  decideApproval(approvalId: string, input: DecideApprovalInput): Promise<ApprovalRequestRecord | null>;
  listDeviceBindings(): Promise<DeviceBinding[]>;
  createDeviceBinding(input: ChannelAdapterDeviceBindingInput): Promise<DeviceBinding>;
  revokeDeviceBinding(bindingId: string): Promise<DeviceBinding | null>;
}

export interface ChannelAdapterRuntime {
  manifest: ChannelAdapterManifest;
  start(host: ChannelAdapterHost): Promise<void> | void;
  stop?(): Promise<void> | void;
}

export function createChannelAdapterManifest(
  input: Omit<ChannelAdapterManifest, 'schemaVersion' | 'capabilities'> & {
    capabilities: Partial<ChannelAdapterCapabilities>;
  },
): ChannelAdapterManifest {
  return {
    schemaVersion: CHANNEL_ADAPTER_SDK_SCHEMA_VERSION,
    adapterId: input.adapterId,
    channelKind: input.channelKind,
    displayName: input.displayName,
    capabilities: normalizeCapabilities(input.capabilities),
  };
}

export function normalizeCapabilities(
  capabilities: Partial<ChannelAdapterCapabilities>,
): ChannelAdapterCapabilities {
  return {
    intake: capabilities.intake ?? false,
    replies: capabilities.replies ?? false,
    artifacts: capabilities.artifacts ?? false,
    approvals: capabilities.approvals ?? false,
    projectionChanges: capabilities.projectionChanges ?? false,
    deviceBinding: capabilities.deviceBinding ?? false,
  };
}
