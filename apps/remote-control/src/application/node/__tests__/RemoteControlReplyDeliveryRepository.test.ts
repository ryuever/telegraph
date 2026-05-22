import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RemoteControlReplyDeliveryRepository } from '../RemoteControlReplyDeliveryRepository'

const cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('RemoteControlReplyDeliveryRepository', () => {
  it('persists reply delivery ack state', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-reply-delivery-'))
    cleanupDirs.push(dir)
    const repository = new RemoteControlReplyDeliveryRepository(dir)

    await repository.save([{
      replyId: 'reply-1',
      status: 'sent',
      attempts: 1,
      updatedAt: 20,
      deliveredAt: 20,
    }])

    await expect(repository.load()).resolves.toEqual([{
      replyId: 'reply-1',
      status: 'sent',
      attempts: 1,
      updatedAt: 20,
      deliveredAt: 20,
    }])
  })
})
