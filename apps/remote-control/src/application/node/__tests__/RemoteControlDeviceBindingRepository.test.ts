import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { DeviceBinding } from '@/packages/remote-protocol'
import { RemoteControlDeviceBindingRepository } from '../RemoteControlDeviceBindingRepository'

const cleanupDirs: string[] = []

afterEach(() => {
  for (const dir of cleanupDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('RemoteControlDeviceBindingRepository', () => {
  it('persists device bindings across repository instances', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-device-bindings-test-'))
    cleanupDirs.push(dir)
    const binding = deviceBinding()

    await new RemoteControlDeviceBindingRepository(dir).save([binding])

    await expect(new RemoteControlDeviceBindingRepository(dir).load()).resolves.toEqual([binding])
  })

  it('ignores malformed persisted rows', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'telegraph-device-bindings-test-'))
    cleanupDirs.push(dir)
    writeFileSync(join(dir, 'device-bindings.json'), JSON.stringify([
      deviceBinding(),
      { bindingId: 'bad' },
    ]))

    await expect(new RemoteControlDeviceBindingRepository(dir).load()).resolves.toEqual([deviceBinding()])
  })
})

function deviceBinding(): DeviceBinding {
  return {
    bindingId: 'binding-1',
    deviceId: 'phone-1',
    actor: {
      actorId: 'telegram:ada',
      kind: 'telegram',
      displayName: 'Ada',
    },
    label: 'Ada phone',
    status: 'active',
    createdAt: 10,
    updatedAt: 20,
  }
}
