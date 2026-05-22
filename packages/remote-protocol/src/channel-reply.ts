import type { RemoteArtifactRef } from './external-message.js';
import type { RemoteActorSnapshot } from './actor.js';
import type { REMOTE_PROTOCOL_SCHEMA_VERSION } from './schema.js';

export type ChannelReplyStatus = 'queued' | 'sent' | 'failed' | 'skipped';
export type ChannelReplyDeliveryStatus = 'pending' | 'sent' | 'failed' | 'skipped';

export interface ChannelReply {
  replyId: string;
  channelId: string;
  threadId?: string;
  runId?: string;
  cursor?: number;
  text?: string;
  artifactRefs?: RemoteArtifactRef[];
  status: ChannelReplyStatus;
  deliveryStatus?: ChannelReplyDeliveryStatus;
  deliveryAttempts?: number;
  deliveredAt?: number;
  deliveredBy?: RemoteActorSnapshot;
  deliveryError?: string;
  createdAt: number;
  updatedAt: number;
  schemaVersion: typeof REMOTE_PROTOCOL_SCHEMA_VERSION;
}
