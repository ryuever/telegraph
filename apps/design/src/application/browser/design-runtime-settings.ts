import type {
  RuntimeSettings,
  RuntimeTaskCapabilityProfile,
} from '@/packages/agent-protocol'
import {
  readRuntimeSettingsFromStorage,
  writeRuntimeSettingsToStorage,
} from '@/packages/agent/browser/runtime-settings-storage'

export type DesignRuntimeSettings = RuntimeSettings

export function loadDesignRuntimeSettings(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage,
): DesignRuntimeSettings {
  return readRuntimeSettingsFromStorage(storage)
}

export function saveDesignRuntimeSettings(
  settings: DesignRuntimeSettings,
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage,
): void {
  writeRuntimeSettingsToStorage(settings, storage)
}

export function defaultDesignProfile(kind: RuntimeTaskCapabilityProfile['kind']): RuntimeTaskCapabilityProfile {
  switch (kind) {
    case 'readonly-workspace':
      return { kind, scopes: ['repo:read'] }
    case 'shell-automation':
      return { kind, commands: [], cwdPolicy: 'workspace' }
    case 'coding-edit':
      return { kind, scopes: ['repo:read', 'repo:write'], patchPolicy: 'preview' }
    case 'design-build':
      return { kind, scopes: ['artifact:write', 'repo:read'], artifactPolicy: 'preview' }
    default:
      return { kind: 'default' }
  }
}

export function splitSettingList(raw: string): string[] {
  return raw
    .split(/[,\n]+/)
    .map(value => value.trim())
    .filter(Boolean)
}
