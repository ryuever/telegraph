import type { ChannelReply, ExternalMessage, RemoteActorSnapshot, RemoteArtifactRef } from '@/packages/remote-protocol'
import { REMOTE_PROTOCOL_SCHEMA_VERSION } from '@/packages/remote-protocol'
import type {
  ApprovalRequestRecord,
  ListRunProjectionsOptions,
  RunControlCommandKind,
  RunControlCommandRecord,
  RunProjectionRecord,
} from '@/packages/run-protocol'
import type { RemoteControlSubmissionResult, RemoteControlSubmitOptions } from '@/apps/remote-control/application/common'

export interface TelegramUser {
  id: number
  username?: string
  first_name?: string
  last_name?: string
}

export interface TelegramChat {
  id: number
  type?: string
  title?: string
}

export interface TelegramMessage {
  message_id: number
  date?: number
  text?: string
  chat: TelegramChat
  from?: TelegramUser
}

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

export interface TelegramCommandRouterService {
  submitExternalMessage(
    message: ExternalMessage,
    options?: RemoteControlSubmitOptions,
  ): Promise<RemoteControlSubmissionResult> | RemoteControlSubmissionResult
  listRunProjections(options?: ListRunProjectionsOptions): Promise<RunProjectionRecord[]> | RunProjectionRecord[]
  decideApproval(approvalId: string, input: {
    granted: boolean
    decidedBy: RemoteActorSnapshot
    reason?: string
  }): Promise<ApprovalRequestRecord | null> | ApprovalRequestRecord | null
  requestRunControlCommand(input: {
    runId: string
    kind: RunControlCommandKind
    requestedBy: RemoteActorSnapshot
    reason?: string
  }): Promise<RunControlCommandRecord> | RunControlCommandRecord
}

export interface TelegramCommandRouterOptions {
  defaultTargetPagelet?: string
  allowedGroupChatIds?: Iterable<number | string>
}

export class TelegramCommandRouter {
  private readonly defaultTargetPagelet: string
  private readonly allowedGroupChatIds: Set<string>

  constructor(
    private readonly service: TelegramCommandRouterService,
    options: TelegramCommandRouterOptions | string = {},
  ) {
    if (typeof options === 'string') {
      this.defaultTargetPagelet = options
      this.allowedGroupChatIds = new Set()
      return
    }
    this.defaultTargetPagelet = options.defaultTargetPagelet ?? 'design'
    this.allowedGroupChatIds = new Set(
      Array.from(options.allowedGroupChatIds ?? []).map(value => String(value)),
    )
  }

  async handleUpdate(update: TelegramUpdate): Promise<ChannelReply[]> {
    const message = update.message
    if (!message?.text) return []

    const command = parseTelegramCommand(message.text)
    if (!command) return []
    if (isRestrictedGroupChat(message, this.allowedGroupChatIds)) {
      return [await this.handleRestrictedGroupCommand(message, command)]
    }

    switch (command.name) {
      case 'ask':
        return [await this.submitPrompt(message, command.args || message.text)]
      case 'screen':
        return [await this.screen(message, command.args)]
      case 'runs':
        return [await this.listRuns(message)]
      case 'approve':
      case 'deny':
        return [await this.decideApproval(message, command.name === 'approve', command.args)]
      case 'pause':
      case 'cancel':
      case 'stop':
        return [await this.requestRunControl(message, command.name, command.args)]
      default:
        return [telegramReply(message, `Unknown command: /${command.name}`, 'skipped')]
    }
  }

  private async handleRestrictedGroupCommand(
    message: TelegramMessage,
    command: { name: string; args: string },
  ): Promise<ChannelReply> {
    if (command.name === 'runs') return this.listRuns(message)
    if (command.name === 'screen') return this.screen(message, command.args, false)
    return telegramReply(message, 'Telegram group chats are read-only by default.', 'skipped')
  }

  private async submitPrompt(
    message: TelegramMessage,
    prompt: string,
    options: RemoteControlSubmitOptions = { targetPagelet: this.defaultTargetPagelet },
  ): Promise<ChannelReply> {
    const externalMessage = externalMessageFromTelegramMessage(message, prompt)
    const result = await this.service.submitExternalMessage(externalMessage, options)
    return result.reply
  }

  private async listRuns(message: TelegramMessage): Promise<ChannelReply> {
    const runs = await this.service.listRunProjections({ limit: 10 })
    const text = runs.length === 0
      ? 'No runs found.'
      : runs.map(run => `${run.runId} ${run.status} cursor=${String(run.cursor)}`).join('\n')
    return telegramReply(message, text, 'sent')
  }

  private async screen(
    message: TelegramMessage,
    args: string,
    allowCaptureFallback = true,
  ): Promise<ChannelReply> {
    const requestedRunId = args.trim() || undefined
    const runs = await this.service.listRunProjections({ limit: 20 })
    const run = selectScreenArtifactRun(runs, requestedRunId)
    if (run?.artifactRefs?.length) {
      return telegramReply(
        message,
        `Screenshot artifact from ${run.runId}.`,
        'sent',
        run.artifactRefs,
        run.runId,
        run.cursor,
      )
    }

    if (requestedRunId) {
      return telegramReply(message, `No screenshot artifact found for ${requestedRunId}.`, 'skipped')
    }

    if (!allowCaptureFallback) {
      return telegramReply(message, 'No screenshot artifact found. Group chats cannot start a new capture by default.', 'skipped')
    }

    return this.submitPrompt(
      message,
      'Use computer.observe to capture a read-only desktop screenshot and summarize what is visible.',
      { targetPagelet: 'chat' },
    )
  }

  private async decideApproval(
    message: TelegramMessage,
    granted: boolean,
    args: string,
  ): Promise<ChannelReply> {
    const [approvalId, ...reasonParts] = args.trim().split(/\s+/).filter(Boolean)
    if (!approvalId) {
      return telegramReply(message, `Usage: /${granted ? 'approve' : 'deny'} <approvalId> [reason]`, 'skipped')
    }
    const decision = await this.service.decideApproval(approvalId, {
      granted,
      decidedBy: actorFromTelegramMessage(message),
      reason: reasonParts.join(' ') || undefined,
    })
    if (!decision) return telegramReply(message, `Approval not found: ${approvalId}`, 'failed')
    return telegramReply(message, `Approval ${decision.status}: ${approvalId}`, 'sent')
  }

  private async requestRunControl(
    message: TelegramMessage,
    kind: RunControlCommandKind,
    args: string,
  ): Promise<ChannelReply> {
    const [maybeRunId, ...reasonParts] = args.trim().split(/\s+/).filter(Boolean)
    const runs = await this.service.listRunProjections({ limit: 20 })
    const run = selectControlRun(runs, maybeRunId)
    if (!run) {
      const usage = `/${kind} <runId> [reason]`
      return telegramReply(message, `No running run found. Usage: ${usage}`, 'skipped')
    }

    const reason = maybeRunId && run.runId === maybeRunId
      ? reasonParts.join(' ') || undefined
      : args.trim() || undefined
    const command = await this.service.requestRunControlCommand({
      runId: run.runId,
      kind,
      requestedBy: actorFromTelegramMessage(message),
      reason,
    })
    if (command.status === 'rejected') {
      return telegramReply(message, `Run ${kind} rejected for ${run.runId}: ${command.rejectionReason ?? 'not allowed'}`, 'failed', undefined, run.runId, run.cursor)
    }
    return telegramReply(message, `Run ${kind} requested for ${run.runId}.`, 'sent', undefined, run.runId, run.cursor)
  }
}

export function externalMessageFromTelegramMessage(
  message: TelegramMessage,
  text = message.text ?? '',
): ExternalMessage {
  return {
    messageId: `telegram-${String(message.chat.id)}-${String(message.message_id)}`,
    actor: actorFromTelegramMessage(message),
    channel: {
      kind: 'telegram',
      channelId: telegramChannelId(message.chat),
    },
    text,
    receivedAt: typeof message.date === 'number' ? message.date * 1000 : Date.now(),
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

function actorFromTelegramMessage(message: TelegramMessage): RemoteActorSnapshot {
  const from = message.from
  return {
    actorId: from ? `telegram:${String(from.id)}` : telegramChannelId(message.chat),
    kind: 'telegram',
    displayName: telegramDisplayName(from),
    channelId: telegramChannelId(message.chat),
  }
}

function telegramReply(
  message: TelegramMessage,
  text: string,
  status: ChannelReply['status'],
  artifactRefs?: RemoteArtifactRef[],
  runId?: string,
  cursor?: number,
): ChannelReply {
  const now = Date.now()
  return {
    replyId: `telegram-reply-${String(message.chat.id)}-${String(message.message_id)}-${status}`,
    channelId: telegramChannelId(message.chat),
    runId,
    cursor,
    text,
    artifactRefs,
    status,
    createdAt: now,
    updatedAt: now,
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

function selectScreenArtifactRun(
  runs: RunProjectionRecord[],
  requestedRunId: string | undefined,
): RunProjectionRecord | undefined {
  const candidates = requestedRunId
    ? runs.filter(run => run.runId === requestedRunId)
    : runs

  return candidates
    .filter(run => Array.isArray(run.artifactRefs) && run.artifactRefs.length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .at(0)
}

function selectControlRun(
  runs: RunProjectionRecord[],
  requestedRunId: string | undefined,
): RunProjectionRecord | undefined {
  const explicitRun = requestedRunId ? runs.find(run => run.runId === requestedRunId) : undefined
  if (explicitRun || looksLikeRunId(requestedRunId)) return explicitRun
  return runs
    .filter(run => run.status === 'running')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .at(0)
}

function looksLikeRunId(value: string | undefined): boolean {
  return typeof value === 'string' && /^run[-_:]/.test(value)
}

function parseTelegramCommand(text: string): { name: string; args: string } | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith('/')) return null
  const [rawCommand, ...rest] = trimmed.slice(1).split(/\s+/)
  const name = rawCommand.split('@')[0]?.toLowerCase()
  if (!name) return null
  return {
    name,
    args: rest.join(' ').trim(),
  }
}

function isRestrictedGroupChat(message: TelegramMessage, allowedGroupChatIds: Set<string>): boolean {
  if (!message.chat.type || message.chat.type === 'private') return false
  return !allowedGroupChatIds.has(String(message.chat.id))
}

function telegramChannelId(chat: TelegramChat): string {
  return `telegram:${String(chat.id)}`
}

function telegramDisplayName(user: TelegramUser | undefined): string | undefined {
  if (!user) return undefined
  const fullName = [user.first_name, user.last_name].filter(Boolean).join(' ').trim()
  return fullName || user.username
}
