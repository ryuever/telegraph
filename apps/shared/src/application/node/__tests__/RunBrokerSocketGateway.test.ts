import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type {
  ApprovalRequestChangeEvent,
  RunControlCommandChangeEvent,
  RunProjectionChangeEvent,
} from '@/apps/shared/application/common';
import { RunBrokerStore } from '../RunBrokerStore';
import { RunBrokerSocketGateway, handleRunBrokerGatewayRequest } from '../RunBrokerSocketGateway';

const cliActor = {
  actorId: 'cli:local',
  kind: 'cli' as const,
  displayName: 'Local CLI',
};

interface GatewayAck {
  id: string;
  ok: boolean;
  result: { subscribed: boolean };
}

interface GatewayProjectionEvent {
  event: RunProjectionChangeEvent;
}

interface GatewayApprovalEvent {
  approvalEvent: ApprovalRequestChangeEvent;
}

interface GatewayRunControlEvent {
  runControlEvent: RunControlCommandChangeEvent;
}

describe('RunBrokerSocketGateway', () => {
  it('dispatches line protocol requests into RunBrokerStore', async () => {
    const store = new RunBrokerStore();

    const createResponse = await handleRunBrokerGatewayRequest(store, {
      id: 1,
      method: 'createRunIntent',
      params: {
        intentId: 'intent-cli',
        source: cliActor,
        targetPagelet: 'design',
        prompt: 'make a mobile shell',
        now: 100,
      },
    });
    const listResponse = await handleRunBrokerGatewayRequest(store, {
      id: 2,
      method: 'listRunIntents',
      params: { targetPagelet: 'design' },
    });

    expect(createResponse).toMatchObject({
      id: 1,
      ok: true,
      result: {
        intentId: 'intent-cli',
        status: 'queued',
      },
    });
    expect(listResponse).toMatchObject({
      id: 2,
      ok: true,
      result: [
        expect.objectContaining({
          intentId: 'intent-cli',
          prompt: 'make a mobile shell',
        }),
      ],
    });
  });

  it('returns protocol errors for invalid params', async () => {
    const response = await handleRunBrokerGatewayRequest(new RunBrokerStore(), {
      id: 'bad',
      method: 'createRunIntent',
      params: undefined,
    });

    expect(response).toEqual({
      id: 'bad',
      ok: false,
      error: 'Expected params object',
    });
  });

  it('dispatches registered gateway extension methods', async () => {
    const response = await handleRunBrokerGatewayRequest(new RunBrokerStore(), {
      id: 'open-1',
      method: 'openRun',
      params: { runId: 'run-open' },
    }, {
      openRun: params => ({
        opened: true,
        params,
      }),
    });

    expect(response).toEqual({
      id: 'open-1',
      ok: true,
      result: {
        opened: true,
        params: { runId: 'run-open' },
      },
    });
  });

  it('dispatches run control commands into RunBrokerStore', async () => {
    const store = new RunBrokerStore();
    store.registerRunProjection({
      runId: 'run-control',
      pageletId: 'design',
      status: 'running',
      updatedAt: 100,
    });

    const requestResponse = await handleRunBrokerGatewayRequest(store, {
      id: 'runctl-1',
      method: 'requestRunControlCommand',
      params: {
        commandId: 'command-1',
        runId: 'run-control',
        kind: 'cancel',
        requestedBy: cliActor,
        reason: 'CLI cancel',
        now: 110,
      },
    });
    const listResponse = await handleRunBrokerGatewayRequest(store, {
      id: 'runctl-list-1',
      method: 'listRunControlCommands',
      params: { runId: 'run-control' },
    });

    expect(requestResponse).toMatchObject({
      id: 'runctl-1',
      ok: true,
      result: {
        commandId: 'command-1',
        runId: 'run-control',
        kind: 'cancel',
        status: 'accepted',
      },
    });
    expect(listResponse).toMatchObject({
      id: 'runctl-list-1',
      ok: true,
      result: [
        expect.objectContaining({
          commandId: 'command-1',
          status: 'accepted',
        }),
      ],
    });
  });

  it('streams projection subscription snapshots and updates over the socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-run-broker-test-'));
    const socketPath = join(dir, 'broker.sock');
    const store = new RunBrokerStore();
    const gateway = new RunBrokerSocketGateway(store, socketPath);

    store.registerRunProjection({
      runId: 'run-1',
      pageletId: 'design',
      status: 'running',
      updatedAt: 100,
    });

    await gateway.start();
    const socket = createConnection(socketPath);
    socket.setEncoding('utf8');
    const lines = collectLines(socket);
    await new Promise<void>(resolve => {
      socket.once('connect', resolve);
    });

    socket.write(`${JSON.stringify({
      id: 'sub-1',
      method: 'subscribeRunProjections',
      params: { runId: 'run-1' },
    })}\n`);
    const ack = parseGatewayAck(await lines.nextLine());
    const snapshot = parseGatewayProjectionEvent(await lines.nextLine());

    store.registerRunProjection({
      runId: 'run-1',
      pageletId: 'design',
      status: 'completed',
      updatedAt: 120,
    });
    const update = parseGatewayProjectionEvent(await lines.nextLine());

    expect(ack).toEqual({
      id: 'sub-1',
      ok: true,
      result: { subscribed: true },
    });
    expect(snapshot.event).toMatchObject({
      type: 'run_projection_changed',
      runId: 'run-1',
      projection: { status: 'running' },
      cursor: 1,
    });
    expect(update.event).toMatchObject({
      type: 'run_projection_changed',
      runId: 'run-1',
      projection: { status: 'completed' },
      cursor: 2,
    });

    socket.end();
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('replays projection changes after a cursor before live updates', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-run-broker-test-'));
    const socketPath = join(dir, 'broker.sock');
    const store = new RunBrokerStore();
    const gateway = new RunBrokerSocketGateway(store, socketPath);

    store.registerRunProjection({
      runId: 'run-2',
      pageletId: 'design',
      status: 'queued',
      updatedAt: 100,
    });
    store.registerRunProjection({
      runId: 'run-2',
      pageletId: 'design',
      status: 'running',
      updatedAt: 110,
    });

    await gateway.start();
    const socket = createConnection(socketPath);
    socket.setEncoding('utf8');
    const lines = collectLines(socket);
    await new Promise<void>(resolve => {
      socket.once('connect', resolve);
    });

    socket.write(`${JSON.stringify({
      id: 'sub-2',
      method: 'subscribeRunProjections',
      params: { runId: 'run-2', afterCursor: 1 },
    })}\n`);
    const ack = parseGatewayAck(await lines.nextLine());
    const replay = parseGatewayProjectionEvent(await lines.nextLine());

    store.registerRunProjection({
      runId: 'run-2',
      pageletId: 'design',
      status: 'completed',
      updatedAt: 120,
    });
    const update = parseGatewayProjectionEvent(await lines.nextLine());

    expect(ack.result.subscribed).toBe(true);
    expect(replay.event).toMatchObject({
      runId: 'run-2',
      cursor: 2,
      projection: { status: 'running' },
    });
    expect(update.event).toMatchObject({
      runId: 'run-2',
      cursor: 3,
      projection: { status: 'completed' },
    });

    socket.end();
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('streams approval subscription snapshots and updates over the socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-run-broker-test-'));
    const socketPath = join(dir, 'broker.sock');
    const store = new RunBrokerStore();
    const gateway = new RunBrokerSocketGateway(store, socketPath);

    store.requestApproval({
      approvalId: 'approval-1',
      runId: 'run-1',
      source: cliActor,
      kind: 'tool',
      title: 'Allow tool',
      now: 100,
    });

    await gateway.start();
    const socket = createConnection(socketPath);
    socket.setEncoding('utf8');
    const lines = collectLines(socket);
    await new Promise<void>(resolve => {
      socket.once('connect', resolve);
    });

    socket.write(`${JSON.stringify({
      id: 'approval-sub-1',
      method: 'subscribeApprovals',
      params: { runId: 'run-1' },
    })}\n`);
    const ack = parseGatewayAck(await lines.nextLine());
    const snapshot = parseGatewayApprovalEvent(await lines.nextLine());

    store.decideApproval('approval-1', {
      granted: false,
      decidedBy: cliActor,
      reason: 'Denied from CLI',
      now: 120,
    });
    const update = parseGatewayApprovalEvent(await lines.nextLine());

    expect(ack.result.subscribed).toBe(true);
    expect(snapshot.approvalEvent).toMatchObject({
      type: 'approval_request_changed',
      approvalId: 'approval-1',
      runId: 'run-1',
      cursor: 1,
      approval: { status: 'pending' },
    });
    expect(update.approvalEvent).toMatchObject({
      approvalId: 'approval-1',
      cursor: 2,
      approval: { status: 'denied', reason: 'Denied from CLI' },
    });

    socket.end();
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('streams run control subscription snapshots and updates over the socket', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-run-broker-test-'));
    const socketPath = join(dir, 'broker.sock');
    const store = new RunBrokerStore();
    const gateway = new RunBrokerSocketGateway(store, socketPath);

    store.registerRunProjection({
      runId: 'run-control',
      pageletId: 'design',
      status: 'running',
      updatedAt: 100,
    });
    store.requestRunControlCommand({
      commandId: 'command-1',
      runId: 'run-control',
      kind: 'cancel',
      requestedBy: cliActor,
      now: 110,
    });

    await gateway.start();
    const socket = createConnection(socketPath);
    socket.setEncoding('utf8');
    const lines = collectLines(socket);
    await new Promise<void>(resolve => {
      socket.once('connect', resolve);
    });

    socket.write(`${JSON.stringify({
      id: 'run-control-sub-1',
      method: 'subscribeRunControlCommands',
      params: { runId: 'run-control' },
    })}\n`);
    const ack = parseGatewayAck(await lines.nextLine());
    const snapshot = parseGatewayRunControlEvent(await lines.nextLine());

    store.markRunControlCommandApplied('command-1', 120);
    const update = parseGatewayRunControlEvent(await lines.nextLine());

    expect(ack.result.subscribed).toBe(true);
    expect(snapshot.runControlEvent).toMatchObject({
      type: 'run_control_command_changed',
      commandId: 'command-1',
      runId: 'run-control',
      cursor: 1,
      command: { status: 'accepted' },
    });
    expect(update.runControlEvent).toMatchObject({
      commandId: 'command-1',
      cursor: 2,
      command: { status: 'applied' },
    });

    socket.end();
    await gateway.stop();
    rmSync(dir, { recursive: true, force: true });
  });
});

function collectLines(socket: Socket): { nextLine(): Promise<string> } {
  const pending: string[] = [];
  const waiters: Array<(line: string) => void> = [];
  let buffer = '';

  socket.on('data', chunk => {
    buffer += String(chunk);
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      const waiter = waiters.shift();
      if (waiter) waiter(line);
      else pending.push(line);
    }
  });

  return {
    nextLine: () => new Promise(resolve => {
      const line = pending.shift();
      if (line) {
        resolve(line);
        return;
      }
      waiters.push(resolve);
    }),
  };
}

function parseGatewayAck(value: string): GatewayAck {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed) || !isRecord(parsed.result)) throw new Error('Invalid gateway ack');
  return {
    id: String(parsed.id),
    ok: parsed.ok === true,
    result: {
      subscribed: parsed.result.subscribed === true,
    },
  };
}

function parseGatewayProjectionEvent(value: string): GatewayProjectionEvent {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error('Invalid gateway event');
  return {
    event: parsed.event as RunProjectionChangeEvent,
  };
}

function parseGatewayApprovalEvent(value: string): GatewayApprovalEvent {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error('Invalid gateway approval event');
  return {
    approvalEvent: parsed.approvalEvent as ApprovalRequestChangeEvent,
  };
}

function parseGatewayRunControlEvent(value: string): GatewayRunControlEvent {
  const parsed: unknown = JSON.parse(value);
  if (!isRecord(parsed)) throw new Error('Invalid gateway run control event');
  return {
    runControlEvent: parsed.runControlEvent as RunControlCommandChangeEvent,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
