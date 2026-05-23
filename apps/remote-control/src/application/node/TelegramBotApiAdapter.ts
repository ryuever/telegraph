import type { ChannelReply, RemoteArtifactRef } from '@/packages/remote-protocol'
import type { TelegramCommandRouter, TelegramUpdate } from './TelegramCommandRouter'

export interface TelegramBotApiClientOptions {
  token: string
  apiBaseUrl?: string
  fetch?: typeof fetch
}

export interface TelegramBotApiResponse<T> {
  ok: boolean
  result?: T
  description?: string
}

export interface TelegramSentMessage {
  message_id: number
  chat?: {
    id: number | string
  }
}

export class TelegramBotApiClient {
  private readonly fetchImpl: typeof fetch
  private readonly endpointBase: string

  constructor(options: TelegramBotApiClientOptions) {
    if (!options.token) throw new Error('Telegram bot token is required.')
    this.fetchImpl = options.fetch ?? fetch
    this.endpointBase = `${(options.apiBaseUrl ?? 'https://api.telegram.org').replace(/\/$/, '')}/bot${options.token}`
  }

  async getUpdates(input: {
    offset?: number
    timeout?: number
    allowedUpdates?: string[]
    signal?: AbortSignal
  } = {}): Promise<TelegramUpdate[]> {
    const result = await this.request<TelegramUpdate[]>('getUpdates', {
      offset: input.offset,
      timeout: input.timeout,
      allowed_updates: input.allowedUpdates,
    }, input.signal)
    return Array.isArray(result) ? result : []
  }

  sendMessage(input: {
    chatId: string | number
    text: string
    messageThreadId?: number
  }): Promise<TelegramSentMessage> {
    return this.request<TelegramSentMessage>('sendMessage', {
      chat_id: input.chatId,
      message_thread_id: input.messageThreadId,
      text: input.text,
    })
  }

  sendPhoto(input: {
    chatId: string | number
    photo: string
    caption?: string
    messageThreadId?: number
  }): Promise<TelegramSentMessage> {
    return this.request<TelegramSentMessage>('sendPhoto', {
      chat_id: input.chatId,
      message_thread_id: input.messageThreadId,
      photo: input.photo,
      caption: input.caption,
    })
  }

  private async request<T>(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.endpointBase}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(pruneUndefined(params)),
      signal,
    })
    const body = await response.json() as TelegramBotApiResponse<T>
    if (!response.ok || !body.ok) {
      throw new Error(body.description ?? `Telegram Bot API ${method} failed with HTTP ${String(response.status)}.`)
    }
    return body.result as T
  }
}

export interface TelegramBotApiAdapterOptions {
  client: TelegramBotApiClient
  router: TelegramCommandRouter
  pollTimeoutSeconds?: number
  allowedUpdates?: string[]
  onReplyDelivered?: (reply: ChannelReply, sent: TelegramSentMessage) => void | Promise<void>
  onReplyDeliveryFailed?: (reply: ChannelReply, error: Error) => void | Promise<void>
  onError?: (error: Error) => void
}

export class TelegramBotApiAdapter {
  private abortController: AbortController | null = null
  private running: Promise<void> | null = null
  private offset: number | undefined

  constructor(private readonly options: TelegramBotApiAdapterOptions) {}

  start(): void {
    if (this.running) return
    this.abortController = new AbortController()
    this.running = this.pollLoop(this.abortController.signal)
      .finally(() => {
        this.running = null
        this.abortController = null
      })
  }

  async stop(): Promise<void> {
    this.abortController?.abort()
    await this.running
  }

  async handleUpdate(update: TelegramUpdate): Promise<ChannelReply[]> {
    const replies = await this.options.router.handleUpdate(update)
    for (const reply of replies) {
      await this.deliverReply(reply)
    }
    return replies
  }

  async deliverReply(reply: ChannelReply): Promise<void> {
    try {
      const sent = await this.sendReply(reply)
      await this.options.onReplyDelivered?.(reply, sent)
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error))
      await this.options.onReplyDeliveryFailed?.(reply, normalized)
      throw normalized
    }
  }

  private async pollLoop(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const updates = await this.options.client.getUpdates({
          offset: this.offset,
          timeout: this.options.pollTimeoutSeconds ?? 30,
          allowedUpdates: this.options.allowedUpdates ?? ['message'],
          signal,
        })
        for (const update of updates) {
          this.offset = update.update_id + 1
          await this.handleUpdate(update)
        }
      } catch (error) {
        if (isAbortError(error)) return
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)))
        await delay(1_000, signal)
      }
    }
  }

  private async sendReply(reply: ChannelReply): Promise<TelegramSentMessage> {
    const chatId = telegramChatIdFromChannelId(reply.channelId)
    const photo = selectTelegramPhoto(reply.artifactRefs)
    if (photo) {
      return this.options.client.sendPhoto({
        chatId,
        photo,
        caption: reply.text,
      })
    }
    return this.options.client.sendMessage({
      chatId,
      text: telegramText(reply),
    })
  }
}

function telegramChatIdFromChannelId(channelId: string): string | number {
  const value = channelId.startsWith('telegram:') ? channelId.slice('telegram:'.length) : channelId
  const numeric = Number(value)
  return Number.isSafeInteger(numeric) ? numeric : value
}

function selectTelegramPhoto(artifactRefs: RemoteArtifactRef[] | undefined): string | null {
  const ref = artifactRefs?.find(item =>
    typeof item.uri === 'string' &&
    /^https?:\/\//.test(item.uri) &&
    item.mediaType?.startsWith('image/'),
  )
  return ref?.uri ?? null
}

function telegramText(reply: ChannelReply): string {
  const refs = reply.artifactRefs?.length
    ? `\n\nArtifacts:\n${reply.artifactRefs.map(ref => `- ${ref.title ?? ref.artifactId}: ${ref.uri}`).join('\n')}`
    : ''
  return `${reply.text ?? ''}${refs}`.trim() || `Reply ${reply.status}.`
}

function pruneUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    if (signal.aborted) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(timer)
      resolve()
    }, { once: true })
  })
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
