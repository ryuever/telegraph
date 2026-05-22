import type { RUN_PROTOCOL_SCHEMA_VERSION } from './schema.js';
import type { RunEventSource } from './source.js';

export interface EventCursor {
  runId: string;
  cursor: number;
  source: RunEventSource;
  ts: number;
  schemaVersion: typeof RUN_PROTOCOL_SCHEMA_VERSION;
}

export type RunRecoveryStatus =
  | 'not_needed'
  | 'pending'
  | 'recovered'
  | 'failed'
  | 'unsupported';
