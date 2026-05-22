import { mkdtempSync, rmSync } from 'node:fs';
import { createConnection, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RunProjectionChangeEvent } from '@/apps/shared/application/common';
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

describe('RunBrokerSocketGateway', () => {
  it('dispatches line protocol requests into RunBrokerStore', () => {
    const store = new RunBrokerStore();

    const createResponse = handleRunBrokerGatewayRequest(store, {
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
    const listResponse = handleRunBrokerGatewayRequest(store, {
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

  it('returns protocol errors for invalid params', () => {
    const response = handleRunBrokerGatewayRequest(new RunBrokerStore(), {
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
