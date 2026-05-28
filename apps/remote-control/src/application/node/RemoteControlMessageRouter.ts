import type { ChannelReply, ExternalChannelKind, ExternalMessage } from '@/packages/remote-protocol'
import { REMOTE_PROTOCOL_SCHEMA_VERSION } from '@/packages/remote-protocol'
import type { CreateRunIntentInput, RunIntentRecord, RunProjectionRecord } from '@/packages/run-protocol'
import type { RemoteControlSubmitOptions } from '@/apps/remote-control/application/common'

export function createRunIntentInputFromExternalMessage(
  message: ExternalMessage,
  options: RemoteControlSubmitOptions = {},
): CreateRunIntentInput {
  const prompt = externalPrompt(message)
  if (!prompt) throw new Error('External message has no text or command')
  const metadata: Record<string, unknown> = {
    externalMessageId: message.messageId,
    channelKind: message.channel.kind,
    channelId: message.channel.channelId,
    threadId: message.channel.threadId,
    artifactRefs: message.artifactRefs ?? [],
    rawRef: message.rawRef,
  }
  if (options.settings) metadata.settings = options.settings

  return {
    source: message.actor,
    targetPagelet: options.targetPagelet ?? 'design',
    prompt,
    sessionId: options.sessionId,
    metadata,
  }
}

export function queuedReplyForRunIntent(
  message: ExternalMessage,
  intent: RunIntentRecord,
  now = Date.now(),
): ChannelReply {
  return {
    replyId: `reply-${intent.intentId}`,
    channelId: message.channel.channelId,
    threadId: message.channel.threadId,
    runId: intent.runId,
    text: 'Run queued.',
    status: 'queued',
    createdAt: now,
    updatedAt: now,
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

export function externalMessageFromRunIntent(intent: RunIntentRecord): ExternalMessage | null {
  const channelId = stringMetadata(intent.metadata, 'channelId') ?? intent.source.channelId
  const channelKind = channelKindMetadata(intent.metadata, 'channelKind') ?? actorKindAsChannelKind(intent.source.kind)
  if (!channelId || !channelKind) return null

  return {
    messageId: stringMetadata(intent.metadata, 'externalMessageId') ?? `intent-${intent.intentId}`,
    actor: intent.source,
    channel: {
      kind: channelKind,
      channelId,
      threadId: stringMetadata(intent.metadata, 'threadId'),
    },
    text: intent.prompt,
    artifactRefs: Array.isArray(intent.metadata?.artifactRefs)
      ? intent.metadata.artifactRefs as ExternalMessage['artifactRefs']
      : undefined,
    rawRef: stringMetadata(intent.metadata, 'rawRef'),
    receivedAt: intent.createdAt,
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

export function replyForRunProjection(
  message: ExternalMessage,
  projection: RunProjectionRecord,
  now = Date.now(),
): ChannelReply {
  return {
    replyId: `reply-${projection.runId}-${String(projection.cursor)}`,
    channelId: message.channel.channelId,
    threadId: message.channel.threadId,
    runId: projection.runId,
    cursor: projection.cursor,
    text: replyTextForProjection(projection),
    artifactRefs: projection.artifactRefs,
    status: projection.status === 'failed' ? 'failed' : 'sent',
    createdAt: now,
    updatedAt: now,
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

function externalPrompt(message: ExternalMessage): string {
  const text = message.command ?? message.text ?? ''
  return text.replace(/\s+/g, ' ').trim()
}

function replyTextForProjection(projection: RunProjectionRecord): string {
  const assistantText = projectionAssistantText(projection)
  if (assistantText) return assistantText
  if (projection.status === 'completed') return 'Run completed.'
  if (projection.status === 'failed') return projection.error ? `Run failed: ${projection.error}` : 'Run failed.'
  if (projection.status === 'cancelled') return 'Run cancelled.'
  return `Run ${projection.status}.`
}

function projectionAssistantText(projection: RunProjectionRecord): string | undefined {
  const chat = projection.metadata?.chat
  if (!chat || typeof chat !== 'object' || Array.isArray(chat)) return undefined
  const record = chat as Record<string, unknown>
  const value = record.assistantText ?? record.assistantPreview
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  return text.length > 0 ? text : undefined
}

function stringMetadata(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key]
  return typeof value === 'string' ? value : undefined
}

function channelKindMetadata(
  metadata: Record<string, unknown> | undefined,
  key: string,
): ExternalChannelKind | undefined {
  const value = stringMetadata(metadata, key)
  return isExternalChannelKind(value) ? value : undefined
}

function actorKindAsChannelKind(kind: string): ExternalChannelKind | undefined {
  return isExternalChannelKind(kind) ? kind : undefined
}

function isExternalChannelKind(value: string | undefined): value is ExternalChannelKind {
  return value === 'cli' ||
    value === 'mobile' ||
    value === 'telegram' ||
    value === 'slack' ||
    value === 'mcp' ||
    value === 'webhook'
}
