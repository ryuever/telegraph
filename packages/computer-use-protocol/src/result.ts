import type { ObservationArtifactRef } from './observation.js';
import type { COMPUTER_USE_PROTOCOL_SCHEMA_VERSION } from './schema.js';

export type ComputerActionFailureReason =
  | 'permission_denied'
  | 'stale_ref'
  | 'coordinate_mismatch'
  | 'app_hidden'
  | 'timeout'
  | 'locked'
  | 'budget_exceeded'
  | 'stopped'
  | 'unknown';

export interface ActionResult {
  actionId: string;
  runId: string;
  ok: boolean;
  completedAt: number;
  failureReason?: ComputerActionFailureReason;
  message?: string;
  afterObservationRef?: ObservationArtifactRef;
  schemaVersion: typeof COMPUTER_USE_PROTOCOL_SCHEMA_VERSION;
}
