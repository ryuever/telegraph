import type { RemoteActorSnapshot } from '@/packages/remote-protocol';
import type { RunProjectionRecord, RunProjectionStatus } from './run.js';

export type RunControlCommandKind = 'pause' | 'cancel' | 'stop';

export type RunControlCommandStatus = 'accepted' | 'rejected' | 'applied';

export interface CreateRunControlCommandInput {
  commandId?: string;
  runId: string;
  kind: RunControlCommandKind;
  requestedBy: RemoteActorSnapshot;
  reason?: string;
  now?: number;
}

export interface RunControlCommandRecord {
  commandId: string;
  runId: string;
  kind: RunControlCommandKind;
  status: RunControlCommandStatus;
  requestedBy: RemoteActorSnapshot;
  reason?: string;
  rejectionReason?: string;
  createdAt: number;
  updatedAt: number;
  appliedAt?: number;
}

export interface RunControlCommandChangeEvent {
  type: 'run_control_command_changed';
  commandId: string;
  runId: string;
  command: RunControlCommandRecord;
  cursor: number;
}

export interface ListRunControlCommandsOptions {
  runId?: string;
  status?: RunControlCommandStatus;
  kind?: RunControlCommandKind;
  afterCursor?: number;
  limit?: number;
}

export interface RunControlDecision {
  allowed: boolean;
  reason?: string;
}

export function evaluateRunControlCommand(
  projection: Pick<RunProjectionRecord, 'status'> | null | undefined,
  kind: RunControlCommandKind,
): RunControlDecision {
  if (!projection) return { allowed: false, reason: 'run not found' };
  if (isTerminalProjectionStatus(projection.status)) {
    return { allowed: false, reason: `run is already ${projection.status}` };
  }
  if (kind === 'pause') {
    return projection.status === 'running'
      ? { allowed: true }
      : { allowed: false, reason: `pause requires running status, got ${projection.status}` };
  }
  if (kind === 'cancel') {
    return projection.status === 'queued' || projection.status === 'running'
      ? { allowed: true }
      : { allowed: false, reason: `cancel requires queued or running status, got ${projection.status}` };
  }
  if (kind === 'stop') {
    return projection.status === 'running'
      ? { allowed: true }
      : { allowed: false, reason: `stop requires running status, got ${projection.status}` };
  }
  return { allowed: false, reason: `unknown control command: ${String(kind)}` };
}

function isTerminalProjectionStatus(status: RunProjectionStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'recovered';
}
