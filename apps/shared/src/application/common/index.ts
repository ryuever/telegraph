import { createId } from '@x-oasis/di';

import type { SupervisorInspectorSnapshot } from '@/packages/services/main-metrics/common';

export const SHARED_PARTICIPANT_ID = 'shared';

export const SHARED_SERVICE_PATH = 'shared-rpc';

export interface ISharedService {
  echo(msg: string): Promise<string>;
  getConfig(key: string): Promise<string>;
  setConfig(key: string, value: string): Promise<string>;
  createRunIntent(input: CreateRunIntentInput): Promise<RunIntentRecord>;
  claimRunIntent(intentId: string, input: ClaimRunIntentInput): Promise<RunIntentRecord | null>;
  listRunIntents(options?: ListRunIntentsOptions): Promise<RunIntentRecord[]>;
  getRunIntent(intentId: string): Promise<RunIntentRecord | null>;
  registerRunProjection(input: RegisterRunProjectionInput): Promise<RunProjectionRecord>;
  listRunProjections(options?: ListRunProjectionsOptions): Promise<RunProjectionRecord[]>;
  getRunProjection(runId: string): Promise<RunProjectionRecord | null>;
  subscribeRunProjections(callback: (event: RunProjectionChangeEvent) => void): EventSubscription;
  requestApproval(input: CreateApprovalRequestInput): Promise<ApprovalRequestRecord>;
  decideApproval(approvalId: string, input: DecideApprovalInput): Promise<ApprovalRequestRecord | null>;
  listApprovals(options?: ListApprovalRequestsOptions): Promise<ApprovalRequestRecord[]>;
}

export interface ISharedApplication {
  start(): Promise<void>;
}

export const SharedApplicationId = createId('SharedApplication');

export interface ISharedProcess {
  spawn(): Promise<void>;
  getInspectorSnapshot(): SupervisorInspectorSnapshot | null;
  subscribeStateChange(listener: () => void): () => void;
}

export const SharedProcessId = createId('SharedProcess');

export interface EventSubscription {
  unsubscribe(): void;
}

export type RunIntentStatus = 'queued' | 'claimed' | 'cancelled' | 'expired';

export interface RemoteActorSnapshot {
  actorId: string;
  kind: 'desktop' | 'cli' | 'mobile' | 'telegram' | 'slack' | 'mcp' | 'webhook' | 'system';
  displayName?: string;
  deviceId?: string;
  channelId?: string;
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

export interface RunIntentRecord {
  intentId: string;
  source: RemoteActorSnapshot;
  targetPagelet: string;
  prompt: string;
  sessionId?: string;
  metadata?: Record<string, unknown>;
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

export type ApprovalRequestStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export interface CreateApprovalRequestInput {
  approvalId?: string;
  runId: string;
  source: RemoteActorSnapshot;
  kind: 'tool' | 'computer_action' | 'shell' | 'file_write' | 'network' | 'custom';
  title: string;
  body?: string;
  proposedAction?: Record<string, unknown>;
  expiresAt?: number;
  now?: number;
}

export interface DecideApprovalInput {
  granted: boolean;
  decidedBy: RemoteActorSnapshot;
  reason?: string;
  now?: number;
}

export interface ListApprovalRequestsOptions {
  runId?: string;
  status?: ApprovalRequestStatus;
  limit?: number;
}

export interface ApprovalRequestRecord {
  approvalId: string;
  runId: string;
  source: RemoteActorSnapshot;
  kind: CreateApprovalRequestInput['kind'];
  title: string;
  body?: string;
  proposedAction?: Record<string, unknown>;
  status: ApprovalRequestStatus;
  granted?: boolean;
  decidedBy?: RemoteActorSnapshot;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  decidedAt?: number;
}
