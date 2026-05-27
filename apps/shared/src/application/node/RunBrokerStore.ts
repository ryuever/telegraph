import {
  evaluateRunControlCommand,
  type ApprovalRequestChangeEvent,
  type ApprovalRequestRecord,
  type ClaimRunIntentInput,
  type CreateApprovalRequestInput,
  type CreateRunControlCommandInput,
  type CreateRunIntentInput,
  type DecideApprovalInput,
  type DeleteRunProjectionsForSessionInput,
  type ListApprovalChangesOptions,
  type ListApprovalRequestsOptions,
  type ListRunControlCommandsOptions,
  type ListRunIntentsOptions,
  type ListRunProjectionChangesOptions,
  type ListRunProjectionsOptions,
  type RegisterRunProjectionInput,
  type RunControlCommandChangeEvent,
  type RunControlCommandRecord,
  type RunIntentRecord,
  type RunProjectionChangeEvent,
  type RunProjectionRecord,
} from '@/packages/run-protocol';
import type { RunBrokerStateRepository, RunBrokerStateSnapshot } from './RunBrokerStateRepository';

export class RunBrokerStore {
  private readonly intents = new Map<string, RunIntentRecord>();
  private readonly projections = new Map<string, RunProjectionRecord>();
  private readonly projectionHistory = new Map<string, RunProjectionChangeEvent[]>();
  private readonly approvals = new Map<string, ApprovalRequestRecord>();
  private readonly runControlCommands = new Map<string, RunControlCommandRecord>();
  private readonly projectionListeners = new Set<(event: RunProjectionChangeEvent) => void>();
  private readonly approvalHistory: ApprovalRequestChangeEvent[] = [];
  private readonly approvalListeners = new Set<(event: ApprovalRequestChangeEvent) => void>();
  private readonly runControlHistory: RunControlCommandChangeEvent[] = [];
  private readonly runControlListeners = new Set<(event: RunControlCommandChangeEvent) => void>();
  private approvalChangeCursor = 0;
  private runControlChangeCursor = 0;

  constructor(
    private readonly projectionHistoryLimit = 500,
    private readonly repository?: RunBrokerStateRepository,
  ) {
    this.hydrate(repository?.load() ?? null);
  }

  createRunIntent(input: CreateRunIntentInput): RunIntentRecord {
    const now = input.now ?? Date.now();
    const intentId = input.intentId ?? createId('intent', now);
    const existing = this.intents.get(intentId);
    if (existing) return clone(existing);

    const record: RunIntentRecord = pruneUndefined({
      intentId,
      source: input.source,
      targetPagelet: input.targetPagelet,
      prompt: input.prompt,
      sessionId: input.sessionId,
      metadata: input.metadata,
      status: 'queued' as const,
      createdAt: now,
      updatedAt: now,
    });
    this.intents.set(intentId, record);
    this.persist();
    return clone(record);
  }

  claimRunIntent(intentId: string, input: ClaimRunIntentInput): RunIntentRecord | null {
    const current = this.intents.get(intentId);
    if (!current) return null;
    if (current.status !== 'queued') return clone(current);

    const now = input.now ?? Date.now();
    const next: RunIntentRecord = pruneUndefined({
      ...current,
      status: 'claimed' as const,
      claimedBy: input.claimedBy,
      runId: input.runId,
      claimedAt: now,
      updatedAt: now,
    });
    this.intents.set(intentId, next);
    this.persist();
    return clone(next);
  }

  listRunIntents(options: ListRunIntentsOptions = {}): RunIntentRecord[] {
    return Array.from(this.intents.values())
      .filter(record => !options.status || record.status === options.status)
      .filter(record => !options.targetPagelet || record.targetPagelet === options.targetPagelet)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, options.limit ?? 100)
      .map(clone);
  }

  getRunIntent(intentId: string): RunIntentRecord | null {
    const record = this.intents.get(intentId);
    return record ? clone(record) : null;
  }

  registerRunProjection(input: RegisterRunProjectionInput): RunProjectionRecord {
    const current = this.projections.get(input.runId);
    const now = input.updatedAt ?? Date.now();
    const nextCursor = input.cursor ?? ((current?.cursor ?? 0) + 1);
    const record: RunProjectionRecord = pruneUndefined({
      runId: input.runId,
      sessionId: input.sessionId ?? current?.sessionId,
      pageletId: input.pageletId,
      status: input.status,
      title: input.title ?? current?.title,
      promptPreview: input.promptPreview ?? current?.promptPreview,
      cursor: nextCursor,
      eventCount: input.eventCount ?? current?.eventCount ?? 0,
      artifactCount: input.artifactCount ?? current?.artifactCount,
      artifactRefs: input.artifactRefs ?? current?.artifactRefs,
      activeArtifactTitle: input.activeArtifactTitle ?? current?.activeArtifactTitle,
      error: input.error ?? current?.error,
      sourceIntentId: input.sourceIntentId ?? current?.sourceIntentId,
      metadata: input.metadata ?? current?.metadata,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });

    this.projections.set(input.runId, record);
    this.emitProjectionChanged(record);
    this.persist();
    return clone(record);
  }

  listRunProjections(options: ListRunProjectionsOptions = {}): RunProjectionRecord[] {
    return Array.from(this.projections.values())
      .filter(record => !options.pageletId || record.pageletId === options.pageletId)
      .filter(record => !options.status || record.status === options.status)
      .filter(record => !options.sessionId || record.sessionId === options.sessionId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, options.limit ?? 100)
      .map(clone);
  }

  getRunProjection(runId: string): RunProjectionRecord | null {
    const record = this.projections.get(runId);
    return record ? clone(record) : null;
  }

  deleteRunProjection(runId: string): RunProjectionRecord | null {
    const record = this.projections.get(runId);
    if (!record) return null;
    this.projections.delete(runId);
    this.projectionHistory.delete(runId);
    for (const [approvalId, approval] of this.approvals) {
      if (approval.runId === runId) this.approvals.delete(approvalId);
    }
    this.approvalHistory.splice(
      0,
      this.approvalHistory.length,
      ...this.approvalHistory.filter(event => event.runId !== runId),
    );
    for (const [commandId, command] of this.runControlCommands) {
      if (command.runId === runId) this.runControlCommands.delete(commandId);
    }
    this.runControlHistory.splice(
      0,
      this.runControlHistory.length,
      ...this.runControlHistory.filter(event => event.runId !== runId),
    );
    this.persist();
    return clone(record);
  }

  deleteRunProjectionsForSession(input: DeleteRunProjectionsForSessionInput): RunProjectionRecord[] {
    const deleted: RunProjectionRecord[] = [];
    for (const record of Array.from(this.projections.values())) {
      if (record.sessionId !== input.sessionId) continue;
      if (input.pageletId && record.pageletId !== input.pageletId) continue;
      const removed = this.deleteRunProjection(record.runId);
      if (removed) deleted.push(removed);
    }
    return deleted;
  }

  listRunProjectionChanges(options: ListRunProjectionChangesOptions = {}): RunProjectionChangeEvent[] {
    const source = options.runId
      ? this.projectionHistory.get(options.runId) ?? []
      : Array.from(this.projectionHistory.values()).flat();
    return source
      .filter(event => !options.afterCursor || event.cursor > options.afterCursor)
      .filter(event => !options.pageletId || event.projection.pageletId === options.pageletId)
      .filter(event => !options.status || event.projection.status === options.status)
      .sort((a, b) => {
        if (a.projection.updatedAt !== b.projection.updatedAt) return a.projection.updatedAt - b.projection.updatedAt;
        return a.cursor - b.cursor;
      })
      .slice(0, options.limit ?? 100)
      .map(clone);
  }

  subscribeRunProjections(callback: (event: RunProjectionChangeEvent) => void): { unsubscribe(): void } {
    this.projectionListeners.add(callback);
    return {
      unsubscribe: () => {
        this.projectionListeners.delete(callback);
      },
    };
  }

  requestApproval(input: CreateApprovalRequestInput): ApprovalRequestRecord {
    const now = input.now ?? Date.now();
    const approvalId = input.approvalId ?? createId('approval', now);
    const existing = this.approvals.get(approvalId);
    if (existing) return clone(existing);

    const record: ApprovalRequestRecord = pruneUndefined({
      approvalId,
      runId: input.runId,
      source: input.source,
      kind: input.kind,
      title: input.title,
      body: input.body,
      proposedAction: input.proposedAction,
      status: 'pending' as const,
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    });
    this.approvals.set(approvalId, record);
    this.emitApprovalChanged(record);
    this.persist();
    return clone(record);
  }

  decideApproval(approvalId: string, input: DecideApprovalInput): ApprovalRequestRecord | null {
    const current = this.approvals.get(approvalId);
    if (!current) return null;
    if (current.status !== 'pending') return clone(current);

    const now = input.now ?? Date.now();
    const next: ApprovalRequestRecord = pruneUndefined({
      ...current,
      status: input.granted ? 'approved' as const : 'denied' as const,
      granted: input.granted,
      decidedBy: input.decidedBy,
      reason: input.reason,
      decidedAt: now,
      updatedAt: now,
    });
    this.approvals.set(approvalId, next);
    this.emitApprovalChanged(next);
    this.persist();
    return clone(next);
  }

  listApprovals(options: ListApprovalRequestsOptions = {}): ApprovalRequestRecord[] {
    return Array.from(this.approvals.values())
      .filter(record => !options.runId || record.runId === options.runId)
      .filter(record => !options.status || record.status === options.status)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, options.limit ?? 100)
      .map(clone);
  }

  listApprovalChanges(options: ListApprovalChangesOptions = {}): ApprovalRequestChangeEvent[] {
    return this.approvalHistory
      .filter(event => !options.afterCursor || event.cursor > options.afterCursor)
      .filter(event => !options.runId || event.runId === options.runId)
      .filter(event => !options.status || event.approval.status === options.status)
      .sort((a, b) => a.cursor - b.cursor)
      .slice(0, options.limit ?? 100)
      .map(clone);
  }

  subscribeApprovals(callback: (event: ApprovalRequestChangeEvent) => void): { unsubscribe(): void } {
    this.approvalListeners.add(callback);
    return {
      unsubscribe: () => {
        this.approvalListeners.delete(callback);
      },
    };
  }

  requestRunControlCommand(input: CreateRunControlCommandInput): RunControlCommandRecord {
    const now = input.now ?? Date.now();
    const commandId = input.commandId ?? createId('runctl', now);
    const existing = this.runControlCommands.get(commandId);
    if (existing) return clone(existing);

    const decision = evaluateRunControlCommand(this.projections.get(input.runId), input.kind);
    const record: RunControlCommandRecord = pruneUndefined({
      commandId,
      runId: input.runId,
      kind: input.kind,
      requestedBy: input.requestedBy,
      reason: input.reason,
      status: decision.allowed ? 'accepted' as const : 'rejected' as const,
      rejectionReason: decision.reason,
      createdAt: now,
      updatedAt: now,
    });
    this.runControlCommands.set(commandId, record);
    this.emitRunControlChanged(record);
    this.persist();
    return clone(record);
  }

  markRunControlCommandApplied(commandId: string, now = Date.now()): RunControlCommandRecord | null {
    const current = this.runControlCommands.get(commandId);
    if (!current) return null;
    if (current.status !== 'accepted') return clone(current);
    const next: RunControlCommandRecord = pruneUndefined({
      ...current,
      status: 'applied' as const,
      appliedAt: now,
      updatedAt: now,
    });
    this.runControlCommands.set(commandId, next);
    this.emitRunControlChanged(next);
    this.persist();
    return clone(next);
  }

  listRunControlCommands(options: ListRunControlCommandsOptions = {}): RunControlCommandRecord[] {
    return Array.from(this.runControlCommands.values())
      .filter(record => !options.runId || record.runId === options.runId)
      .filter(record => !options.status || record.status === options.status)
      .filter(record => !options.kind || record.kind === options.kind)
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, options.limit ?? 100)
      .map(clone);
  }

  listRunControlChanges(options: ListRunControlCommandsOptions = {}): RunControlCommandChangeEvent[] {
    return this.runControlHistory
      .filter(event => !options.afterCursor || event.cursor > options.afterCursor)
      .filter(event => !options.runId || event.runId === options.runId)
      .filter(event => !options.status || event.command.status === options.status)
      .filter(event => !options.kind || event.command.kind === options.kind)
      .sort((a, b) => a.cursor - b.cursor)
      .slice(0, options.limit ?? 100)
      .map(clone);
  }

  subscribeRunControlCommands(callback: (event: RunControlCommandChangeEvent) => void): { unsubscribe(): void } {
    this.runControlListeners.add(callback);
    return {
      unsubscribe: () => {
        this.runControlListeners.delete(callback);
      },
    };
  }

  private emitProjectionChanged(record: RunProjectionRecord): void {
    const event: RunProjectionChangeEvent = {
      type: 'run_projection_changed',
      runId: record.runId,
      projection: clone(record),
      cursor: record.cursor,
    };
    this.recordProjectionChange(event);
    for (const listener of this.projectionListeners) {
      try {
        listener(event);
      } catch {
        this.projectionListeners.delete(listener);
      }
    }
  }

  private recordProjectionChange(event: RunProjectionChangeEvent): void {
    const history = this.projectionHistory.get(event.runId) ?? [];
    history.push(clone(event));
    if (history.length > this.projectionHistoryLimit) {
      history.splice(0, history.length - this.projectionHistoryLimit);
    }
    this.projectionHistory.set(event.runId, history);
  }

  private emitApprovalChanged(record: ApprovalRequestRecord): void {
    const event: ApprovalRequestChangeEvent = {
      type: 'approval_request_changed',
      approvalId: record.approvalId,
      runId: record.runId,
      approval: clone(record),
      cursor: this.approvalChangeCursor + 1,
    };
    this.recordApprovalChange(event);
    for (const listener of this.approvalListeners) {
      try {
        listener(event);
      } catch {
        this.approvalListeners.delete(listener);
      }
    }
  }

  private recordApprovalChange(event: ApprovalRequestChangeEvent): void {
    this.approvalChangeCursor = Math.max(this.approvalChangeCursor, event.cursor);
    this.approvalHistory.push(clone(event));
    if (this.approvalHistory.length > this.projectionHistoryLimit) {
      this.approvalHistory.splice(0, this.approvalHistory.length - this.projectionHistoryLimit);
    }
  }

  private emitRunControlChanged(record: RunControlCommandRecord): void {
    const event: RunControlCommandChangeEvent = {
      type: 'run_control_command_changed',
      commandId: record.commandId,
      runId: record.runId,
      command: clone(record),
      cursor: this.runControlChangeCursor + 1,
    };
    this.recordRunControlChange(event);
    for (const listener of this.runControlListeners) {
      try {
        listener(event);
      } catch {
        this.runControlListeners.delete(listener);
      }
    }
  }

  private recordRunControlChange(event: RunControlCommandChangeEvent): void {
    this.runControlChangeCursor = Math.max(this.runControlChangeCursor, event.cursor);
    this.runControlHistory.push(clone(event));
    if (this.runControlHistory.length > this.projectionHistoryLimit) {
      this.runControlHistory.splice(0, this.runControlHistory.length - this.projectionHistoryLimit);
    }
  }

  private hydrate(snapshot: RunBrokerStateSnapshot | null): void {
    if (!snapshot) return;
    for (const intent of snapshot.intents) this.intents.set(intent.intentId, clone(intent));
    for (const projection of snapshot.projections) this.projections.set(projection.runId, clone(projection));
    for (const approval of snapshot.approvals) this.approvals.set(approval.approvalId, clone(approval));
    for (const command of snapshot.runControlCommands ?? []) this.runControlCommands.set(command.commandId, clone(command));
    for (const event of snapshot.projectionHistory) this.recordProjectionChange(event);
    for (const event of snapshot.approvalHistory ?? []) this.recordApprovalChange(event);
    for (const event of snapshot.runControlHistory ?? []) this.recordRunControlChange(event);
  }

  private persist(): void {
    this.repository?.save({
      intents: Array.from(this.intents.values()).map(clone),
      projections: Array.from(this.projections.values()).map(clone),
      projectionHistory: Array.from(this.projectionHistory.values()).flat().map(clone),
      approvals: Array.from(this.approvals.values()).map(clone),
      approvalHistory: this.approvalHistory.map(clone),
      runControlCommands: Array.from(this.runControlCommands.values()).map(clone),
      runControlHistory: this.runControlHistory.map(clone),
    });
  }
}

let idCounter = 0;

function createId(prefix: string, now: number): string {
  idCounter += 1;
  return `${prefix}_${String(now)}_${String(idCounter)}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
