import type { RuntimeEvent } from '@/packages/agent-protocol';
import type { ApprovalRequestRecord } from './approval.js';
import type { RUN_PROTOCOL_SCHEMA_VERSION } from './schema.js';
import type { RunEventSource } from './source.js';

export interface RuntimeEventEnvelope {
  envelopeId?: string;
  runId: string;
  source: RunEventSource;
  cursor: number;
  ts: number;
  schemaVersion: typeof RUN_PROTOCOL_SCHEMA_VERSION;
  event: RuntimeEvent;
  rawRef?: string;
  artifactRef?: string;
}

export type RunEventRecordKind =
  | 'runtime_event'
  | 'approval_request'
  | 'approval_decision'
  | 'run_status'
  | 'system';

export interface RunEventRecord {
  eventId: string;
  runId: string;
  source: RunEventSource;
  cursor: number;
  ts: number;
  schemaVersion: typeof RUN_PROTOCOL_SCHEMA_VERSION;
  kind: RunEventRecordKind;
  runtimeEvent?: RuntimeEvent;
  approvalRequest?: ApprovalRequestRecord;
  status?: string;
  message?: string;
  rawRef?: string;
  artifactRef?: string;
  metadata?: Record<string, unknown>;
}
