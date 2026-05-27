import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { RunBrokerStore } from '../RunBrokerStore';
import { FileRunBrokerStateRepository } from '../RunBrokerStateRepository';

const desktopActor = {
  actorId: 'desktop:user',
  kind: 'desktop' as const,
  displayName: 'Desktop User',
};

const cleanupDirs: string[] = [];

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('RunBrokerStore', () => {
  it('creates and claims run intents once', () => {
    const store = new RunBrokerStore();
    const intent = store.createRunIntent({
      intentId: 'intent-1',
      source: desktopActor,
      targetPagelet: 'design',
      prompt: 'make a dashboard',
      sessionId: 'session-1',
      now: 100,
    });

    expect(intent).toMatchObject({
      intentId: 'intent-1',
      targetPagelet: 'design',
      status: 'queued',
      createdAt: 100,
    });

    const claimed = store.claimRunIntent('intent-1', {
      claimedBy: 'pagelet:design:1',
      runId: 'run-1',
      now: 120,
    });
    const secondClaim = store.claimRunIntent('intent-1', {
      claimedBy: 'pagelet:design:2',
      runId: 'run-2',
      now: 130,
    });

    expect(claimed).toMatchObject({
      status: 'claimed',
      claimedBy: 'pagelet:design:1',
      runId: 'run-1',
      claimedAt: 120,
    });
    expect(secondClaim).toMatchObject({
      status: 'claimed',
      claimedBy: 'pagelet:design:1',
      runId: 'run-1',
    });
  });

  it('registers run projections and notifies subscribers with cursors', () => {
    const store = new RunBrokerStore();
    const events: string[] = [];
    const subscription = store.subscribeRunProjections(event => {
      events.push(`${event.runId}:${String(event.cursor)}:${event.projection.status}`);
    });

    store.registerRunProjection({
      runId: 'run-1',
      sessionId: 'session-1',
      pageletId: 'design',
      status: 'running',
      promptPreview: 'make a dashboard',
      eventCount: 2,
      updatedAt: 200,
    });
    store.registerRunProjection({
      runId: 'run-1',
      pageletId: 'design',
      status: 'completed',
      artifactCount: 1,
      artifactRefs: [{
        artifactId: 'dashboard.png',
        uri: 'telegraph://computer-use-artifacts/run-1/dashboard.png',
      }],
      activeArtifactTitle: 'Dashboard',
      updatedAt: 250,
    });

    expect(store.getRunProjection('run-1')).toMatchObject({
      runId: 'run-1',
      sessionId: 'session-1',
      pageletId: 'design',
      status: 'completed',
      promptPreview: 'make a dashboard',
      cursor: 2,
      eventCount: 2,
      artifactCount: 1,
      artifactRefs: [{
        artifactId: 'dashboard.png',
        uri: 'telegraph://computer-use-artifacts/run-1/dashboard.png',
      }],
      activeArtifactTitle: 'Dashboard',
    });
    expect(events).toEqual([
      'run-1:1:running',
      'run-1:2:completed',
    ]);

    subscription.unsubscribe();
    store.registerRunProjection({
      runId: 'run-2',
      pageletId: 'chat',
      status: 'running',
    });
    expect(events).toHaveLength(2);
  });

  it('keeps cursor-addressable projection changes for reconnect replay', () => {
    const store = new RunBrokerStore();

    store.registerRunProjection({
      runId: 'run-1',
      pageletId: 'design',
      status: 'queued',
      updatedAt: 100,
    });
    store.registerRunProjection({
      runId: 'run-1',
      pageletId: 'design',
      status: 'running',
      updatedAt: 110,
    });
    store.registerRunProjection({
      runId: 'run-1',
      pageletId: 'design',
      status: 'completed',
      updatedAt: 120,
    });

    expect(store.listRunProjectionChanges({
      runId: 'run-1',
      afterCursor: 1,
    }).map(event => `${String(event.cursor)}:${event.projection.status}`)).toEqual([
      '2:running',
      '3:completed',
    ]);
  });

  it('deletes run projections for one session and pagelet', () => {
    const store = new RunBrokerStore();
    store.registerRunProjection({
      runId: 'chat-run-delete',
      sessionId: 'session-delete',
      pageletId: 'chat',
      status: 'completed',
      updatedAt: 100,
    });
    store.registerRunProjection({
      runId: 'design-run-keep',
      sessionId: 'session-delete',
      pageletId: 'design',
      status: 'completed',
      updatedAt: 101,
    });
    store.registerRunProjection({
      runId: 'chat-run-keep',
      sessionId: 'session-keep',
      pageletId: 'chat',
      status: 'completed',
      updatedAt: 102,
    });
    store.requestApproval({
      approvalId: 'approval-delete',
      runId: 'chat-run-delete',
      source: desktopActor,
      kind: 'tool',
      title: 'Delete me too',
      now: 103,
    });
    store.requestRunControlCommand({
      commandId: 'command-delete',
      runId: 'chat-run-delete',
      kind: 'stop',
      requestedBy: desktopActor,
      now: 104,
    });

    const deleted = store.deleteRunProjectionsForSession({ sessionId: 'session-delete', pageletId: 'chat' });

    expect(deleted.map(run => run.runId)).toEqual(['chat-run-delete']);
    expect(store.getRunProjection('chat-run-delete')).toBeNull();
    expect(store.listRunProjectionChanges({ runId: 'chat-run-delete' })).toEqual([]);
    expect(store.listApprovals({ runId: 'chat-run-delete' })).toEqual([]);
    expect(store.listApprovalChanges({ runId: 'chat-run-delete' })).toEqual([]);
    expect(store.listRunControlCommands({ runId: 'chat-run-delete' })).toEqual([]);
    expect(store.listRunControlChanges({ runId: 'chat-run-delete' })).toEqual([]);
    expect(store.listRunProjections({ sessionId: 'session-delete' }).map(run => run.runId)).toEqual(['design-run-keep']);
    expect(store.listRunProjections({ pageletId: 'chat' }).map(run => run.runId)).toEqual(['chat-run-keep']);
  });

  it('tracks approval requests and decisions', () => {
    const store = new RunBrokerStore();
    const events: string[] = [];
    const subscription = store.subscribeApprovals(event => {
      events.push(`${String(event.cursor)}:${event.approvalId}:${event.approval.status}`);
    });
    const approval = store.requestApproval({
      approvalId: 'approval-1',
      runId: 'run-1',
      source: desktopActor,
      kind: 'computer_action',
      title: 'Click button',
      body: 'Allow desktop click',
      now: 300,
    });

    expect(approval).toMatchObject({
      approvalId: 'approval-1',
      runId: 'run-1',
      status: 'pending',
      kind: 'computer_action',
    });

    const decided = store.decideApproval('approval-1', {
      granted: true,
      decidedBy: desktopActor,
      reason: 'Approved in desktop',
      now: 320,
    });

    expect(decided).toMatchObject({
      status: 'approved',
      granted: true,
      reason: 'Approved in desktop',
      decidedAt: 320,
    });
    expect(store.listApprovals({ runId: 'run-1', status: 'approved' })).toHaveLength(1);
    const [approvalChange] = store.listApprovalChanges({ runId: 'run-1', afterCursor: 1 });
    expect(approvalChange).toMatchObject({
      approvalId: 'approval-1',
      cursor: 2,
    });
    expect(approvalChange.approval).toMatchObject({ status: 'approved' });
    expect(events).toEqual([
      '1:approval-1:pending',
      '2:approval-1:approved',
    ]);

    subscription.unsubscribe();
    store.requestApproval({
      approvalId: 'approval-2',
      runId: 'run-1',
      source: desktopActor,
      kind: 'tool',
      title: 'No notification after unsubscribe',
      now: 330,
    });
    expect(events).toHaveLength(2);
  });

  it('tracks run control commands and rejects terminal runs', () => {
    const store = new RunBrokerStore();
    const events: string[] = [];
    const subscription = store.subscribeRunControlCommands(event => {
      events.push(`${String(event.cursor)}:${event.commandId}:${event.command.status}`);
    });

    store.registerRunProjection({
      runId: 'run-control',
      pageletId: 'design',
      status: 'running',
      updatedAt: 500,
    });
    const command = store.requestRunControlCommand({
      commandId: 'runctl-1',
      runId: 'run-control',
      kind: 'pause',
      requestedBy: desktopActor,
      reason: 'telegram /pause',
      now: 510,
    });
    const applied = store.markRunControlCommandApplied('runctl-1', 520);

    store.registerRunProjection({
      runId: 'run-done',
      pageletId: 'design',
      status: 'completed',
      updatedAt: 530,
    });
    const rejected = store.requestRunControlCommand({
      commandId: 'runctl-2',
      runId: 'run-done',
      kind: 'cancel',
      requestedBy: desktopActor,
      now: 540,
    });

    expect(command).toMatchObject({
      status: 'accepted',
      kind: 'pause',
      reason: 'telegram /pause',
    });
    expect(applied).toMatchObject({
      status: 'applied',
      appliedAt: 520,
    });
    expect(rejected).toMatchObject({
      status: 'rejected',
      rejectionReason: 'run is already completed',
    });
    expect(store.listRunControlCommands({ runId: 'run-control' })).toEqual([
      expect.objectContaining({
        commandId: 'runctl-1',
        status: 'applied',
      }),
    ]);
    expect(store.listRunControlChanges({ afterCursor: 1 })).toEqual([
      expect.objectContaining({ commandId: 'runctl-1', cursor: 2 }),
      expect.objectContaining({ commandId: 'runctl-2', cursor: 3 }),
    ]);
    expect(events).toEqual([
      '1:runctl-1:accepted',
      '2:runctl-1:applied',
      '3:runctl-2:rejected',
    ]);

    subscription.unsubscribe();
  });

  it('hydrates persisted control-plane state from a snapshot repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-run-broker-state-'));
    cleanupDirs.push(dir);
    const repository = new FileRunBrokerStateRepository(join(dir, 'state.json'));
    const store = new RunBrokerStore(500, repository);

    store.createRunIntent({
      intentId: 'intent-persisted',
      source: desktopActor,
      targetPagelet: 'design',
      prompt: 'persist this intent',
      now: 400,
    });
    store.registerRunProjection({
      runId: 'run-persisted',
      pageletId: 'design',
      status: 'running',
      updatedAt: 410,
    });
    store.requestApproval({
      approvalId: 'approval-persisted',
      runId: 'run-persisted',
      source: desktopActor,
      kind: 'tool',
      title: 'Persist approval',
      now: 420,
    });
    store.requestRunControlCommand({
      commandId: 'runctl-persisted',
      runId: 'run-persisted',
      kind: 'pause',
      requestedBy: desktopActor,
      now: 430,
    });

    const restored = new RunBrokerStore(500, repository);

    expect(restored.getRunIntent('intent-persisted')).toMatchObject({
      prompt: 'persist this intent',
      status: 'queued',
    });
    expect(restored.getRunProjection('run-persisted')).toMatchObject({
      status: 'running',
      cursor: 1,
    });
    expect(restored.listRunProjectionChanges({ runId: 'run-persisted' })).toHaveLength(1);
    expect(restored.listApprovals({ runId: 'run-persisted' })).toHaveLength(1);
    expect(restored.listApprovalChanges({ runId: 'run-persisted' })).toEqual([
      expect.objectContaining({
        approvalId: 'approval-persisted',
        cursor: 1,
      }),
    ]);
    expect(restored.listRunControlCommands({ runId: 'run-persisted' })).toEqual([
      expect.objectContaining({
        commandId: 'runctl-persisted',
        status: 'accepted',
      }),
    ]);
    expect(restored.listRunControlChanges({ runId: 'run-persisted' })).toEqual([
      expect.objectContaining({
        commandId: 'runctl-persisted',
        cursor: 1,
      }),
    ]);
  });
});
