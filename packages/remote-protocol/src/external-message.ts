import type { RemoteActor } from './actor.js';
import type { REMOTE_PROTOCOL_SCHEMA_VERSION } from './schema.js';

export type ExternalChannelKind = 'cli' | 'mobile' | 'telegram' | 'slack' | 'mcp' | 'webhook';

export interface RemoteArtifactRef {
  artifactId: string;
  uri: string;
  mediaType?: string;
  title?: string;
  sizeBytes?: number;
  sha256?: string;
}

export interface ExternalMessage {
  messageId: string;
  actor: RemoteActor;
  channel: {
    kind: ExternalChannelKind;
    channelId: string;
    threadId?: string;
  };
  text?: string;
  command?: string;
  artifactRefs?: RemoteArtifactRef[];
  rawRef?: string;
  receivedAt: number;
  schemaVersion: typeof REMOTE_PROTOCOL_SCHEMA_VERSION;
}
