import { describe, expect, it } from 'vitest';
import { RunBrokerStore } from '../RunBrokerStore';

const desktopActor = {
  actorId: 'desktop:user',
  kind: 'desktop' as const,
  displayName: 'Desktop User',
};

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

  it('tracks approval requests and decisions', () => {
    const store = new RunBrokerStore();
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
  });
});
