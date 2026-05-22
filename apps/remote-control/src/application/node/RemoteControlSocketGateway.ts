import { existsSync, unlinkSync } from 'node:fs'
import { createServer, type Server, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChannelReply, DeviceBinding, ExternalMessage } from '@/packages/remote-protocol'
import type {
  ApprovalRequestChangeEvent,
  ApprovalRequestRecord,
  DecideApprovalInput,
  ListApprovalChangesOptions,
  ListApprovalRequestsOptions,
  ListRunControlCommandsOptions,
  ListRunProjectionChangesOptions,
  ListRunProjectionsOptions,
  CreateRunControlCommandInput,
  RunControlCommandChangeEvent,
  RunControlCommandRecord,
  RunProjectionChangeEvent,
  RunProjectionRecord,
} from '@/packages/run-protocol'
import type {
  AckChannelReplyInput,
  CreateDeviceBindingInput,
  ListChannelRepliesOptions,
  RemoteControlSubmissionResult,
  RemoteControlSubmitOptions,
} from '@/apps/remote-control/application/common'
import type { TelegramUpdate } from './TelegramCommandRouter'
import type {
  SlackEventCallbackPayload,
  SlackInteractionPayload,
  SlackSlashCommandPayload,
} from './SlackCommandRouter'

export const REMOTE_CONTROL_SOCKET_ENV = 'TELEGRAPH_REMOTE_CONTROL_SOCKET'

type MaybePromise<T> = T | Promise<T>

export interface RemoteControlGatewayService {
  submitExternalMessage(
    message: ExternalMessage,
    options?: RemoteControlSubmitOptions,
  ): MaybePromise<RemoteControlSubmissionResult>
  listChannelReplies(options?: ListChannelRepliesOptions): MaybePromise<ChannelReply[]>
  subscribeChannelReplies(
    callback: (reply: ChannelReply) => void,
    options?: ListChannelRepliesOptions,
  ): MaybePromise<{ unsubscribe(): void }>
  ackChannelReply(input: AckChannelReplyInput): MaybePromise<ChannelReply | null>
  listApprovals(options?: ListApprovalRequestsOptions): MaybePromise<ApprovalRequestRecord[]>
  listApprovalChanges(options?: ListApprovalChangesOptions): MaybePromise<ApprovalRequestChangeEvent[]>
  subscribeApprovals(
    callback: (event: ApprovalRequestChangeEvent) => void,
    options?: ListApprovalChangesOptions,
  ): MaybePromise<{ unsubscribe(): void }>
  decideApproval(approvalId: string, input: DecideApprovalInput): MaybePromise<ApprovalRequestRecord | null>
  requestRunControlCommand(input: CreateRunControlCommandInput): MaybePromise<RunControlCommandRecord>
  listRunControlCommands(options?: ListRunControlCommandsOptions): MaybePromise<RunControlCommandRecord[]>
  listRunControlChanges(options?: ListRunControlCommandsOptions): MaybePromise<RunControlCommandChangeEvent[]>
  subscribeRunControlCommands(
    callback: (event: RunControlCommandChangeEvent) => void,
    options?: ListRunControlCommandsOptions,
  ): MaybePromise<{ unsubscribe(): void }>
  listRunProjections(options?: ListRunProjectionsOptions): MaybePromise<RunProjectionRecord[]>
  getRunProjection(runId: string): MaybePromise<RunProjectionRecord | null>
  listRunProjectionChanges(options?: ListRunProjectionChangesOptions): MaybePromise<RunProjectionChangeEvent[]>
  subscribeRunProjections(
    callback: (event: RunProjectionChangeEvent) => void,
    options?: ListRunProjectionChangesOptions,
  ): MaybePromise<{ unsubscribe(): void }>
  handleTelegramUpdate(update: TelegramUpdate): MaybePromise<ChannelReply[]>
  handleSlackSlashCommand(payload: SlackSlashCommandPayload): MaybePromise<ChannelReply>
  handleSlackEventCallback(payload: SlackEventCallbackPayload): MaybePromise<ChannelReply[]>
  handleSlackInteraction(payload: SlackInteractionPayload): MaybePromise<ChannelReply[]>
  listDeviceBindings(): MaybePromise<DeviceBinding[]>
  createDeviceBinding(input: CreateDeviceBindingInput): MaybePromise<DeviceBinding>
  revokeDeviceBinding(bindingId: string): MaybePromise<DeviceBinding | null>
}

export type RemoteControlGatewayMethod =
  | 'submitExternalMessage'
  | 'listChannelReplies'
  | 'subscribeChannelReplies'
  | 'ackChannelReply'
  | 'listApprovals'
  | 'listApprovalChanges'
  | 'subscribeApprovals'
  | 'decideApproval'
  | 'requestRunControlCommand'
  | 'listRunControlCommands'
  | 'listRunControlChanges'
  | 'subscribeRunControlCommands'
  | 'listRunProjections'
  | 'getRunProjection'
  | 'listRunProjectionChanges'
  | 'subscribeRunProjections'
  | 'handleTelegramUpdate'
  | 'handleSlackSlashCommand'
  | 'handleSlackEventCallback'
  | 'handleSlackInteraction'
  | 'listDeviceBindings'
  | 'createDeviceBinding'
  | 'revokeDeviceBinding'

export interface RemoteControlGatewayRequest {
  id?: string | number
  method: RemoteControlGatewayMethod
  params?: unknown
}

export interface RemoteControlGatewayResponse {
  id?: string | number
  ok: boolean
  result?: unknown
  error?: string
}

export interface RemoteControlGatewayReplyMessage {
  reply: ChannelReply
}

export interface RemoteControlGatewayApprovalMessage {
  approvalEvent: ApprovalRequestChangeEvent
}

export interface RemoteControlGatewayProjectionMessage {
  projectionEvent: RunProjectionChangeEvent
}

export interface RemoteControlGatewayRunControlMessage {
  runControlEvent: RunControlCommandChangeEvent
}

export class RemoteControlSocketGateway {
  private server: Server | null = null

  constructor(
    private readonly service: RemoteControlGatewayService,
    private readonly socketPath = defaultRemoteControlSocketPath(),
  ) {}

  get path(): string {
    return this.socketPath
  }

  async start(): Promise<string> {
    if (this.server) return this.socketPath
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      unlinkSync(this.socketPath)
    }

    this.server = createServer(socket => {
      this.handleSocket(socket)
    })
    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject)
      this.server?.listen(this.socketPath, () => {
        this.server?.off('error', reject)
        resolve()
      })
    })
    return this.socketPath
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve, reject) => {
      server.close(error => {
        if (error) reject(error)
        else resolve()
      })
    })
    if (process.platform !== 'win32' && existsSync(this.socketPath)) {
      unlinkSync(this.socketPath)
    }
  }

  handleRequest(request: RemoteControlGatewayRequest): Promise<RemoteControlGatewayResponse> {
    return handleRemoteControlGatewayRequest(this.service, request)
  }

  private handleSocket(socket: Socket): void {
    socket.setEncoding('utf8')
    const subscriptions: Array<{ unsubscribe(): void }> = []
    let buffer = ''
    socket.on('close', () => {
      for (const subscription of subscriptions) subscription.unsubscribe()
      subscriptions.length = 0
    })
    socket.on('data', chunk => {
      buffer += String(chunk)
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        void this.handleLine(line, socket, subscriptions)
          .then(response => {
            socket.write(`${JSON.stringify(response)}\n`)
          })
      }
    })
  }

  private async handleLine(
    line: string,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): Promise<RemoteControlGatewayResponse> {
    try {
      return await this.handleSocketRequest(
        JSON.parse(line) as RemoteControlGatewayRequest,
        socket,
        subscriptions,
      )
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  private async handleSocketRequest(
    request: RemoteControlGatewayRequest,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): Promise<RemoteControlGatewayResponse> {
    if (request.method !== 'subscribeChannelReplies') {
      if (request.method !== 'subscribeApprovals') {
        if (request.method !== 'subscribeRunProjections') {
          if (request.method !== 'subscribeRunControlCommands') {
            return this.handleRequest(request)
          }
          return this.handleRunControlSubscriptionRequest(request, socket, subscriptions)
        }
        return this.handleProjectionSubscriptionRequest(request, socket, subscriptions)
      }
      return this.handleApprovalSubscriptionRequest(request, socket, subscriptions)
    }

    const options = assertOptionalObject(request.params)
    const subscription = await this.service.subscribeChannelReplies(reply => {
      writeReplyMessage(socket, reply)
    }, options)
    subscriptions.push(subscription)

    setTimeout(() => {
      void Promise.resolve(this.service.listChannelReplies(options as ListChannelRepliesOptions))
        .then(replies => {
          for (const reply of replies) writeReplyMessage(socket, reply)
        })
        .catch((error: unknown) => {
          socket.write(`${JSON.stringify({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })}\n`)
        })
    }, 0)

    return {
      id: request.id,
      ok: true,
      result: { subscribed: true },
    }
  }

  private async handleProjectionSubscriptionRequest(
    request: RemoteControlGatewayRequest,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): Promise<RemoteControlGatewayResponse> {
    const options = assertOptionalObject(request.params)
    const subscription = await this.service.subscribeRunProjections(event => {
      writeProjectionMessage(socket, event)
    }, options)
    subscriptions.push(subscription)

    setTimeout(() => {
      void Promise.resolve(this.service.listRunProjectionChanges(options as ListRunProjectionChangesOptions))
        .then(events => {
          for (const event of events) writeProjectionMessage(socket, event)
        })
        .catch((error: unknown) => {
          socket.write(`${JSON.stringify({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })}\n`)
        })
    }, 0)

    return {
      id: request.id,
      ok: true,
      result: { subscribed: true },
    }
  }

  private async handleApprovalSubscriptionRequest(
    request: RemoteControlGatewayRequest,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): Promise<RemoteControlGatewayResponse> {
    const options = assertOptionalObject(request.params)
    const subscription = await this.service.subscribeApprovals(event => {
      writeApprovalMessage(socket, event)
    }, options)
    subscriptions.push(subscription)

    setTimeout(() => {
      void Promise.resolve(this.service.listApprovalChanges(options as ListApprovalChangesOptions))
        .then(events => {
          for (const event of events) writeApprovalMessage(socket, event)
        })
        .catch((error: unknown) => {
          socket.write(`${JSON.stringify({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })}\n`)
        })
    }, 0)

    return {
      id: request.id,
      ok: true,
      result: { subscribed: true },
    }
  }

  private async handleRunControlSubscriptionRequest(
    request: RemoteControlGatewayRequest,
    socket: Socket,
    subscriptions: Array<{ unsubscribe(): void }>,
  ): Promise<RemoteControlGatewayResponse> {
    const options = assertOptionalObject(request.params)
    const subscription = await this.service.subscribeRunControlCommands(event => {
      writeRunControlMessage(socket, event)
    }, options)
    subscriptions.push(subscription)

    setTimeout(() => {
      void Promise.resolve(this.service.listRunControlChanges(options as ListRunControlCommandsOptions))
        .then(events => {
          for (const event of events) writeRunControlMessage(socket, event)
        })
        .catch((error: unknown) => {
          socket.write(`${JSON.stringify({
            id: request.id,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          })}\n`)
        })
    }, 0)

    return {
      id: request.id,
      ok: true,
      result: { subscribed: true },
    }
  }
}

export async function handleRemoteControlGatewayRequest(
  service: RemoteControlGatewayService,
  request: RemoteControlGatewayRequest,
): Promise<RemoteControlGatewayResponse> {
  try {
    const result = await dispatchRemoteControlGatewayRequest(service, request)
    return { id: request.id, ok: true, result }
  } catch (error) {
    return {
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

export function defaultRemoteControlSocketPath(): string {
  const uid = typeof process.getuid === 'function' ? String(process.getuid()) : 'user'
  if (process.platform === 'win32') return `\\\\.\\pipe\\telegraph-remote-control-${uid}`
  return join(tmpdir(), `telegraph-remote-control-${uid}.sock`)
}

async function dispatchRemoteControlGatewayRequest(
  service: RemoteControlGatewayService,
  request: RemoteControlGatewayRequest,
): Promise<unknown> {
  switch (request.method) {
    case 'submitExternalMessage': {
      const params = assertObject(request.params) as {
        message?: ExternalMessage
        options?: RemoteControlSubmitOptions
      }
      if (!params.message) throw new Error('Missing external message')
      return service.submitExternalMessage(params.message, params.options)
    }
    case 'listChannelReplies':
      return service.listChannelReplies(assertOptionalObject(request.params))
    case 'subscribeChannelReplies':
      throw new Error('subscribeChannelReplies requires a socket connection')
    case 'ackChannelReply':
      return service.ackChannelReply(assertObject(request.params) as unknown as AckChannelReplyInput)
    case 'listApprovals':
      return service.listApprovals(assertOptionalObject(request.params))
    case 'listApprovalChanges':
      return service.listApprovalChanges(assertOptionalObject(request.params))
    case 'subscribeApprovals':
      throw new Error('subscribeApprovals requires a socket connection')
    case 'decideApproval': {
      const params = assertObject(request.params) as unknown as {
        approvalId?: unknown
        input?: DecideApprovalInput
      }
      if (typeof params.approvalId !== 'string') throw new Error('Missing approvalId')
      if (!params.input) throw new Error('Missing approval decision input')
      return service.decideApproval(params.approvalId, params.input)
    }
    case 'requestRunControlCommand':
      return service.requestRunControlCommand(assertObject(request.params) as unknown as CreateRunControlCommandInput)
    case 'listRunControlCommands':
      return service.listRunControlCommands(assertOptionalObject(request.params))
    case 'listRunControlChanges':
      return service.listRunControlChanges(assertOptionalObject(request.params))
    case 'subscribeRunControlCommands':
      throw new Error('subscribeRunControlCommands requires a socket connection')
    case 'listRunProjections':
      return service.listRunProjections(assertOptionalObject(request.params))
    case 'getRunProjection': {
      const params = assertObject(request.params) as { runId?: unknown }
      if (typeof params.runId !== 'string') throw new Error('Missing runId')
      return service.getRunProjection(params.runId)
    }
    case 'listRunProjectionChanges':
      return service.listRunProjectionChanges(assertOptionalObject(request.params))
    case 'subscribeRunProjections':
      throw new Error('subscribeRunProjections requires a socket connection')
    case 'handleTelegramUpdate': {
      const params = assertObject(request.params) as { update?: TelegramUpdate }
      if (!params.update) throw new Error('Missing Telegram update')
      return service.handleTelegramUpdate(params.update)
    }
    case 'handleSlackSlashCommand': {
      const params = assertObject(request.params) as { payload?: SlackSlashCommandPayload }
      if (!params.payload) throw new Error('Missing Slack slash command payload')
      return service.handleSlackSlashCommand(params.payload)
    }
    case 'handleSlackEventCallback': {
      const params = assertObject(request.params) as { payload?: SlackEventCallbackPayload }
      if (!params.payload) throw new Error('Missing Slack event callback payload')
      return service.handleSlackEventCallback(params.payload)
    }
    case 'handleSlackInteraction': {
      const params = assertObject(request.params) as { payload?: SlackInteractionPayload }
      if (!params.payload) throw new Error('Missing Slack interaction payload')
      return service.handleSlackInteraction(params.payload)
    }
    case 'listDeviceBindings':
      return service.listDeviceBindings()
    case 'createDeviceBinding':
      return service.createDeviceBinding(assertObject(request.params) as unknown as CreateDeviceBindingInput)
    case 'revokeDeviceBinding': {
      const params = assertObject(request.params) as { bindingId?: unknown }
      if (typeof params.bindingId !== 'string') throw new Error('Missing bindingId')
      return service.revokeDeviceBinding(params.bindingId)
    }
  }
}
function assertObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Expected params object')
  }
  return value as Record<string, unknown>
}

function assertOptionalObject(value: unknown): Record<string, unknown> {
  if (value === undefined) return {}
  return assertObject(value)
}

function writeReplyMessage(socket: Socket, reply: ChannelReply): void {
  const message: RemoteControlGatewayReplyMessage = { reply }
  socket.write(`${JSON.stringify(message)}\n`)
}

function writeApprovalMessage(socket: Socket, event: ApprovalRequestChangeEvent): void {
  const message: RemoteControlGatewayApprovalMessage = { approvalEvent: event }
  socket.write(`${JSON.stringify(message)}\n`)
}

function writeProjectionMessage(socket: Socket, event: RunProjectionChangeEvent): void {
  const message: RemoteControlGatewayProjectionMessage = { projectionEvent: event }
  socket.write(`${JSON.stringify(message)}\n`)
}

function writeRunControlMessage(socket: Socket, event: RunControlCommandChangeEvent): void {
  const message: RemoteControlGatewayRunControlMessage = { runControlEvent: event }
  socket.write(`${JSON.stringify(message)}\n`)
}
