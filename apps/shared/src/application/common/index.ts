import { createId } from '@x-oasis/di';

import type { SupervisorInspectorSnapshot } from '@/packages/services/main-metrics/common';
import type {
  ApprovalRequestChangeEvent,
  ApprovalRequestRecord,
  ClaimRunIntentInput,
  CreateApprovalRequestInput,
  CreateRunControlCommandInput,
  CreateRunIntentInput,
  DecideApprovalInput,
  DeleteRunProjectionsForSessionInput,
  ListApprovalChangesOptions,
  ListApprovalRequestsOptions,
  ListRunControlCommandsOptions,
  ListRunIntentsOptions,
  ListRunProjectionChangesOptions,
  ListRunProjectionsOptions,
  RegisterRunProjectionInput,
  RunIntentRecord,
  RunControlCommandChangeEvent,
  RunControlCommandRecord,
  RunProjectionChangeEvent,
  RunProjectionRecord,
} from '@/packages/run-protocol';

export type {
  ApprovalRequest,
  ApprovalRequestChangeEvent,
  ApprovalRequestKind,
  ApprovalRequestRecord,
  ApprovalRequestStatus,
  ClaimRunIntentInput,
  CreateApprovalRequestInput,
  CreateRunControlCommandInput,
  CreateRunIntentInput,
  DeleteRunProjectionsForSessionInput,
  DecideApprovalInput,
  EventCursor,
  ListApprovalChangesOptions,
  ListApprovalRequestsOptions,
  ListRunControlCommandsOptions,
  ListRunIntentsOptions,
  ListRunProjectionChangesOptions,
  ListRunProjectionsOptions,
  RegisterRunProjectionInput,
  RunEventRecord,
  RunEventRecordKind,
  RunEventSource,
  RunEventSourceKind,
  RunIntent,
  RunIntentRecord,
  RunIntentStatus,
  RunControlCommandChangeEvent,
  RunControlCommandKind,
  RunControlCommandRecord,
  RunControlCommandStatus,
  RunProjectionChangeEvent,
  RunProjectionRecord,
  RunProjectionStatus,
  RunRecord,
  RunRecoveryStatus,
  RuntimeEventEnvelope,
} from '@/packages/run-protocol';
export type { RemoteActor, RemoteActorKind, RemoteActorSnapshot } from '@/packages/remote-protocol';

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
  deleteRunProjectionsForSession(input: DeleteRunProjectionsForSessionInput): Promise<RunProjectionRecord[]>;
  listRunProjectionChanges(options?: ListRunProjectionChangesOptions): Promise<RunProjectionChangeEvent[]>;
  subscribeRunProjections(callback: (event: RunProjectionChangeEvent) => void): EventSubscription;
  requestApproval(input: CreateApprovalRequestInput): Promise<ApprovalRequestRecord>;
  decideApproval(approvalId: string, input: DecideApprovalInput): Promise<ApprovalRequestRecord | null>;
  listApprovals(options?: ListApprovalRequestsOptions): Promise<ApprovalRequestRecord[]>;
  listApprovalChanges(options?: ListApprovalChangesOptions): Promise<ApprovalRequestChangeEvent[]>;
  subscribeApprovals(callback: (event: ApprovalRequestChangeEvent) => void): EventSubscription;
  requestRunControlCommand(input: CreateRunControlCommandInput): Promise<RunControlCommandRecord>;
  markRunControlCommandApplied(commandId: string, now?: number): Promise<RunControlCommandRecord | null>;
  listRunControlCommands(options?: ListRunControlCommandsOptions): Promise<RunControlCommandRecord[]>;
  listRunControlChanges(options?: ListRunControlCommandsOptions): Promise<RunControlCommandChangeEvent[]>;
  subscribeRunControlCommands(callback: (event: RunControlCommandChangeEvent) => void): EventSubscription;
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
