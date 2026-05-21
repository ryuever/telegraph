import type {
  RuntimeSettings,
  RuntimeTaskCapabilityProfile,
} from '@/packages/agent-protocol'
import {
  AGENT_MODEL_SETTINGS_STORAGE_KEY,
  LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY,
  readRuntimeSettingsFromStorage,
  writeRuntimeSettingsToStorage,
} from '@/packages/agent/browser/runtime-settings-storage'
import { TELEGRAPH_DESIGN_BUILD_RUNTIME_ID } from '@/apps/design/application/common/design-build'

export type DesignRuntimeSettings = RuntimeSettings

export function loadDesignRuntimeSettings(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage,
): DesignRuntimeSettings {
  const hasSavedSettings = storage.getItem(AGENT_MODEL_SETTINGS_STORAGE_KEY) !== null ||
    storage.getItem(LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY) !== null
  if (!hasSavedSettings) {
    return {
      ...readRuntimeSettingsFromStorage(storage),
      backend: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
      taskCapabilityProfile: defaultDesignProfile('design-build'),
    }
  }
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
