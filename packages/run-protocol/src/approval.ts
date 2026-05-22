import type { RemoteActorSnapshot } from '@/packages/remote-protocol';

export type ApprovalRequestStatus = 'pending' | 'approved' | 'denied' | 'cancelled';

export type ApprovalRequestKind =
  | 'tool'
  | 'computer_action'
  | 'shell'
  | 'file_write'
  | 'network'
  | 'custom';

export interface ApprovalRequest {
  approvalId: string;
  runId: string;
  source: RemoteActorSnapshot;
  kind: ApprovalRequestKind;
  title: string;
  body?: string;
  proposedAction?: Record<string, unknown>;
  expiresAt?: number;
}

export interface CreateApprovalRequestInput {
  approvalId?: string;
  runId: string;
  source: RemoteActorSnapshot;
  kind: ApprovalRequestKind;
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

export interface ListApprovalChangesOptions extends ListApprovalRequestsOptions {
  afterCursor?: number;
}

export interface ApprovalRequestRecord extends ApprovalRequest {
  status: ApprovalRequestStatus;
  granted?: boolean;
  decidedBy?: RemoteActorSnapshot;
  reason?: string;
  createdAt: number;
  updatedAt: number;
  decidedAt?: number;
}

export interface ApprovalRequestChangeEvent {
  type: 'approval_request_changed';
  approvalId: string;
  runId: string;
  approval: ApprovalRequestRecord;
  cursor: number;
}
