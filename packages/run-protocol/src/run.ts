import type { RemoteActorSnapshot, RemoteArtifactRef } from '@/packages/remote-protocol';
import type { RunRecoveryStatus } from './cursor.js';

export type RunIntentStatus = 'queued' | 'claimed' | 'cancelled' | 'expired';

export interface RunIntent {
  intentId: string;
  source: RemoteActorSnapshot;
  targetPagelet: string;
  prompt: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateRunIntentInput {
  intentId?: string;
  source: RemoteActorSnapshot;
  targetPagelet: string;
  prompt: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
  now?: number;
}

export interface ClaimRunIntentInput {
  claimedBy: string;
  runId: string;
  now?: number;
}

export interface ListRunIntentsOptions {
  status?: RunIntentStatus;
  targetPagelet?: string;
  limit?: number;
}

export interface RunIntentRecord extends RunIntent {
  status: RunIntentStatus;
  claimedBy?: string;
  runId?: string;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
}

export type RunProjectionStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'recovered';

export interface RegisterRunProjectionInput {
  runId: string;
  sessionId?: string;
  pageletId: string;
  status: RunProjectionStatus;
  title?: string;
  promptPreview?: string;
  cursor?: number;
  eventCount?: number;
  artifactCount?: number;
  artifactRefs?: RemoteArtifactRef[];
  activeArtifactTitle?: string;
  error?: string;
  sourceIntentId?: string;
  updatedAt?: number;
  metadata?: Record<string, unknown>;
}

export interface ListRunProjectionsOptions {
  pageletId?: string;
  status?: RunProjectionStatus;
  sessionId?: string;
  limit?: number;
}

export interface ListRunProjectionChangesOptions {
  runId?: string;
  pageletId?: string;
  status?: RunProjectionStatus;
  afterCursor?: number;
  limit?: number;
}

export interface DeleteRunProjectionsForSessionInput {
  sessionId: string;
  pageletId?: string;
}

export interface RunProjectionRecord {
  runId: string;
  sessionId?: string;
  pageletId: string;
  status: RunProjectionStatus;
  title?: string;
  promptPreview?: string;
  cursor: number;
  eventCount: number;
  artifactCount?: number;
  artifactRefs?: RemoteArtifactRef[];
  activeArtifactTitle?: string;
  error?: string;
  sourceIntentId?: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface RunProjectionChangeEvent {
  type: 'run_projection_changed';
  runId: string;
  projection: RunProjectionRecord;
  cursor: number;
}

export interface RunRecord {
  runId: string;
  pageletId: string;
  status: RunProjectionStatus;
  sessionId?: string;
  sourceIntentId?: string;
  recoveryStatus: RunRecoveryStatus;
  title?: string;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  metadata?: Record<string, unknown>;
}
