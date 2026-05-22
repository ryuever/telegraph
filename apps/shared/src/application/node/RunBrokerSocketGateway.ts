import { existsSync, unlinkSync } from 'node:fs';
import { createServer, type Server, type Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  ApprovalRequestChangeEvent,
  ClaimRunIntentInput,
  ListApprovalChangesOptions,
  ListApprovalRequestsOptions,
  ListRunControlCommandsOptions,
  ListRunIntentsOptions,
  ListRunProjectionChangesOptions,
  ListRunProjectionsOptions,
  CreateApprovalRequestInput,
  CreateRunControlCommandInput,
  CreateRunIntentInput,
  DecideApprovalInput,
  RegisterRunProjectionInput,
  ApprovalRequestRecord,
  RunControlCommandChangeEvent,
  RunControlCommandRecord,
  RunIntentRecord,
  RunProjectionChangeEvent,
  RunProjectionRecord,
  RunProjectionStatus,
} from '@/packages/run-protocol';

export const RUN_BROKER_SOCKET_ENV = 'TELEGRAPH_RUN_BROKER_SOCKET';

type MaybePromise<T> = T | Promise<T>;

export interface RunBrokerGatewayBroker {
  createRunIntent(input: CreateRunIntentInput): MaybePromise<RunIntentRecord>;
  claimRunIntent(intentId: string, input: ClaimRunIntentInput): MaybePromise<RunIntentRecord | null>;
  listRunIntents(options?: ListRunIntentsOptions): MaybePromise<RunIntentRecord[]>;
  getRunIntent(intentId: string): MaybePromise<RunIntentRecord | null>;
  registerRunProjection(input: RegisterRunProjectionInput): MaybePromise<RunProjectionRecord>;
  listRunProjections(options?: ListRunProjectionsOptions): MaybePromise<RunProjectionRecord[]>;
  getRunProjection(runId: string): MaybePromise<RunProjectionRecord | null>;
  listRunProjectionChanges(options?: ListRunProjectionChangesOptions): MaybePromise<RunProjectionChangeEvent[]>;
  subscribeRunProjections(callback: (event: RunProjectionChangeEvent) => void): MaybePromise<{ unsubscribe(): void }>;
  requestApproval(input: CreateApprovalRequestInput): MaybePromise<ApprovalRequestRecord>;
  decideApproval(approvalId: string, input: DecideApprovalInput): MaybePromise<ApprovalRequestRecord | null>;
  listApprovals(options?: ListApprovalRequestsOptions): MaybePromise<ApprovalRequestRecord[]>;
  listApprovalChanges(options?: ListApprovalChangesOptions): MaybePromise<ApprovalRequestChangeEvent[]>;
  subscribeApprovals(callback: (event: ApprovalRequestChangeEvent) => void): MaybePromise<{ unsubscribe(): void }>;
  requestRunControlCommand(input: CreateRunControlCommandInput): MaybePromise<RunControlCommandRecord>;
  markRunControlCommandApplied(commandId: string, now?: number): MaybePromise<RunControlCommandRecord | null>;
  listRunControlCommands(options?: ListRunControlCommandsOptions): MaybePromise<RunControlCommandRecord[]>;
  listRunControlChanges(options?: ListRunControlCommandsOptions): MaybePromise<RunControlCommandChangeEvent[]>;
  subscribeRunControlCommands(callback: (event: RunControlCommandChangeEvent) => void): MaybePromise<{ unsubscribe(): void }>;
}

export type RunBrokerGatewayMethod =
  | 'createRunIntent'
  | 'claimRunIntent'
  | 'listRunIntents'
  | 'getRunIntent'
  | 'registerRunProjection'
  | 'listRunProjections'
  | 'getRunProjection'
  | 'listRunProjectionChanges'
  | 'subscribeRunProjections'
  | 'requestApproval'
  | 'decideApproval'
  | 'listApprovals'
  | 'listApprovalChanges'
  | 'subscribeApprovals'
  | 'requestRunControlCommand'
  | 'markRunControlCommandApplied'
  | 'listRunControlCommands'
  | 'listRunControlChanges'
  | 'subscribeRunControlCommands';

export interface RunBrokerGatewayRequest {
  id?: string | number;
  method: string;
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

export interface RunBrokerGatewayApprovalEventMessage {
  approvalEvent: ApprovalRequestChangeEvent;
}

export interface RunBrokerGatewayRunControlEventMessage {
  runControlEvent: RunControlCommandChangeEvent;
}

export type RunBrokerGatewayExtraHandler = (
  params: unknown,
  request: RunBrokerGatewayRequest,
) => MaybePromise<unknown>;

export type RunBrokerGatewayExtraHandlers = Partial<Record<string, RunBrokerGatewayExtraHandler>>;

interface RunProjectionSubscriptionOptions {
  runId?: string;
  pageletId?: string;
  status?: RunProjectionStatus;
  afterCursor?: number;
  limit?: number;
}

export class RunBrokerSocketGateway {
  private server: Server | null = null;

  constructor(
    private readonly broker: RunBrokerGatewayBroker,
    private readonly socketPath = defaultRunBrokerSocketPath(),
    private readonly extraHandlers: RunBrokerGatewayExtraHandlers = {},
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

  handleRequest(request: RunBrokerGatewayRequest): Promise<RunBrokerGatewayResponse> {
    return handleRunBrokerGatewayRequest(this.broker, request, this.extraHandlers);
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
        void this.handleLine(line, socket, subscriptions)
          .then(response => {
            socket.write(`${JSON.stringify(response)}\n`);
          });
      }
    });
  }

  private async handleLine(
    line: string,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): Promise<RunBrokerGatewayResponse> {
    try {
      return await this.handleSocketRequest(JSON.parse(line) as RunBrokerGatewayRequest, socket, subscriptions);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async handleSocketRequest(
    request: RunBrokerGatewayRequest,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): Promise<RunBrokerGatewayResponse> {
    if (request.method !== 'subscribeRunProjections') {
      if (request.method !== 'subscribeApprovals') {
        if (request.method !== 'subscribeRunControlCommands') {
          return await this.handleRequest(request);
        }
        return await this.handleRunControlSubscriptionRequest(request, socket, subscriptions);
      }
      return await this.handleApprovalSubscriptionRequest(request, socket, subscriptions);
    }

    const options = assertOptionalObject(request.params) as RunProjectionSubscriptionOptions;
    const subscription = await this.broker.subscribeRunProjections(event => {
      if (!projectionEventMatches(event, options)) return;
      writeGatewayEvent(socket, event);
    });
    subscriptions.push(subscription);

    queueMicrotask(() => {
      void initialProjectionEvents(this.broker, options)
        .then(events => {
          for (const event of events) {
            writeGatewayEvent(socket, event);
          }
        })
        .catch((error: unknown) => {
          const response: RunBrokerGatewayResponse = {
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
          socket.write(`${JSON.stringify(response)}\n`);
        });
    });

    return {
      id: request.id,
      ok: true,
      result: { subscribed: true },
    };
  }

  private async handleApprovalSubscriptionRequest(
    request: RunBrokerGatewayRequest,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): Promise<RunBrokerGatewayResponse> {
    const options = assertOptionalObject(request.params) as ListApprovalChangesOptions;
    const subscription = await this.broker.subscribeApprovals(event => {
      if (!approvalEventMatches(event, options)) return;
      writeApprovalGatewayEvent(socket, event);
    });
    subscriptions.push(subscription);

    setTimeout(() => {
      void initialApprovalEvents(this.broker, options)
        .then(events => {
          for (const event of events) {
            writeApprovalGatewayEvent(socket, event);
          }
        })
        .catch((error: unknown) => {
          const response: RunBrokerGatewayResponse = {
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
          socket.write(`${JSON.stringify(response)}\n`);
        });
    }, 0);

    return {
      id: request.id,
      ok: true,
      result: { subscribed: true },
    };
  }

  private async handleRunControlSubscriptionRequest(
    request: RunBrokerGatewayRequest,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): Promise<RunBrokerGatewayResponse> {
    const options = assertOptionalObject(request.params) as ListRunControlCommandsOptions;
    const subscription = await this.broker.subscribeRunControlCommands(event => {
      if (!runControlEventMatches(event, options)) return;
      writeRunControlGatewayEvent(socket, event);
    });
    subscriptions.push(subscription);

    setTimeout(() => {
      void Promise.resolve(this.broker.listRunControlChanges(options))
        .then(events => {
          for (const event of events) writeRunControlGatewayEvent(socket, event);
        })
        .catch((error: unknown) => {
          const response: RunBrokerGatewayResponse = {
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          };
          socket.write(`${JSON.stringify(response)}\n`);
        });
    }, 0);

    return {
      id: request.id,
      ok: true,
      result: { subscribed: true },
    };
  }
}

export async function handleRunBrokerGatewayRequest(
  broker: RunBrokerGatewayBroker,
  request: RunBrokerGatewayRequest,
  extraHandlers: RunBrokerGatewayExtraHandlers = {},
): Promise<RunBrokerGatewayResponse> {
  try {
    const result = await dispatchRunBrokerGatewayRequest(broker, request, extraHandlers);
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

async function dispatchRunBrokerGatewayRequest(
  broker: RunBrokerGatewayBroker,
  request: RunBrokerGatewayRequest,
  extraHandlers: RunBrokerGatewayExtraHandlers,
): Promise<unknown> {
  const extraHandler = extraHandlers[request.method];
  if (extraHandler) {
    return extraHandler(request.params, request);
  }

  switch (request.method) {
    case 'createRunIntent':
      return broker.createRunIntent(assertObject(request.params) as unknown as CreateRunIntentInput);
    case 'claimRunIntent': {
      const params = assertObject(request.params) as unknown as { intentId: string; input: ClaimRunIntentInput };
      return broker.claimRunIntent(params.intentId, params.input);
    }
    case 'listRunIntents':
      return broker.listRunIntents(assertOptionalObject(request.params));
    case 'getRunIntent': {
      const params = assertObject(request.params) as { intentId: string };
      return broker.getRunIntent(params.intentId);
    }
    case 'registerRunProjection':
      return broker.registerRunProjection(assertObject(request.params) as unknown as RegisterRunProjectionInput);
    case 'listRunProjections':
      return broker.listRunProjections(assertOptionalObject(request.params));
    case 'getRunProjection': {
      const params = assertObject(request.params) as { runId: string };
      return broker.getRunProjection(params.runId);
    }
    case 'listRunProjectionChanges':
      return broker.listRunProjectionChanges(assertOptionalObject(request.params));
    case 'subscribeRunProjections':
      throw new Error('subscribeRunProjections requires a socket connection');
    case 'requestApproval':
      return broker.requestApproval(assertObject(request.params) as unknown as CreateApprovalRequestInput);
    case 'decideApproval': {
      const params = assertObject(request.params) as unknown as { approvalId: string; input: DecideApprovalInput };
      return broker.decideApproval(params.approvalId, params.input);
    }
    case 'listApprovals':
      return broker.listApprovals(assertOptionalObject(request.params));
    case 'listApprovalChanges':
      return broker.listApprovalChanges(assertOptionalObject(request.params));
    case 'subscribeApprovals':
      throw new Error('subscribeApprovals requires a socket connection');
    case 'requestRunControlCommand':
      return broker.requestRunControlCommand(assertObject(request.params) as unknown as CreateRunControlCommandInput);
    case 'markRunControlCommandApplied': {
      const params = assertObject(request.params) as { commandId?: unknown; now?: unknown };
      if (typeof params.commandId !== 'string') throw new Error('Missing commandId');
      return broker.markRunControlCommandApplied(
        params.commandId,
        typeof params.now === 'number' ? params.now : undefined,
      );
    }
    case 'listRunControlCommands':
      return broker.listRunControlCommands(assertOptionalObject(request.params));
    case 'listRunControlChanges':
      return broker.listRunControlChanges(assertOptionalObject(request.params));
    case 'subscribeRunControlCommands':
      throw new Error('subscribeRunControlCommands requires a socket connection');
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

function writeApprovalGatewayEvent(socket: Socket, event: ApprovalRequestChangeEvent): void {
  const message: RunBrokerGatewayApprovalEventMessage = { approvalEvent: event };
  socket.write(`${JSON.stringify(message)}\n`);
}

function writeRunControlGatewayEvent(socket: Socket, event: RunControlCommandChangeEvent): void {
  const message: RunBrokerGatewayRunControlEventMessage = { runControlEvent: event };
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

function approvalEventMatches(
  event: ApprovalRequestChangeEvent,
  options: ListApprovalChangesOptions,
): boolean {
  if (options.runId && event.runId !== options.runId) return false;
  if (options.status && event.approval.status !== options.status) return false;
  return true;
}

function runControlEventMatches(
  event: RunControlCommandChangeEvent,
  options: ListRunControlCommandsOptions,
): boolean {
  if (options.runId && event.runId !== options.runId) return false;
  if (options.status && event.command.status !== options.status) return false;
  if (options.kind && event.command.kind !== options.kind) return false;
  if (options.afterCursor !== undefined && event.cursor <= options.afterCursor) return false;
  return true;
}

async function initialProjectionEvents(
  broker: RunBrokerGatewayBroker,
  options: RunProjectionSubscriptionOptions,
): Promise<RunProjectionChangeEvent[]> {
  const replayed = await broker.listRunProjectionChanges({
    runId: options.runId,
    pageletId: options.pageletId,
    status: options.status,
    afterCursor: options.afterCursor,
    limit: options.limit,
  });
  if (options.afterCursor !== undefined || replayed.length > 0) {
    return replayed;
  }

  if (options.runId) {
    const projection = await broker.getRunProjection(options.runId);
    if (!projection) return [];
    const event = projectionChangeEvent(projection);
    return projectionEventMatches(event, options) ? [event] : [];
  }

  return (await broker.listRunProjections({
    pageletId: options.pageletId,
    status: options.status,
  })).map(projectionChangeEvent);
}

function projectionChangeEvent(projection: RunProjectionRecord): RunProjectionChangeEvent {
  return {
    type: 'run_projection_changed',
    runId: projection.runId,
    projection,
    cursor: projection.cursor,
  };
}

async function initialApprovalEvents(
  broker: RunBrokerGatewayBroker,
  options: ListApprovalChangesOptions,
): Promise<ApprovalRequestChangeEvent[]> {
  const replayed = await broker.listApprovalChanges(options);
  if (options.afterCursor !== undefined || replayed.length > 0) {
    return replayed;
  }

  return (await broker.listApprovals({
    runId: options.runId,
    status: options.status,
    limit: options.limit,
  })).map(approvalChangeEvent);
}

function approvalChangeEvent(approval: ApprovalRequestRecord): ApprovalRequestChangeEvent {
  return {
    type: 'approval_request_changed',
    approvalId: approval.approvalId,
    runId: approval.runId,
    approval,
    cursor: 0,
  };
}
