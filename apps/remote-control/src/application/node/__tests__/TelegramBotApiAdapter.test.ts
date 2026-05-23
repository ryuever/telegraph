import { describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ChannelReply } from '@/packages/remote-protocol'
import {
  TelegramBotApiAdapter,
  TelegramBotApiClient,
  type TelegramSentMessage,
} from '../TelegramBotApiAdapter'
import type { TelegramCommandRouter } from '../TelegramCommandRouter'

describe('TelegramBotApiClient', () => {
  it('calls getUpdates and confirms offset through the Bot API', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const client = new TelegramBotApiClient({
      token: 'token',
      apiBaseUrl: 'https://telegram.test',
      fetch: fakeFetch(calls, {
        ok: true,
        result: [{
          update_id: 42,
          message: {
            message_id: 7,
            chat: { id: 123, type: 'private' },
            text: '/runs',
          },
        }],
      }),
    })

    await expect(client.getUpdates({
      offset: 41,
      timeout: 10,
      allowedUpdates: ['message'],
    })).resolves.toEqual([expect.objectContaining({ update_id: 42 })])
    expect(calls).toEqual([{
      url: 'https://telegram.test/bottoken/getUpdates',
      body: {
        offset: 41,
        timeout: 10,
        allowed_updates: ['message'],
      },
    }])
  })

  it('throws Bot API descriptions for failed calls', async () => {
    const client = new TelegramBotApiClient({
      token: 'token',
      fetch: fakeFetch([], {
        ok: false,
        description: 'Bad token',
      }),
    })

    await expect(client.sendMessage({ chatId: 1, text: 'hello' })).rejects.toThrow('Bad token')
  })
})

describe('TelegramBotApiAdapter', () => {
  it('routes updates and delivers text replies through sendMessage', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const client = new TelegramBotApiClient({
      token: 'token',
      apiBaseUrl: 'https://telegram.test',
      fetch: fakeFetch(calls, {
        ok: true,
        result: { message_id: 99 },
      }),
    })
    const delivered: Array<{ reply: ChannelReply; sent: TelegramSentMessage }> = []
    const adapter = new TelegramBotApiAdapter({
      client,
      router: fakeRouter([reply({ text: 'Run queued.' })]),
      onReplyDelivered: (reply, sent) => {
        delivered.push({ reply, sent })
      },
    })

    await expect(adapter.handleUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 123, type: 'private' },
        text: '/ask build',
      },
    })).resolves.toHaveLength(1)

    expect(calls).toEqual([{
      url: 'https://telegram.test/bottoken/sendMessage',
      body: {
        chat_id: 123,
        text: 'Run queued.',
      },
    }])
    expect(delivered).toHaveLength(1)
    expect(delivered[0]?.reply).toMatchObject({ replyId: 'reply-1' })
    expect(delivered[0]?.sent).toEqual({ message_id: 99 })
  })

  it('uses sendPhoto for HTTP image artifact refs', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const client = new TelegramBotApiClient({
      token: 'token',
      apiBaseUrl: 'https://telegram.test',
      fetch: fakeFetch(calls, {
        ok: true,
        result: { message_id: 100 },
      }),
    })
    const adapter = new TelegramBotApiAdapter({
      client,
      router: fakeRouter([
        reply({
          text: 'Screenshot artifact.',
          artifactRefs: [{
            artifactId: 'artifact-1',
            uri: 'https://example.test/screen.png',
            mediaType: 'image/png',
          }],
        }),
      ]),
    })

    await adapter.handleUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 123, type: 'private' },
        text: '/screen',
      },
    })

    expect(calls).toEqual([{
      url: 'https://telegram.test/bottoken/sendPhoto',
      body: {
        chat_id: 123,
        photo: 'https://example.test/screen.png',
        caption: 'Screenshot artifact.',
      },
    }])
  })

  it('falls back to text when artifacts are local-only refs', async () => {
    const calls: Array<{ url: string; body: unknown }> = []
    const client = new TelegramBotApiClient({
      token: 'token',
      apiBaseUrl: 'https://telegram.test',
      fetch: fakeFetch(calls, {
        ok: true,
        result: { message_id: 101 },
      }),
    })
    const adapter = new TelegramBotApiAdapter({
      client,
      router: fakeRouter([
        reply({
          text: 'Screenshot artifact.',
          artifactRefs: [{
            artifactId: 'artifact-local',
            uri: 'telegraph://computer-use-artifacts/artifact-local',
            mediaType: 'image/png',
            title: 'Local screenshot',
          }],
        }),
      ]),
    })

    await adapter.handleUpdate({
      update_id: 1,
      message: {
        message_id: 10,
        chat: { id: 123, type: 'private' },
        text: '/screen',
      },
    })

    expect(calls[0]).toEqual({
      url: 'https://telegram.test/bottoken/sendMessage',
      body: {
        chat_id: 123,
        text: 'Screenshot artifact.\n\nArtifacts:\n- Local screenshot: telegraph://computer-use-artifacts/artifact-local',
      },
    })
  })
})

function fakeRouter(replies: ChannelReply[]): TelegramCommandRouter {
  return {
    handleUpdate: () => Promise.resolve(replies),
  } as unknown as TelegramCommandRouter
}

function reply(input: Partial<ChannelReply> = {}): ChannelReply {
  return {
    replyId: 'reply-1',
    channelId: 'telegram:123',
    text: input.text,
    artifactRefs: input.artifactRefs,
    status: 'sent',
    createdAt: 10,
    updatedAt: 10,
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

function fakeFetch(
  calls: Array<{ url: string; body: unknown }>,
  body: unknown,
): typeof fetch {
  const fetchMock: typeof fetch = (url, init) => {
    const rawBody = init?.body
    calls.push({
      url: requestUrl(url),
      body: typeof rawBody === 'string' ? JSON.parse(rawBody) as unknown : undefined,
    })
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(body),
    } as Response)
  }
  return fetchMock
}

function requestUrl(url: string | URL | Request): string {
  if (typeof url === 'string') return url
  if (url instanceof URL) return url.toString()
  return url.url
}
