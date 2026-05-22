import { existsSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ClaimRunIntentInput,
  CreateApprovalRequestInput,
  CreateRunIntentInput,
  DecideApprovalInput,
  RegisterRunProjectionInput,
  RunProjectionChangeEvent,
  RunProjectionRecord,
  RunProjectionStatus,
} from '@/apps/shared/application/common';
import type { RunBrokerStore } from './RunBrokerStore';

export const RUN_BROKER_SOCKET_ENV = 'TELEGRAPH_RUN_BROKER_SOCKET';

export type RunBrokerGatewayMethod =
  | 'createRunIntent'
  | 'claimRunIntent'
  | 'listRunIntents'
  | 'getRunIntent'
  | 'registerRunProjection'
  | 'listRunProjections'
  | 'getRunProjection'
  | 'subscribeRunProjections'
  | 'requestApproval'
  | 'decideApproval'
  | 'listApprovals';

export interface RunBrokerGatewayRequest {
  id?: string | number;
  method: RunBrokerGatewayMethod;
  params?: unknown;
}

export interface RunBrokerGatewayResponse {
  id?: string | number;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export interface RunBrokerGatewayEventMessage {
  event: RunProjectionChangeEvent;
}

interface RunProjectionSubscriptionOptions {
  runId?: string;
  pageletId?: string;
  status?: RunProjectionStatus;
}

export class RunBrokerSocketGateway {
  private server: Server | null = null;

  constructor(
    private readonly store: RunBrokerStore,
    private readonly socketPath = defaultRunBrokerSocketPath(),
  ) {}

  get path(): string {
    return this.socketPath;
  }

  async start(): Promise<string> {
    if (this.server) return this.socketPath;
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }

    this.server = createServer(socket => {
      this.handleSocket(socket);
    });
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.socketPath, () => {
        this.server?.off('error', reject);
        resolve();
      });
    });
    return this.socketPath;
  }

  async stop(): Promise<void> {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error);
        else resolve();
      });
    });
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      unlinkSync(this.socketPath);
    }
  }

  handleRequest(request: RunBrokerGatewayRequest): RunBrokerGatewayResponse {
    return handleRunBrokerGatewayRequest(this.store, request);
  }

  private handleSocket(socket: Socket): void {
    socket.setEncoding('utf8');
    const subscriptions: Array<{ unsubscribe(): void }> = [];
    let buffer = '';
    socket.on('close', () => {
      for (const subscription of subscriptions) subscription.unsubscribe();
      subscriptions.length = 0;
    });
    socket.on('data', chunk => {
      buffer += String(chunk);
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const response = this.handleLine(line, socket, subscriptions);
        socket.write(`${JSON.stringify(response)}\n`);
      }
    });
  }

  private handleLine(
    line: string,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): RunBrokerGatewayResponse {
    try {
      return this.handleSocketRequest(JSON.parse(line) as RunBrokerGatewayRequest, socket, subscriptions);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private handleSocketRequest(
    request: RunBrokerGatewayRequest,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): RunBrokerGatewayResponse {
    if (request.method !== 'subscribeRunProjections') {
      return this.handleRequest(request);
    }

    const options = assertOptionalObject(request.params) as RunProjectionSubscriptionOptions;
    const subscription = this.store.subscribeRunProjections(event => {
      if (!projectionEventMatches(event, options)) return;
      writeGatewayEvent(socket, event);
    });
    subscriptions.push(subscription);

    queueMicrotask(() => {
      for (const projection of initialProjectionSnapshot(this.store, options)) {
        writeGatewayEvent(socket, projectionChangeEvent(projection));
      }
    });

    return {
      id: request.id,
      ok: true,
      result: { subscribed: true },
    };
  }
}

export function handleRunBrokerGatewayRequest(
  store: RunBrokerStore,
  request: RunBrokerGatewayRequest,
): RunBrokerGatewayResponse {
  try {
    const result = dispatchRunBrokerGatewayRequest(store, request);
    return { id: request.id, ok: true, result };
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function defaultRunBrokerSocketPath(): string {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user';
  if (process.platform === 'win32') return `\\\\.\\pipe\\telegraph-run-broker-${uid}`;
  return join(tmpdir(), `telegraph-run-broker-${uid}.sock`);
}

function dispatchRunBrokerGatewayRequest(store: RunBrokerStore, request: RunBrokerGatewayRequest): unknown {
  switch (request.method) {
    case 'createRunIntent':
      return store.createRunIntent(assertObject(request.params) as unknown as CreateRunIntentInput);
    case 'claimRunIntent': {
      const params = assertObject(request.params) as unknown as { intentId: string; input: ClaimRunIntentInput };
      return store.claimRunIntent(params.intentId, params.input);
    }
    case 'listRunIntents':
      return store.listRunIntents(assertOptionalObject(request.params));
    case 'getRunIntent': {
      const params = assertObject(request.params) as { intentId: string };
      return store.getRunIntent(params.intentId);
    }
    case 'registerRunProjection':
      return store.registerRunProjection(assertObject(request.params) as unknown as RegisterRunProjectionInput);
    case 'listRunProjections':
      return store.listRunProjections(assertOptionalObject(request.params));
    case 'getRunProjection': {
      const params = assertObject(request.params) as { runId: string };
      return store.getRunProjection(params.runId);
    }
    case 'subscribeRunProjections':
      throw new Error('subscribeRunProjections requires a socket connection');
    case 'requestApproval':
      return store.requestApproval(assertObject(request.params) as unknown as CreateApprovalRequestInput);
    case 'decideApproval': {
      const params = assertObject(request.params) as unknown as { approvalId: string; input: DecideApprovalInput };
      return store.decideApproval(params.approvalId, params.input);
    }
    case 'listApprovals':
      return store.listApprovals(assertOptionalObject(request.params));
  }
}

function assertObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected params object');
  }
  return value as Record<string, unknown>;
}

function assertOptionalObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {};
  return assertObject(value);
}

function writeGatewayEvent(socket: Socket, event: RunProjectionChangeEvent): void {
  const message: RunBrokerGatewayEventMessage = { event };
  socket.write(`${JSON.stringify(message)}\n`);
}

function projectionEventMatches(
  event: RunProjectionChangeEvent,
  options: RunProjectionSubscriptionOptions,
): boolean {
  if (options.runId && event.runId !== options.runId) return false;
  if (options.pageletId && event.projection.pageletId !== options.pageletId) return false;
  if (options.status && event.projection.status !== options.status) return false;
  return true;
}

function initialProjectionSnapshot(
  store: RunBrokerStore,
  options: RunProjectionSubscriptionOptions,
): RunProjectionRecord[] {
  if (options.runId) {
    const projection = store.getRunProjection(options.runId);
    if (!projection) return [];
    return projectionEventMatches(projectionChangeEvent(projection), options) ? [projection] : [];
  }

  return store.listRunProjections({
    pageletId: options.pageletId,
    status: options.status,
  });
}

function projectionChangeEvent(projection: RunProjectionRecord): RunProjectionChangeEvent {
  return {
    type: 'run_projection_changed',
    runId: projection.runId,
    projection,
    cursor: projection.cursor,
  };
}
