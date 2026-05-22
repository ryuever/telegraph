import type { ObservationArtifactRef } from './observation.js';
import type { COMPUTER_USE_PROTOCOL_SCHEMA_VERSION } from './schema.js';
import type { ComputerTarget } from './target.js';

export type ComputerActionKind = 'click' | 'type' | 'hotkey' | 'scroll' | 'wait' | 'observe';

export interface ComputerAction {
  actionId: string;
  runId: string;
  target: ComputerTarget;
  kind: ComputerActionKind;
  input?: Record<string, unknown>;
  approvalId?: string;
  beforeObservationRef?: ObservationArtifactRef;
  requestedAt: number;
  schemaVersion: typeof COMPUTER_USE_PROTOCOL_SCHEMA_VERSION;
}
