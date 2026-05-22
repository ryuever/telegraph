import type { ChannelReply, ExternalMessage, RemoteActorSnapshot } from '@/packages/remote-protocol';
import type { ApprovalRequestChangeEvent, RunProjectionChangeEvent } from '@/packages/run-protocol';

export const RELAY_PROTOCOL_SCHEMA_VERSION = 1;

export type RelayDeploymentMode = 'local-dev' | 'self-host' | 'cloud';
export type RelayParticipantRole = 'desktop' | 'channel-adapter' | 'mobile' | 'observer';

export type RelayPayload =
  | { kind: 'external_message'; message: ExternalMessage }
  | { kind: 'channel_reply'; reply: ChannelReply }
  | { kind: 'projection_change'; event: RunProjectionChangeEvent }
  | { kind: 'approval_change'; event: ApprovalRequestChangeEvent };

export interface RelayEnvelope {
  envelopeId: string;
  from: string;
  to: string;
  cursor: number;
  payload: RelayPayload;
  createdAt: number;
  schemaVersion: typeof RELAY_PROTOCOL_SCHEMA_VERSION;
}

export interface RelayParticipant {
  participantId: string;
  role: RelayParticipantRole;
  actor?: RemoteActorSnapshot;
  deviceId?: string;
  connectedAt: number;
  lastSeenAt: number;
}

export interface RelayBoundaryPolicy {
  deploymentMode: RelayDeploymentMode;
  localOnlySecrets: boolean;
  storesDesktopExecutionCapability: false;
  allowedPayloadKinds: RelayPayload['kind'][];
}

export interface PublishRelayPayloadInput {
  from: string;
  to: string;
  payload: RelayPayload;
  now?: number;
}

export interface ListRelayEnvelopesOptions {
  participantId: string;
  afterCursor?: number;
  limit?: number;
}

export interface SelfHostRelay {
  readonly boundaryPolicy: RelayBoundaryPolicy;
  registerParticipant(participant: Omit<RelayParticipant, 'connectedAt' | 'lastSeenAt'> & { now?: number }): RelayParticipant;
  publish(input: PublishRelayPayloadInput): RelayEnvelope;
  list(options: ListRelayEnvelopesOptions): RelayEnvelope[];
}

export class InMemorySelfHostRelay implements SelfHostRelay {
  readonly boundaryPolicy: RelayBoundaryPolicy;
  private readonly participants = new Map<string, RelayParticipant>();
  private readonly envelopes: RelayEnvelope[] = [];
  private cursor = 0;

  constructor(policy: Partial<RelayBoundaryPolicy> = {}) {
    this.boundaryPolicy = {
      deploymentMode: policy.deploymentMode ?? 'self-host',
      localOnlySecrets: policy.localOnlySecrets ?? true,
      storesDesktopExecutionCapability: false,
      allowedPayloadKinds: policy.allowedPayloadKinds ?? [
        'external_message',
        'channel_reply',
        'projection_change',
        'approval_change',
      ],
    };
  }

  registerParticipant(
    participant: Omit<RelayParticipant, 'connectedAt' | 'lastSeenAt'> & { now?: number },
  ): RelayParticipant {
    const now = participant.now ?? Date.now();
    const record: RelayParticipant = pruneUndefined({
      participantId: participant.participantId,
      role: participant.role,
      actor: participant.actor,
      deviceId: participant.deviceId,
      connectedAt: this.participants.get(participant.participantId)?.connectedAt ?? now,
      lastSeenAt: now,
    });
    this.participants.set(record.participantId, record);
    return structuredClone(record);
  }

  publish(input: PublishRelayPayloadInput): RelayEnvelope {
    this.assertParticipant(input.from);
    this.assertParticipant(input.to);
    if (!this.boundaryPolicy.allowedPayloadKinds.includes(input.payload.kind)) {
      throw new Error(`Relay payload kind "${input.payload.kind}" is not allowed.`);
    }

    const envelope: RelayEnvelope = {
      envelopeId: `relay-${String(this.cursor + 1)}`,
      from: input.from,
      to: input.to,
      cursor: this.cursor + 1,
      payload: structuredClone(input.payload),
      createdAt: input.now ?? Date.now(),
      schemaVersion: RELAY_PROTOCOL_SCHEMA_VERSION,
    };
    this.cursor = envelope.cursor;
    this.envelopes.push(envelope);
    return structuredClone(envelope);
  }

  list(options: ListRelayEnvelopesOptions): RelayEnvelope[] {
    this.assertParticipant(options.participantId);
    return this.envelopes
      .filter(envelope => envelope.to === options.participantId)
      .filter(envelope => options.afterCursor === undefined || envelope.cursor > options.afterCursor)
      .sort((a, b) => a.cursor - b.cursor)
      .slice(0, options.limit ?? 100)
      .map(envelope => structuredClone(envelope));
  }

  private assertParticipant(participantId: string): void {
    if (!this.participants.has(participantId)) {
      throw new Error(`Relay participant is not registered: ${participantId}`);
    }
  }
}

export function assertRoutingOnlyRelayPolicy(policy: RelayBoundaryPolicy): void {
  if (policy.storesDesktopExecutionCapability !== false) {
    throw new Error('Relay must not store desktop execution capability.');
  }
  const forbidden = policy.allowedPayloadKinds.filter(kind => ![
    'external_message',
    'channel_reply',
    'projection_change',
    'approval_change',
  ].includes(kind));
  if (forbidden.length > 0) {
    throw new Error(`Relay policy includes unsupported payload kinds: ${forbidden.join(', ')}`);
  }
}

export function deploymentBoundary(mode: RelayDeploymentMode): RelayBoundaryPolicy {
  return {
    deploymentMode: mode,
    localOnlySecrets: mode !== 'cloud',
    storesDesktopExecutionCapability: false,
    allowedPayloadKinds: [
      'external_message',
      'channel_reply',
      'projection_change',
      'approval_change',
    ],
  };
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
