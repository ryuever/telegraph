import { createId, inject, injectable } from '@x-oasis/di'
import { serviceHost } from '@x-oasis/async-call-rpc'
import type { ElectronMessagePortMainChannel } from '@x-oasis/async-call-rpc-electron'
import type { ChannelReply, DeviceBinding, ExternalMessage } from '@/packages/remote-protocol'
import type { EventSubscription, ISharedService } from '@/apps/shared/application/common'
import type {
  ApprovalRequestChangeEvent,
  ApprovalRequestRecord,
  DecideApprovalInput,
  ListApprovalChangesOptions,
  ListApprovalRequestsOptions,
  ListRunControlCommandsOptions,
  ListRunIntentsOptions,
  ListRunProjectionChangesOptions,
  ListRunProjectionsOptions,
  CreateRunControlCommandInput,
  RunControlCommandChangeEvent,
  RunControlCommandRecord,
  RunIntentRecord,
  RunProjectionChangeEvent,
  RunProjectionRecord,
} from '@/packages/run-protocol'
import { PageletWorker, PageletWorkerConfigId } from '@/packages/services/pagelet-host/node/PageletWorker'
import type { IPageletWorkerConfig } from '@/packages/services/pagelet-host/node/PageletWorker'
import {
  REMOTE_CONTROL_PAGELET_SERVICE_PATH,
  type AckChannelReplyInput,
  type CreateDeviceBindingInput,
  type CreateSlackAppInstallationInput,
  type CreateSlackDeviceBindingInput,
  type CreateSlackUserBindingInput,
  type CreateSlackWorkspaceBindingInput,
  type EventSubscription as RemoteControlEventSubscription,
  type ListChannelRepliesOptions,
  type RemoteControlSubmissionResult,
  type RemoteControlSubmitOptions,
  type SlackAppInstallation,
  type SlackDeviceBinding,
  type SlackLifecycleEvent,
  type SlackLifecycleRevokeResult,
  type SlackOAuthCallbackInput,
  type SlackOAuthCallbackResult,
  type SlackTeamAuditEvent,
  type SlackUserBinding,
  type SlackWorkspaceBinding,
} from '@/apps/remote-control/application/common'
import {
  createRunIntentInputFromExternalMessage,
  externalMessageFromRunIntent,
  replyForRunProjection,
  queuedReplyForRunIntent,
} from './RemoteControlMessageRouter'
import { RemoteControlSocketGateway } from './RemoteControlSocketGateway'
import { RemoteControlDeviceBindingRepository } from './RemoteControlDeviceBindingRepository'
import { validateExternalMessageDeviceBinding } from './RemoteControlDeviceBindingPolicy'
import { RemoteControlIngressPolicy } from './RemoteControlIngressPolicy'
import { RemoteControlReplyOutbox } from './RemoteControlReplyOutbox'
import { RemoteControlReplyDeliveryRepository } from './RemoteControlReplyDeliveryRepository'
import { TelegramBotApiAdapter, TelegramBotApiClient } from './TelegramBotApiAdapter'
import { TelegramCommandRouter, type TelegramUpdate } from './TelegramCommandRouter'
import {
  SlackCommandRouter,
  type SlackEventCallbackPayload,
  type SlackInteractionPayload,
  type SlackSlashCommandPayload,
} from './SlackCommandRouter'
import {
  FileSlackTeamGovernanceRepository,
  SlackTeamGovernance,
} from './SlackTeamGovernance'
import {
  createSlackOAuthCallbackHandlerFromEnv,
  type SlackOAuthCallbackHandler,
} from './SlackOAuthCallbackHandler'
import {
  createRemoteControlHttpGatewayFromEnv,
  type RemoteControlHttpGateway,
} from './RemoteControlHttpGateway'
import { createLogger } from '@/packages/services/log/node/logger'

export const RemoteControlWorkerId = createId('RemoteControlWorker')
const logger = createLogger('remote-control')

@injectable()
export class RemoteControlWorker extends PageletWorker<ISharedService> {
  private readonly deviceBindings = new Map<string, DeviceBinding>()
  private readonly replyListeners = new Set<(reply: ChannelReply) => void>()
  private readonly deviceBindingRepository = new RemoteControlDeviceBindingRepository()
  private readonly replyDeliveryRepository = new RemoteControlReplyDeliveryRepository()
  private readonly slackGovernanceRepository = new FileSlackTeamGovernanceRepository()
  private readonly ingressPolicy = new RemoteControlIngressPolicy()
  private readonly deviceBindingsReady = this.hydrateDeviceBindings()
  private readonly replyOutbox = new RemoteControlReplyOutbox()
  private readonly replyDeliveryReady = this.hydrateReplyDelivery()
  private readonly slackGovernance = SlackTeamGovernance.empty()
  private readonly slackGovernanceReady = this.hydrateSlackGovernance()
  private slackOAuthCallbackHandler: SlackOAuthCallbackHandler | null = null
  private readonly telegramRouter = new TelegramCommandRouter(this, {
    allowedGroupChatIds: parseTelegramAllowedGroupChatIds(process.env.TELEGRAPH_TELEGRAM_ALLOWED_GROUPS),
  })
  private readonly slackRouter = new SlackCommandRouter(this, { governance: this.slackGovernance })
  private telegramBotApiAdapter: TelegramBotApiAdapter | null = null
  private readonly relayGateway = new RemoteControlSocketGateway(this)
  private relayGatewayStart: Promise<void> | null = null
  private readonly httpGateway: RemoteControlHttpGateway | null = createRemoteControlHttpGatewayFromEnv(this)
  private httpGatewayStart: Promise<void> | null = null
  private projectionSubscription: EventSubscription | null = null

  constructor(@inject(PageletWorkerConfigId) config: IPageletWorkerConfig) {
    super(config)
  }

  protected override onSharedClientReady(): void {
    void this.startRelayGateway()
    void this.startHttpGateway()
    this.startTelegramBotApiAdapter()
    this.subscribeProjectionReplies()
  }

  protected override onRendererConnection(channel: ElectronMessagePortMainChannel): void {
    serviceHost.registerService(REMOTE_CONTROL_PAGELET_SERVICE_PATH, {
      channel,
      handlers: {
        info: (): string => `remote-control ready (pid=${String(process.pid)})`,
        submitExternalMessage: (
          message: ExternalMessage,
          options?: RemoteControlSubmitOptions,
        ): Promise<RemoteControlSubmissionResult> => this.submitExternalMessage(message, options),
        listChannelReplies: (options?: ListChannelRepliesOptions): Promise<ChannelReply[]> =>
          this.listChannelReplies(options),
        subscribeChannelReplies: (
          callback: (reply: ChannelReply) => void,
          options?: ListChannelRepliesOptions,
        ): RemoteControlEventSubscription => this.subscribeChannelReplies(callback, options),
        ackChannelReply: (input: AckChannelReplyInput): Promise<ChannelReply | null> =>
          this.ackChannelReply(input),
        listApprovals: (options?: ListApprovalRequestsOptions): Promise<ApprovalRequestRecord[]> =>
          this.listApprovals(options),
        listApprovalChanges: (options?: ListApprovalChangesOptions): Promise<ApprovalRequestChangeEvent[]> =>
          this.listApprovalChanges(options),
        subscribeApprovals: (
          callback: (event: ApprovalRequestChangeEvent) => void,
          options?: ListApprovalChangesOptions,
        ): RemoteControlEventSubscription => this.subscribeApprovals(callback, options),
        decideApproval: (
          approvalId: string,
          input: DecideApprovalInput,
        ): Promise<ApprovalRequestRecord | null> => this.decideApproval(approvalId, input),
        requestRunControlCommand: (input: CreateRunControlCommandInput): Promise<RunControlCommandRecord> =>
          this.requestRunControlCommand(input),
        listRunControlCommands: (options?: ListRunControlCommandsOptions): Promise<RunControlCommandRecord[]> =>
          this.listRunControlCommands(options),
        listRunControlChanges: (options?: ListRunControlCommandsOptions): Promise<RunControlCommandChangeEvent[]> =>
          this.listRunControlChanges(options),
        subscribeRunControlCommands: (
          callback: (event: RunControlCommandChangeEvent) => void,
          options?: ListRunControlCommandsOptions,
        ): RemoteControlEventSubscription => this.subscribeRunControlCommands(callback, options),
        listRunIntents: (options?: ListRunIntentsOptions): Promise<RunIntentRecord[]> =>
          this.listRunIntents(options),
        listRunProjections: (options?: ListRunProjectionsOptions): Promise<RunProjectionRecord[]> =>
          this.listRunProjections(options),
        getRunProjection: (runId: string): Promise<RunProjectionRecord | null> =>
          this.getRunProjection(runId),
        listRunProjectionChanges: (options?: ListRunProjectionChangesOptions): Promise<RunProjectionChangeEvent[]> =>
          this.listRunProjectionChanges(options),
        subscribeRunProjections: (
          callback: (event: RunProjectionChangeEvent) => void,
          options?: ListRunProjectionChangesOptions,
        ): RemoteControlEventSubscription => this.subscribeRunProjections(callback, options),
        handleTelegramUpdate: (update: TelegramUpdate): Promise<ChannelReply[]> =>
          this.handleTelegramUpdate(update),
        handleSlackSlashCommand: (payload: SlackSlashCommandPayload): Promise<ChannelReply> =>
          this.handleSlackSlashCommand(payload),
        handleSlackEventCallback: (payload: SlackEventCallbackPayload): Promise<ChannelReply[]> =>
          this.handleSlackEventCallback(payload),
        handleSlackInteraction: (payload: SlackInteractionPayload): Promise<ChannelReply[]> =>
          this.handleSlackInteraction(payload),
        listDeviceBindings: (): Promise<DeviceBinding[]> => this.listDeviceBindings(),
        createDeviceBinding: (input: CreateDeviceBindingInput): Promise<DeviceBinding> =>
          this.createDeviceBinding(input),
        revokeDeviceBinding: (bindingId: string): Promise<DeviceBinding | null> =>
          this.revokeDeviceBinding(bindingId),
        listSlackWorkspaceBindings: (): Promise<SlackWorkspaceBinding[]> => this.listSlackWorkspaceBindings(),
        createSlackWorkspaceBinding: (
          input: CreateSlackWorkspaceBindingInput,
        ): Promise<SlackWorkspaceBinding> => this.createSlackWorkspaceBinding(input),
        revokeSlackWorkspaceBinding: (workspaceId: string): Promise<SlackWorkspaceBinding | null> =>
          this.revokeSlackWorkspaceBinding(workspaceId),
        listSlackAppInstallations: (): Promise<SlackAppInstallation[]> => this.listSlackAppInstallations(),
        createSlackAppInstallation: (
          input: CreateSlackAppInstallationInput,
        ): Promise<SlackAppInstallation> => this.createSlackAppInstallation(input),
        revokeSlackAppInstallation: (installationId: string): Promise<SlackAppInstallation | null> =>
          this.revokeSlackAppInstallation(installationId),
        listSlackUserBindings: (): Promise<SlackUserBinding[]> => this.listSlackUserBindings(),
        createSlackUserBinding: (input: CreateSlackUserBindingInput): Promise<SlackUserBinding> =>
          this.createSlackUserBinding(input),
        revokeSlackUserBinding: (workspaceId: string, userId: string): Promise<SlackUserBinding | null> =>
          this.revokeSlackUserBinding(workspaceId, userId),
        listSlackDeviceBindings: (): Promise<SlackDeviceBinding[]> => this.listSlackDeviceBindings(),
        createSlackDeviceBinding: (input: CreateSlackDeviceBindingInput): Promise<SlackDeviceBinding> =>
          this.createSlackDeviceBinding(input),
        revokeSlackDeviceBinding: (bindingId: string): Promise<SlackDeviceBinding | null> =>
          this.revokeSlackDeviceBinding(bindingId),
        handleSlackOAuthCallback: (input: SlackOAuthCallbackInput): Promise<SlackOAuthCallbackResult> =>
          this.handleSlackOAuthCallback(input),
        listSlackTeamAuditEvents: (): Promise<SlackTeamAuditEvent[]> => this.listSlackTeamAuditEvents(),
        handleSlackLifecycleEvent: (event: SlackLifecycleEvent): Promise<SlackLifecycleRevokeResult> =>
          this.handleSlackLifecycleEvent(event),
      },
    })
  }

  async submitExternalMessage(
    message: ExternalMessage,
    options: RemoteControlSubmitOptions = {},
  ): Promise<RemoteControlSubmissionResult> {
    this.ingressPolicy.accept(message)
    await this.deviceBindingsReady
    validateExternalMessageDeviceBinding(message, Array.from(this.deviceBindings.values()), {
      requireDeviceBinding: options.requireDeviceBinding,
    })
    const intent = await this.shared.createRunIntent(createRunIntentInputFromExternalMessage(message, options))
    const reply = queuedReplyForRunIntent(message, intent)
    this.replyOutbox.trackSubmission(message, intent, reply)
    this.emitChannelReply(reply)

    return {
      intent,
      reply,
    }
  }

  async listChannelReplies(options: ListChannelRepliesOptions = {}): Promise<ChannelReply[]> {
    await this.replyDeliveryReady
    const replies = new Map<string, ChannelReply>()
    for (const reply of this.replyOutbox.listReplies({ ...options, limit: 500 })) {
      replies.set(reply.replyId, reply)
    }
    for (const reply of this.replyOutbox.decorateReplies(await this.reconstructPersistedChannelReplies())) {
      if (!replies.has(reply.replyId)) {
        replies.set(reply.replyId, reply)
      }
    }
    return RemoteControlReplyOutbox.filterReplies(Array.from(replies.values()), options)
  }

  subscribeChannelReplies(
    callback: (reply: ChannelReply) => void,
    options: ListChannelRepliesOptions = {},
  ): RemoteControlEventSubscription {
    const listener = (reply: ChannelReply): void => {
      if (channelReplyMatches(reply, options)) callback(reply)
    }
    this.replyListeners.add(listener)
    return {
      unsubscribe: () => {
        this.replyListeners.delete(listener)
      },
    }
  }

  async ackChannelReply(input: AckChannelReplyInput): Promise<ChannelReply | null> {
    await this.replyDeliveryReady
    const knownReply = this.replyOutbox.listReplies({ limit: 500 })
      .find(reply => reply.replyId === input.replyId)
      ?? this.replyOutbox.decorateReplies(await this.reconstructPersistedChannelReplies())
        .find(reply => reply.replyId === input.replyId)

    if (!knownReply) return null

    if (!this.replyOutbox.listReplies({ limit: 500 }).some(reply => reply.replyId === input.replyId)) {
      this.replyOutbox.trackReconstructedReply(knownReply)
    }

    const reply = this.replyOutbox.ackReply(input)
    await this.persistReplyDelivery()
    if (reply) this.emitChannelReply(reply)
    return reply
  }

  listApprovals(options: ListApprovalRequestsOptions = {}): Promise<ApprovalRequestRecord[]> {
    return this.shared.listApprovals(options)
  }

  listApprovalChanges(options: ListApprovalChangesOptions = {}): Promise<ApprovalRequestChangeEvent[]> {
    return this.shared.listApprovalChanges(options)
  }

  subscribeApprovals(
    callback: (event: ApprovalRequestChangeEvent) => void,
    options: ListApprovalChangesOptions = {},
  ): RemoteControlEventSubscription {
    const subscription = this.shared.subscribeApprovals(event => {
      if (approvalEventMatches(event, options)) callback(event)
    })
    return {
      unsubscribe: () => {
        subscription.unsubscribe()
      },
    }
  }

  decideApproval(approvalId: string, input: DecideApprovalInput): Promise<ApprovalRequestRecord | null> {
    return this.shared.decideApproval(approvalId, input)
  }

  requestRunControlCommand(input: CreateRunControlCommandInput): Promise<RunControlCommandRecord> {
    return this.shared.requestRunControlCommand(input)
  }

  listRunControlCommands(options: ListRunControlCommandsOptions = {}): Promise<RunControlCommandRecord[]> {
    return this.shared.listRunControlCommands(options)
  }

  listRunControlChanges(options: ListRunControlCommandsOptions = {}): Promise<RunControlCommandChangeEvent[]> {
    return this.shared.listRunControlChanges(options)
  }

  subscribeRunControlCommands(
    callback: (event: RunControlCommandChangeEvent) => void,
    options: ListRunControlCommandsOptions = {},
  ): RemoteControlEventSubscription {
    const subscription = this.shared.subscribeRunControlCommands(event => {
      if (runControlEventMatches(event, options)) callback(event)
    })
    return {
      unsubscribe: () => {
        subscription.unsubscribe()
      },
    }
  }

  listRunIntents(options: ListRunIntentsOptions = {}): Promise<RunIntentRecord[]> {
    return this.shared.listRunIntents(options)
  }

  listRunProjections(options: ListRunProjectionsOptions = {}): Promise<RunProjectionRecord[]> {
    return this.shared.listRunProjections(options)
  }

  getRunProjection(runId: string): Promise<RunProjectionRecord | null> {
    return this.shared.getRunProjection(runId)
  }

  listRunProjectionChanges(options: ListRunProjectionChangesOptions = {}): Promise<RunProjectionChangeEvent[]> {
    return this.shared.listRunProjectionChanges(options)
  }

  subscribeRunProjections(
    callback: (event: RunProjectionChangeEvent) => void,
    options: ListRunProjectionChangesOptions = {},
  ): RemoteControlEventSubscription {
    const subscription = this.shared.subscribeRunProjections(event => {
      if (projectionEventMatches(event, options)) callback(event)
    })
    return {
      unsubscribe: () => {
        subscription.unsubscribe()
      },
    }
  }

  handleTelegramUpdate(update: TelegramUpdate): Promise<ChannelReply[]> {
    return this.telegramRouter.handleUpdate(update)
  }

  async handleSlackSlashCommand(payload: SlackSlashCommandPayload): Promise<ChannelReply> {
    await this.slackGovernanceReady
    const reply = await this.slackRouter.handleSlashCommand(payload)
    await this.persistSlackGovernance()
    return reply
  }

  async handleSlackEventCallback(payload: SlackEventCallbackPayload): Promise<ChannelReply[]> {
    await this.slackGovernanceReady
    const replies = await this.slackRouter.handleEventCallback(payload)
    await this.persistSlackGovernance()
    return replies
  }

  async handleSlackInteraction(payload: SlackInteractionPayload): Promise<ChannelReply[]> {
    await this.slackGovernanceReady
    const replies = await this.slackRouter.handleInteraction(payload)
    await this.persistSlackGovernance()
    return replies
  }

  async listDeviceBindings(): Promise<DeviceBinding[]> {
    await this.deviceBindingsReady
    return Array.from(this.deviceBindings.values())
  }

  async createDeviceBinding(input: CreateDeviceBindingInput): Promise<DeviceBinding> {
    await this.deviceBindingsReady
    const now = Date.now()
    const binding: DeviceBinding = {
      bindingId: input.bindingId ?? `binding-${globalThis.crypto.randomUUID()}`,
      deviceId: input.deviceId,
      actor: input.actor,
      label: input.label,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      expiresAt: input.expiresAt,
    }
    this.deviceBindings.set(binding.bindingId, binding)
    await this.persistDeviceBindings()
    return binding
  }

  async revokeDeviceBinding(bindingId: string): Promise<DeviceBinding | null> {
    await this.deviceBindingsReady
    const current = this.deviceBindings.get(bindingId)
    if (!current) return null
    const now = Date.now()
    const next: DeviceBinding = {
      ...current,
      status: 'revoked',
      updatedAt: now,
      revokedAt: now,
    }
    this.deviceBindings.set(bindingId, next)
    await this.persistDeviceBindings()
    return next
  }

  async listSlackWorkspaceBindings(): Promise<SlackWorkspaceBinding[]> {
    await this.slackGovernanceReady
    return this.slackGovernance.listWorkspaceBindings()
  }

  async createSlackWorkspaceBinding(input: CreateSlackWorkspaceBindingInput): Promise<SlackWorkspaceBinding> {
    await this.slackGovernanceReady
    const binding = this.slackGovernance.upsertWorkspaceBinding(input)
    await this.persistSlackGovernance()
    return binding
  }

  async revokeSlackWorkspaceBinding(workspaceId: string): Promise<SlackWorkspaceBinding | null> {
    await this.slackGovernanceReady
    const binding = this.slackGovernance.revokeWorkspaceBinding(workspaceId)
    await this.persistSlackGovernance()
    return binding
  }

  async listSlackAppInstallations(): Promise<SlackAppInstallation[]> {
    await this.slackGovernanceReady
    return this.slackGovernance.listAppInstallations()
  }

  async createSlackAppInstallation(input: CreateSlackAppInstallationInput): Promise<SlackAppInstallation> {
    await this.slackGovernanceReady
    const installation = this.slackGovernance.createAppInstallation(input)
    await this.persistSlackGovernance()
    return installation
  }

  async revokeSlackAppInstallation(installationId: string): Promise<SlackAppInstallation | null> {
    await this.slackGovernanceReady
    const installation = this.slackGovernance.revokeAppInstallation(installationId)
    await this.persistSlackGovernance()
    return installation
  }

  async listSlackUserBindings(): Promise<SlackUserBinding[]> {
    await this.slackGovernanceReady
    return this.slackGovernance.listUserBindings()
  }

  async createSlackUserBinding(input: CreateSlackUserBindingInput): Promise<SlackUserBinding> {
    await this.slackGovernanceReady
    const binding = this.slackGovernance.upsertUserBinding(input)
    await this.persistSlackGovernance()
    return binding
  }

  async revokeSlackUserBinding(workspaceId: string, userId: string): Promise<SlackUserBinding | null> {
    await this.slackGovernanceReady
    const binding = this.slackGovernance.revokeUserBinding(workspaceId, userId)
    await this.persistSlackGovernance()
    return binding
  }

  async listSlackDeviceBindings(): Promise<SlackDeviceBinding[]> {
    await this.slackGovernanceReady
    return this.slackGovernance.listDeviceBindings()
  }

  async createSlackDeviceBinding(input: CreateSlackDeviceBindingInput): Promise<SlackDeviceBinding> {
    await this.slackGovernanceReady
    const binding = this.slackGovernance.upsertDeviceBinding(input)
    await this.persistSlackGovernance()
    return binding
  }

  async revokeSlackDeviceBinding(bindingId: string): Promise<SlackDeviceBinding | null> {
    await this.slackGovernanceReady
    const binding = this.slackGovernance.revokeDeviceBinding(bindingId)
    await this.persistSlackGovernance()
    return binding
  }

  async handleSlackOAuthCallback(input: SlackOAuthCallbackInput): Promise<SlackOAuthCallbackResult> {
    await this.slackGovernanceReady
    const handler = this.getSlackOAuthCallbackHandler()
    if (!handler) {
      throw new Error('Slack OAuth callback requires TELEGRAPH_SLACK_CLIENT_ID and TELEGRAPH_SLACK_CLIENT_SECRET.')
    }
    const result = await handler.handle(input)
    await this.persistSlackGovernance()
    return result
  }

  async listSlackTeamAuditEvents(): Promise<SlackTeamAuditEvent[]> {
    await this.slackGovernanceReady
    return this.slackGovernance.listAuditEvents()
  }

  async handleSlackLifecycleEvent(event: SlackLifecycleEvent): Promise<SlackLifecycleRevokeResult> {
    await this.slackGovernanceReady
    const result = this.slackGovernance.applyLifecycleEvent(event)
    await this.persistSlackGovernance()
    return result
  }

  private async startRelayGateway(): Promise<void> {
    if (this.relayGatewayStart) return this.relayGatewayStart
    this.relayGatewayStart = this.relayGateway.start()
      .then(path => {
        logger.info(`[remote-control] local relay gateway listening on ${path}`)
      })
      .catch((error: unknown) => {
        this.relayGatewayStart = null
        logger.warn(`[remote-control] local relay gateway failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`)
      })
    return this.relayGatewayStart
  }

  private async startHttpGateway(): Promise<void> {
    if (!this.httpGateway) return
    if (this.httpGatewayStart) return this.httpGatewayStart
    this.httpGatewayStart = this.httpGateway.start()
      .then(address => {
        logger.info(`[remote-control] HTTP gateway listening on http://${address.host}:${String(address.port)}${address.path}`)
      })
      .catch((error: unknown) => {
        this.httpGatewayStart = null
        logger.warn(`[remote-control] HTTP gateway failed to start: ${
          error instanceof Error ? error.message : String(error)
        }`)
      })
    return this.httpGatewayStart
  }

  private startTelegramBotApiAdapter(): void {
    if (this.telegramBotApiAdapter) return
    const token = process.env.TELEGRAPH_TELEGRAM_BOT_TOKEN
    if (!token) return

    const adapter = new TelegramBotApiAdapter({
      client: new TelegramBotApiClient({
        token,
        apiBaseUrl: process.env.TELEGRAPH_TELEGRAM_API_BASE_URL,
      }),
      router: this.telegramRouter,
      onReplyDelivered: (reply) => {
        void this.ackChannelReply({
          replyId: reply.replyId,
          status: 'sent',
          deliveredBy: {
            actorId: 'telegram-bot-api',
            kind: 'system',
            displayName: 'Telegram Bot API',
          },
        }).catch((error: unknown) => {
          logger.warn(`[remote-control] failed to ack Telegram reply delivery: ${
            error instanceof Error ? error.message : String(error)
          }`)
        })
      },
      onReplyDeliveryFailed: (reply, error) => {
        void this.ackChannelReply({
          replyId: reply.replyId,
          status: 'failed',
          error: error.message,
          deliveredBy: {
            actorId: 'telegram-bot-api',
            kind: 'system',
            displayName: 'Telegram Bot API',
          },
        }).catch((ackError: unknown) => {
          logger.warn(`[remote-control] failed to ack Telegram reply delivery failure: ${
            ackError instanceof Error ? ackError.message : String(ackError)
          }`)
        })
      },
      onError: error => {
        logger.warn(`[remote-control] Telegram Bot API polling error: ${error.message}`)
      },
    })
    this.telegramBotApiAdapter = adapter
    adapter.start()
    logger.info('[remote-control] Telegram Bot API adapter started')
  }

  private subscribeProjectionReplies(): void {
    if (this.projectionSubscription) return
    void Promise.resolve(this.shared.subscribeRunProjections(event => {
        const reply = this.replyOutbox.recordProjection(event.projection)
        if (!reply) return
        this.emitChannelReply(reply)
        logger.info(`[remote-control] queued channel reply ${reply.replyId} for run ${reply.runId ?? 'unknown'}`)
      }))
      .then(subscription => {
        this.projectionSubscription = subscription
      })
      .catch((error: unknown) => {
        this.projectionSubscription = null
        logger.warn(`[remote-control] projection reply subscription failed: ${
          error instanceof Error ? error.message : String(error)
        }`)
      })
  }

  private async hydrateDeviceBindings(): Promise<void> {
    for (const binding of await this.deviceBindingRepository.load()) {
      this.deviceBindings.set(binding.bindingId, binding)
    }
  }

  private async hydrateReplyDelivery(): Promise<void> {
    this.replyOutbox.hydrateDelivery(await this.replyDeliveryRepository.load())
  }

  private async hydrateSlackGovernance(): Promise<void> {
    this.slackGovernance.replaceSnapshot(await this.slackGovernanceRepository.load())
  }

  private getSlackOAuthCallbackHandler(): SlackOAuthCallbackHandler | null {
    this.slackOAuthCallbackHandler ??= createSlackOAuthCallbackHandlerFromEnv(this.slackGovernance)
    return this.slackOAuthCallbackHandler
  }

  private async persistDeviceBindings(): Promise<void> {
    await this.deviceBindingRepository.save(Array.from(this.deviceBindings.values()))
  }

  private async persistReplyDelivery(): Promise<void> {
    await this.replyDeliveryRepository.save(this.replyOutbox.listDeliveryRecords())
  }

  private async persistSlackGovernance(): Promise<void> {
    await this.slackGovernanceRepository.save(this.slackGovernance.snapshot())
  }

  private emitChannelReply(reply: ChannelReply): void {
    for (const listener of this.replyListeners) {
      try {
        listener(reply)
      } catch {
        this.replyListeners.delete(listener)
      }
    }
  }

  private async reconstructPersistedChannelReplies(): Promise<ChannelReply[]> {
    const [intentsResult, projectionsResult] = await Promise.all([
      this.shared.listRunIntents({ limit: 500 }),
      this.shared.listRunProjections({ limit: 500 }),
    ])
    const intents = Array.isArray(intentsResult) ? intentsResult : []
    const projections = Array.isArray(projectionsResult) ? projectionsResult : []
    return channelRepliesFromRunBrokerState(intents, projections)
  }
}

function channelReplyMatches(reply: ChannelReply, options: ListChannelRepliesOptions): boolean {
  if (options.channelId && reply.channelId !== options.channelId) return false
  if (options.threadId && reply.threadId !== options.threadId) return false
  if (options.runId && reply.runId !== options.runId) return false
  if (options.status && reply.status !== options.status) return false
  if (options.afterCursor !== undefined && (reply.cursor === undefined || reply.cursor <= options.afterCursor)) {
    return false
  }
  return true
}

function approvalEventMatches(event: ApprovalRequestChangeEvent, options: ListApprovalChangesOptions): boolean {
  if (options.runId && event.runId !== options.runId) return false
  if (options.status && event.approval.status !== options.status) return false
  if (options.afterCursor !== undefined && event.cursor <= options.afterCursor) return false
  return true
}

function projectionEventMatches(event: RunProjectionChangeEvent, options: ListRunProjectionChangesOptions): boolean {
  if (options.runId && event.runId !== options.runId) return false
  if (options.pageletId && event.projection.pageletId !== options.pageletId) return false
  if (options.status && event.projection.status !== options.status) return false
  if (options.afterCursor !== undefined && event.cursor <= options.afterCursor) return false
  return true
}

function runControlEventMatches(event: RunControlCommandChangeEvent, options: ListRunControlCommandsOptions): boolean {
  if (options.runId && event.runId !== options.runId) return false
  if (options.status && event.command.status !== options.status) return false
  if (options.kind && event.command.kind !== options.kind) return false
  if (options.afterCursor !== undefined && event.cursor <= options.afterCursor) return false
  return true
}

export function channelRepliesFromRunBrokerState(
  intents: RunIntentRecord[],
  projections: RunProjectionRecord[],
): ChannelReply[] {
  const replies: ChannelReply[] = []
  const intentsById = new Map(intents.map(intent => [intent.intentId, intent]))
  const intentsByRunId = new Map(
    intents
      .filter((intent): intent is RunIntentRecord & { runId: string } => typeof intent.runId === 'string')
      .map(intent => [intent.runId, intent]),
  )

  for (const intent of intents) {
    const message = externalMessageFromRunIntent(intent)
    if (!message) continue
    replies.push(queuedReplyForRunIntent(message, intent, intent.createdAt))
  }

  for (const projection of projections) {
    const intent = projection.sourceIntentId
      ? intentsById.get(projection.sourceIntentId)
      : intentsByRunId.get(projection.runId)
    if (!intent) continue

    const message = externalMessageFromRunIntent(intent)
    if (!message) continue
    replies.push(replyForRunProjection(message, projection, projection.updatedAt))
  }

  return replies
}

function parseTelegramAllowedGroupChatIds(value: string | undefined): string[] {
  if (!value) return []
  return value
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}
