import type { ChannelReply, ExternalMessage, RemoteActorSnapshot } from '@/packages/remote-protocol'
import { REMOTE_PROTOCOL_SCHEMA_VERSION } from '@/packages/remote-protocol'
import type { ApprovalRequestRecord, ListRunProjectionsOptions, RunProjectionRecord } from '@/packages/run-protocol'
import type { RemoteControlSubmissionResult, RemoteControlSubmitOptions } from '@/apps/remote-control/application/common'
import type { SlackGovernanceAction } from '@/apps/remote-control/application/common'
import type { SlackTeamGovernance } from './SlackTeamGovernance'

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
  governance?: SlackTeamGovernance
}

export class SlackCommandRouter {
  private readonly defaultTargetPagelet: string
  private readonly governance?: SlackTeamGovernance

  constructor(
    private readonly service: SlackCommandRouterService,
    options: SlackCommandRouterOptions = {},
  ) {
    this.defaultTargetPagelet = options.defaultTargetPagelet ?? 'design'
    this.governance = options.governance
  }

  async handleSlashCommand(payload: SlackSlashCommandPayload): Promise<ChannelReply> {
    const command = parseSlackCommand(payload.text ?? '')
    const action = slackActionForCommand(command.name)
    const authorization = this.authorizeSlashCommand(payload, action)
    if (authorization) return authorization

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
    this.recordSlashAudit(payload, 'ask', 'accepted', { policyProfileId: this.policyProfileForSlash(payload, 'ask') })
    return result.reply
  }

  async handleEventCallback(payload: SlackEventCallbackPayload): Promise<ChannelReply[]> {
    if (payload.event.type !== 'app_mention') return []
    const text = stripBotMention(payload.event.text ?? '')
    if (!text) return []
    const authorization = this.authorizeEventCallback(payload, 'ask')
    if (authorization) return [authorization]

    const result = await this.service.submitExternalMessage(
      externalMessageFromSlackEventCallback(payload, text),
      { targetPagelet: this.defaultTargetPagelet },
    )
    this.recordEventAudit(payload, 'ask', 'accepted', { policyProfileId: this.policyProfileForEvent(payload, 'ask') })
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

    const governanceAction = granted ? 'block_approve' : 'block_deny'
    const authorization = this.authorizeInteraction(payload, governanceAction, action.value)
    if (authorization) return [authorization]

    const decision = await this.service.decideApproval(action.value, {
      granted,
      decidedBy: actorFromSlackInteraction(payload),
      reason: `Slack action ${action.action_id}`,
    })
    const channelId = payload.channel?.id ? slackChannelId(payload.channel.id) : 'slack:unknown'
    const threadId = payload.message?.thread_ts ?? payload.message?.ts
    if (!decision) {
      this.recordInteractionAudit(payload, governanceAction, 'rejected', {
        approvalId: action.value,
        reason: `Approval not found: ${action.value}`,
      })
      return [slackReplyFromChannel(channelId, threadId, `Approval not found: ${action.value}`, 'failed')]
    }
    this.recordInteractionAudit(payload, governanceAction, 'accepted', {
      approvalId: action.value,
      policyProfileId: this.policyProfileForInteraction(payload, governanceAction),
    })
    return [slackReplyFromChannel(channelId, threadId, `Approval ${decision.status}: ${action.value}`, 'sent')]
  }

  private async listRuns(payload: SlackSlashCommandPayload): Promise<ChannelReply> {
    const runs = await this.service.listRunProjections({ limit: 10 })
    const text = runs.length === 0
      ? 'No runs found.'
      : runs.map(run => `${run.runId} ${run.status} cursor=${String(run.cursor)}`).join('\n')
    this.recordSlashAudit(payload, 'runs', 'accepted', { policyProfileId: this.policyProfileForSlash(payload, 'runs') })
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
    if (!decision) {
      this.recordSlashAudit(payload, granted ? 'approve' : 'deny', 'rejected', {
        approvalId,
        reason: `Approval not found: ${approvalId}`,
      })
      return slackReply(payload, `Approval not found: ${approvalId}`, 'failed')
    }
    this.recordSlashAudit(payload, granted ? 'approve' : 'deny', 'accepted', {
      approvalId,
      policyProfileId: this.policyProfileForSlash(payload, granted ? 'approve' : 'deny'),
    })
    return slackReply(payload, `Approval ${decision.status}: ${approvalId}`, 'sent')
  }

  private authorizeSlashCommand(
    payload: SlackSlashCommandPayload,
    action: SlackGovernanceAction,
  ): ChannelReply | null {
    if (!this.governance) return null
    const decision = this.governance.authorize({
      workspaceId: payload.team_id,
      actorId: `slack:${payload.user_id}`,
      userId: payload.user_id,
      channelId: slackChannelId(payload.channel_id),
      action,
    })
    if (decision.allowed) return null
    this.recordSlashAudit(payload, action, 'rejected', { reason: decision.reason })
    return slackReply(payload, decision.reason ?? 'Slack command is not allowed.', 'failed')
  }

  private authorizeEventCallback(
    payload: SlackEventCallbackPayload,
    action: SlackGovernanceAction,
  ): ChannelReply | null {
    if (!this.governance) return null
    const decision = this.governance.authorize({
      workspaceId: payload.team_id,
      actorId: payload.event.user ? `slack:${payload.event.user}` : 'slack:unknown',
      userId: payload.event.user,
      channelId: slackChannelId(payload.event.channel),
      threadId: payload.event.thread_ts ?? payload.event.ts,
      action,
    })
    if (decision.allowed) return null
    this.recordEventAudit(payload, action, 'rejected', { reason: decision.reason })
    return slackReplyFromChannel(
      slackChannelId(payload.event.channel),
      payload.event.thread_ts ?? payload.event.ts,
      decision.reason ?? 'Slack event is not allowed.',
      'failed',
    )
  }

  private authorizeInteraction(
    payload: SlackInteractionPayload,
    action: SlackGovernanceAction,
    approvalId: string,
  ): ChannelReply | null {
    if (!this.governance) return null
    const channelId = payload.channel?.id ? slackChannelId(payload.channel.id) : 'slack:unknown'
    const threadId = payload.message?.thread_ts ?? payload.message?.ts
    const decision = this.governance.authorize({
      workspaceId: payload.team?.id ?? payload.user.team_id,
      actorId: `slack:${payload.user.id}`,
      userId: payload.user.id,
      channelId,
      threadId,
      action,
    })
    if (decision.allowed) return null
    this.recordInteractionAudit(payload, action, 'rejected', { approvalId, reason: decision.reason })
    return slackReplyFromChannel(channelId, threadId, decision.reason ?? 'Slack interaction is not allowed.', 'failed')
  }

  private policyProfileForSlash(
    payload: SlackSlashCommandPayload,
    action: SlackGovernanceAction,
  ): string | undefined {
    return this.governance?.authorize({
      workspaceId: payload.team_id,
      actorId: `slack:${payload.user_id}`,
      userId: payload.user_id,
      channelId: slackChannelId(payload.channel_id),
      action,
    }).policyProfileId
  }

  private policyProfileForEvent(
    payload: SlackEventCallbackPayload,
    action: SlackGovernanceAction,
  ): string | undefined {
    return this.governance?.authorize({
      workspaceId: payload.team_id,
      actorId: payload.event.user ? `slack:${payload.event.user}` : 'slack:unknown',
      userId: payload.event.user,
      channelId: slackChannelId(payload.event.channel),
      threadId: payload.event.thread_ts ?? payload.event.ts,
      action,
    }).policyProfileId
  }

  private policyProfileForInteraction(
    payload: SlackInteractionPayload,
    action: SlackGovernanceAction,
  ): string | undefined {
    return this.governance?.authorize({
      workspaceId: payload.team?.id ?? payload.user.team_id,
      actorId: `slack:${payload.user.id}`,
      userId: payload.user.id,
      channelId: payload.channel?.id ? slackChannelId(payload.channel.id) : undefined,
      threadId: payload.message?.thread_ts ?? payload.message?.ts,
      action,
    }).policyProfileId
  }

  private recordSlashAudit(
    payload: SlackSlashCommandPayload,
    action: SlackGovernanceAction,
    status: 'accepted' | 'rejected',
    extra: { approvalId?: string; policyProfileId?: string; reason?: string } = {},
  ): void {
    this.governance?.recordAuditEvent({
      action,
      status,
      workspaceId: payload.team_id,
      actorId: `slack:${payload.user_id}`,
      channelId: slackChannelId(payload.channel_id),
      approvalId: extra.approvalId,
      policyProfileId: extra.policyProfileId,
      reason: extra.reason,
    })
  }

  private recordEventAudit(
    payload: SlackEventCallbackPayload,
    action: SlackGovernanceAction,
    status: 'accepted' | 'rejected',
    extra: { policyProfileId?: string; reason?: string } = {},
  ): void {
    this.governance?.recordAuditEvent({
      action,
      status,
      workspaceId: payload.team_id,
      actorId: payload.event.user ? `slack:${payload.event.user}` : 'slack:unknown',
      channelId: slackChannelId(payload.event.channel),
      threadId: payload.event.thread_ts ?? payload.event.ts,
      policyProfileId: extra.policyProfileId,
      reason: extra.reason,
    })
  }

  private recordInteractionAudit(
    payload: SlackInteractionPayload,
    action: SlackGovernanceAction,
    status: 'accepted' | 'rejected',
    extra: { approvalId?: string; policyProfileId?: string; reason?: string } = {},
  ): void {
    this.governance?.recordAuditEvent({
      action,
      status,
      workspaceId: payload.team?.id ?? payload.user.team_id,
      actorId: `slack:${payload.user.id}`,
      channelId: payload.channel?.id ? slackChannelId(payload.channel.id) : undefined,
      threadId: payload.message?.thread_ts ?? payload.message?.ts,
      approvalId: extra.approvalId,
      policyProfileId: extra.policyProfileId,
      reason: extra.reason,
    })
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

function slackActionForCommand(command: string): SlackGovernanceAction {
  if (command === 'runs') return 'runs'
  if (command === 'approve') return 'approve'
  if (command === 'deny') return 'deny'
  return 'ask'
}

function stripBotMention(text: string): string {
  return text.replace(/<@[A-Z0-9]+>/g, '').replace(/\s+/g, ' ').trim()
}
