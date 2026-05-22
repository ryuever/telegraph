import type { DeviceBinding, ExternalMessage } from '@/packages/remote-protocol'

export interface DeviceBindingValidationOptions {
  requireDeviceBinding?: boolean
  now?: number
}

export function validateExternalMessageDeviceBinding(
  message: ExternalMessage,
  bindings: DeviceBinding[],
  options: DeviceBindingValidationOptions = {},
): DeviceBinding | null {
  const deviceId = message.actor.deviceId
  if (!deviceId) {
    if (options.requireDeviceBinding) {
      throw new Error('External message requires a bound deviceId.')
    }
    return null
  }

  const deviceBindings = bindings.filter(binding => binding.deviceId === deviceId)
  if (deviceBindings.length === 0) {
    if (options.requireDeviceBinding) {
      throw new Error(`No active device binding for device "${deviceId}".`)
    }
    return null
  }

  const actorMatched = deviceBindings.filter(binding => actorMatches(message, binding))
  if (actorMatched.length === 0) {
    throw new Error(`Device "${deviceId}" is bound to a different actor.`)
  }

  const now = options.now ?? Date.now()
  const active = actorMatched.find(binding => binding.status === 'active' && !isExpired(binding, now))
  if (active) return active

  throw new Error(`Device binding for device "${deviceId}" is not active.`)
}

function actorMatches(message: ExternalMessage, binding: DeviceBinding): boolean {
  return binding.actor.actorId === message.actor.actorId &&
    binding.actor.kind === message.actor.kind
}

function isExpired(binding: DeviceBinding, now: number): boolean {
  return binding.expiresAt !== undefined && binding.expiresAt <= now
}
