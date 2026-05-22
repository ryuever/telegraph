import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ChannelReplyDeliveryStatus, RemoteActorSnapshot } from '@/packages/remote-protocol'

export interface ChannelReplyDeliveryRecord {
  replyId: string
  status: ChannelReplyDeliveryStatus
  attempts: number
  updatedAt: number
  deliveredAt?: number
  deliveredBy?: RemoteActorSnapshot
  error?: string
}

export class RemoteControlReplyDeliveryRepository {
  private readonly filePath: string

  constructor(dataDir = join(process.cwd(), '.telegraph', 'remote-control')) {
    this.filePath = join(dataDir, 'reply-delivery.json')
  }

  async load(): Promise<ChannelReplyDeliveryRecord[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isChannelReplyDeliveryRecord)
    } catch (error) {
      if (isNotFound(error)) return []
      throw error
    }
  }

  async save(records: ChannelReplyDeliveryRecord[]): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true })
    const tempPath = `${this.filePath}.tmp`
    await writeFile(tempPath, `${JSON.stringify(records, null, 2)}\n`, 'utf8')
    await rename(tempPath, this.filePath)
  }
}

function isChannelReplyDeliveryRecord(value: unknown): value is ChannelReplyDeliveryRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Partial<ChannelReplyDeliveryRecord>
  return typeof record.replyId === 'string' &&
    isDeliveryStatus(record.status) &&
    typeof record.attempts === 'number' &&
    typeof record.updatedAt === 'number'
}

function isDeliveryStatus(value: unknown): value is ChannelReplyDeliveryStatus {
  return value === 'pending' || value === 'sent' || value === 'failed' || value === 'skipped'
}

function isNotFound(error: unknown): boolean {
  return !!error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
}
