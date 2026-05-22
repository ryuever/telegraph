import { RUNTIME_CONTRACT_SCHEMA_VERSION, type RuntimeEvent } from '@/packages/agent-protocol';
import { RUN_PROTOCOL_SCHEMA_VERSION, type ApprovalRequestRecord, type EventCursor, type RunEventRecord, type RunIntentRecord, type RuntimeEventEnvelope } from '@/packages/run-protocol';

const source = {
  kind: 'external_entry' as const,
  id: 'cli-gateway',
  actor: {
    actorId: 'cli:local',
    kind: 'cli' as const,
    displayName: 'Local CLI',
  },
};

export const goldenRunIntent: RunIntentRecord = {
  intentId: 'intent-1',
  source: source.actor,
  targetPagelet: 'design',
  prompt: 'Build a dashboard',
  status: 'queued',
  createdAt: 1_779_465_600_000,
  updatedAt: 1_779_465_600_000,
};

const runtimeStarted: RuntimeEvent = {
  type: 'run_started',
  runId: 'run-1',
  origin: {
    framework: 'telegraph',
  },
  producerVersion: 'telegraph@0.0.0',
  ts: 1_779_465_601_000,
  schemaVersion: RUNTIME_CONTRACT_SCHEMA_VERSION,
};

export const goldenEventCursor: EventCursor = {
  runId: 'run-1',
  cursor: 1,
  source,
  ts: runtimeStarted.ts,
  schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
};

export const goldenRuntimeEnvelope: RuntimeEventEnvelope = {
  runId: 'run-1',
  source,
  cursor: 1,
  ts: runtimeStarted.ts,
  schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
  event: runtimeStarted,
};

export const goldenApproval: ApprovalRequestRecord = {
  approvalId: 'approval-1',
  runId: 'run-1',
  source: source.actor,
  kind: 'computer_action',
  title: 'Observe active window',
  status: 'pending',
  createdAt: 1_779_465_602_000,
  updatedAt: 1_779_465_602_000,
};

export const goldenRunEventRecord: RunEventRecord = {
  eventId: 'event-1',
  runId: 'run-1',
  source,
  cursor: 1,
  ts: runtimeStarted.ts,
  schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
  kind: 'runtime_event',
  runtimeEvent: runtimeStarted,
};
