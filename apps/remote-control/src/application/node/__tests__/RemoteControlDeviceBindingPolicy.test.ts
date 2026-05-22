import { describe, expect, it } from 'vitest'
import { REMOTE_PROTOCOL_SCHEMA_VERSION, type DeviceBinding, type ExternalMessage } from '@/packages/remote-protocol'
import { validateExternalMessageDeviceBinding } from '../RemoteControlDeviceBindingPolicy'

describe('RemoteControlDeviceBindingPolicy', () => {
  it('allows messages without a device when binding is not required', () => {
    expect(validateExternalMessageDeviceBinding(externalMessage({ deviceId: undefined }), [])).toBeNull()
  })

  it('requires a bound active device when requested by the adapter', () => {
    expect(() => validateExternalMessageDeviceBinding(
      externalMessage({ deviceId: undefined }),
      [],
      { requireDeviceBinding: true },
    )).toThrow('requires a bound deviceId')

    expect(() => validateExternalMessageDeviceBinding(
      externalMessage({ deviceId: 'phone-1' }),
      [],
      { requireDeviceBinding: true },
    )).toThrow('No active device binding for device "phone-1".')
  })

  it('accepts active bindings for the same actor and device', () => {
    const binding = deviceBinding({ deviceId: 'phone-1' })

    expect(validateExternalMessageDeviceBinding(
      externalMessage({ deviceId: 'phone-1' }),
      [binding],
      { requireDeviceBinding: true, now: 50 },
    )).toEqual(binding)
  })

  it('rejects mismatched, revoked, and expired device bindings', () => {
    expect(() => validateExternalMessageDeviceBinding(
      externalMessage({ deviceId: 'phone-1' }),
      [deviceBinding({ deviceId: 'phone-1', actorId: 'telegram:other' })],
    )).toThrow('bound to a different actor')

    expect(() => validateExternalMessageDeviceBinding(
      externalMessage({ deviceId: 'phone-1' }),
      [deviceBinding({ deviceId: 'phone-1', status: 'revoked' })],
    )).toThrow('is not active')

    expect(() => validateExternalMessageDeviceBinding(
      externalMessage({ deviceId: 'phone-1' }),
      [deviceBinding({ deviceId: 'phone-1', expiresAt: 40 })],
      { now: 50 },
    )).toThrow('is not active')
  })
})

function externalMessage(options: { deviceId?: string }): ExternalMessage {
  return {
    messageId: 'msg-1',
    actor: {
      actorId: 'telegram:ada',
      kind: 'telegram',
      deviceId: options.deviceId,
    },
    channel: {
      kind: 'telegram',
      channelId: 'telegram:chat',
    },
    text: 'build',
    receivedAt: 10,
    schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
  }
}

function deviceBinding(options: {
  deviceId: string
  actorId?: string
  status?: DeviceBinding['status']
  expiresAt?: number
}): DeviceBinding {
  return {
    bindingId: `binding-${options.deviceId}`,
    deviceId: options.deviceId,
    actor: {
      actorId: options.actorId ?? 'telegram:ada',
      kind: 'telegram',
    },
    status: options.status ?? 'active',
    expiresAt: options.expiresAt,
    createdAt: 10,
    updatedAt: 10,
  }
}
