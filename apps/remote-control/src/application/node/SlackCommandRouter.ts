import type { ChannelReply, ExternalMessage, RemoteActorSnapshot } from '@/packages/remote-protocol'
import { REMOTE_PROTOCOL_SCHEMA_VERSION } from '@/packages/remote-protocol'
import type { ApprovalRequestRecord, ListRunProjectionsOptions, RunProjectionRecord } from '@/packages/run-protocol'
import type { RemoteControlSubmissionResult, RemoteControlSubmitOptions } from '@/apps/remote-control/application/common'

export interface SlackUserSnapshot {
  id: string
  username?: string
  name?: string
  team_id?: string
}

export interface SlackSlashCommandPayload {
  command: string
  text?: string
  team_id?: string
  team_domain?: string
  channel_id: string
  channel_name?: string
  user_id: string
  user_name?: string
  trigger_id?: string
  response_url?: string
}

export interface SlackEventCallbackPayload {
  team_id?: string
  event: {
    type: 'app_mention' | 'message'
    user?: string
    text?: string
    channel: string
    ts: string
    thread_ts?: string
  }
  authorizations?: Array<{ user_id?: string; team_id?: string }>
}

export interface SlackInteractionPayload {
  type: 'block_actions' | 'shortcut' | 'view_submission'
  team?: { id?: string; domain?: string }
  user: SlackUserSnapshot
  channel?: { id?: string; name?: string }
  message?: { ts?: string; thread_ts?: string }
  actions?: Array<{
    action_id?: string
    value?: string
  }>
}

export interface SlackCommandRouterService {
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
}

export interface SlackCommandRouterOptions {
  defaultTargetPagelet?: string
}

export class SlackCommandRouter {
  private readonly defaultTargetPagelet: string

  constructor(
    private readonly service: SlackCommandRouterService,
    options: SlackCommandRouterOptions = {},
  ) {
    this.defaultTargetPagelet = options.defaultTargetPagelet ?? 'design'
  }

  async handleSlashCommand(payload: SlackSlashCommandPayload): Promise<ChannelReply> {
    const command = parseSlackCommand(payload.text ?? '')
    if (command.name === 'runs') return this.listRuns(payload)
    if (command.name === 'approve' || command.name === 'deny') {
      return this.decideApproval(payload, command.name === 'approve', command.args)
    }

    const prompt = command.name === 'ask' ? command.args : (payload.text ?? '').trim()
    if (!prompt) {
      return slackReply(payload, 'Usage: /telegraph ask <prompt>', 'skipped')
    }
    const result = await this.service.submitExternalMessage(
      externalMessageFromSlackSlashCommand(payload, prompt),
      { targetPagelet: this.defaultTargetPagelet },
    )
    return result.reply
  }

  async handleEventCallback(payload: SlackEventCallbackPayload): Promise<ChannelReply[]> {
    if (payload.event.type !== 'app_mention') return []
    const text = stripBotMention(payload.event.text ?? '')
    if (!text) return []
    const result = await this.service.submitExternalMessage(
      externalMessageFromSlackEventCallback(payload, text),
      { targetPagelet: this.defaultTargetPagelet },
    )
    return [result.reply]
  }

  async handleInteraction(payload: SlackInteractionPayload): Promise<ChannelReply[]> {
    const action = payload.actions?.[0]
    if (!action?.action_id || !action.value) return []
    const granted = action.action_id === 'telegraph_approve'
      ? true
      : action.action_id === 'telegraph_deny'
        ? false
        : undefined
    if (granted === undefined) return []

    const decision = await this.service.decideApproval(action.value, {
      granted,
      decidedBy: actorFromSlackInteraction(payload),
      reason: `Slack action ${action.action_id}`,
    })
    const channelId = payload.channel?.id ? slackChannelId(payload.channel.id) : 'slack:unknown'
    const threadId = payload.message?.thread_ts ?? payload.message?.ts
    if (!decision) {
      return [slackReplyFromChannel(channelId, threadId, `Approval not found: ${action.value}`, 'failed')]
    }
    return [slackReplyFromChannel(channelId, threadId, `Approval ${decision.status}: ${action.value}`, 'sent')]
  }

  private async listRuns(payload: SlackSlashCommandPayload): Promise<ChannelReply> {
    const runs = await this.service.listRunProjections({ limit: 10 })
    const text = runs.length === 0
      ? 'No runs found.'
      : runs.map(run => `${run.runId} ${run.status} cursor=${String(run.cursor)}`).join('\n')
    return slackReply(payload, text, 'sent')
  }

  private async decideApproval(
    payload: SlackSlashCommandPayload,
    granted: boolean,
    args: string,
  ): Promise<ChannelReply> {
    const [approvalId, ...reasonParts] = args.trim().split(/\s+/).filter(Boolean)
    if (!approvalId) {
      return slackReply(payload, `Usage: /telegraph ${granted ? 'approve' : 'deny'} <approvalId> [reason]`, 'skipped')
    }
    const decision = await this.service.decideApproval(approvalId, {
      granted,
      decidedBy: actorFromSlackSlashCommand(payload),
      reason: reasonParts.join(' ') || undefined,
    })
    if (!decision) return slackReply(payload, `Approval not found: ${approvalId}`, 'failed')
    return slackReply(payload, `Approval ${decision.status}: ${approvalId}`, 'sent')
  }
}

export function externalMessageFromSlackSlashCommand(
  payload: SlackSlashCommandPayload,
  text = payload.text ?? '',
): ExternalMessage {
  return {
    messageId: `slack-slash-${payload.team_id ?? 'team'}-${payload.channel_id}-${payload.trigger_id ?? Date.now().toString(36)}`,
    actor: actorFromSlackSlashCommand(payload),
    channel: {
      kind: 'slack',
      channelId: slackChannelId(payload.channel_id),
    },
    text,
    receivedAt: Date.now(),
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

export function externalMessageFromSlackEventCallback(
  payload: SlackEventCallbackPayload,
  text = payload.event.text ?? '',
): ExternalMessage {
  return {
    messageId: `slack-event-${payload.team_id ?? 'team'}-${payload.event.channel}-${payload.event.ts}`,
    actor: {
      actorId: payload.event.user ? `slack:${payload.event.user}` : 'slack:unknown',
      kind: 'slack',
      channelId: slackChannelId(payload.event.channel),
      workspaceId: payload.team_id,
    },
    channel: {
      kind: 'slack',
      channelId: slackChannelId(payload.event.channel),
      threadId: payload.event.thread_ts ?? payload.event.ts,
    },
    text,
    receivedAt: Number(payload.event.ts.split('.')[0]) * 1000 || Date.now(),
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

function actorFromSlackSlashCommand(payload: SlackSlashCommandPayload): RemoteActorSnapshot {
  return {
    actorId: `slack:${payload.user_id}`,
    kind: 'slack',
    displayName: payload.user_name,
    channelId: slackChannelId(payload.channel_id),
    workspaceId: payload.team_id,
  }
}

function actorFromSlackInteraction(payload: SlackInteractionPayload): RemoteActorSnapshot {
  return {
    actorId: `slack:${payload.user.id}`,
    kind: 'slack',
    displayName: payload.user.name ?? payload.user.username,
    channelId: payload.channel?.id ? slackChannelId(payload.channel.id) : undefined,
    workspaceId: payload.team?.id ?? payload.user.team_id,
  }
}

function slackReply(
  payload: SlackSlashCommandPayload,
  text: string,
  status: ChannelReply['status'],
): ChannelReply {
  return slackReplyFromChannel(slackChannelId(payload.channel_id), undefined, text, status)
}

function slackReplyFromChannel(
  channelId: string,
  threadId: string | undefined,
  text: string,
  status: ChannelReply['status'],
): ChannelReply {
  const now = Date.now()
  return {
    replyId: `slack-reply-${channelId}-${now.toString(36)}-${status}`,
    channelId,
    threadId,
    text,
    status,
    createdAt: now,
    updatedAt: now,
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

function slackChannelId(channelId: string): string {
  return `slack:${channelId}`
}

function parseSlackCommand(text: string): { name: string; args: string } {
  const trimmed = text.trim()
  const [first, ...rest] = trimmed.split(/\s+/).filter(Boolean)
  if (!first) return { name: 'ask', args: '' }
  const normalized = first.startsWith('/') ? first.slice(1) : first
  if (['ask', 'runs', 'approve', 'deny'].includes(normalized)) {
    return { name: normalized, args: rest.join(' ').trim() }
  }
  return { name: 'ask', args: trimmed }
}

function stripBotMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, '').replace(/\s+/g, ' ').trim()
}
