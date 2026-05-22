import type {
  ApprovalRequestRecord,
  ClaimRunIntentInput,
  CreateApprovalRequestInput,
  CreateRunIntentInput,
  DecideApprovalInput,
  ListApprovalRequestsOptions,
  ListRunIntentsOptions,
  ListRunProjectionsOptions,
  RegisterRunProjectionInput,
  RunIntentRecord,
  RunProjectionChangeEvent,
  RunProjectionRecord,
} from '@/apps/shared/application/common';

export class RunBrokerStore {
  private readonly intents = new Map<string, RunIntentRecord>();
  private readonly projections = new Map<string, RunProjectionRecord>();
  private readonly approvals = new Map<string, ApprovalRequestRecord>();
  private readonly projectionListeners = new Set<(event: RunProjectionChangeEvent) => void>();

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
      activeArtifactTitle: input.activeArtifactTitle ?? current?.activeArtifactTitle,
      error: input.error ?? current?.error,
      sourceIntentId: input.sourceIntentId ?? current?.sourceIntentId,
      metadata: input.metadata ?? current?.metadata,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
    });

    this.projections.set(input.runId, record);
    this.emitProjectionChanged(record);
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

  private emitProjectionChanged(record: RunProjectionRecord): void {
    const event: RunProjectionChangeEvent = {
      type: 'run_projection_changed',
      runId: record.runId,
      projection: clone(record),
      cursor: record.cursor,
    };
    for (const listener of this.projectionListeners) {
      try {
        listener(event);
      } catch {
        this.projectionListeners.delete(listener);
      }
    }
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
