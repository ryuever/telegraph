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
import {
  BUILTIN_THEME_PACKS,
  getBuiltinThemePack,
} from '@/apps/design/application/common/theme-pack-contract'

export interface DesignRuntimeSettings extends RuntimeSettings {
  designSystem?: {
    themePackId?: string
  }
}

export const DESIGN_RUNTIME_SETTINGS_STORAGE_KEY = 'telegraph.design.runtimeSettings'
export const DEFAULT_DESIGN_THEME_PACK_ID = 'shadcn-new-york-neutral'

export function loadDesignRuntimeSettings(
  storage: Pick<Storage, 'getItem'> = globalThis.localStorage,
): DesignRuntimeSettings {
  return normalizeDesignRuntimeSettings({
    ...readRuntimeSettingsFromStorage(storage),
    designSystem: readDesignSettingsFromStorage(storage),
  }, {
    forceDesignProfile: !hasSavedRuntimeSettings(storage),
  })
}

export function saveDesignRuntimeSettings(
  settings: DesignRuntimeSettings,
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage,
): void {
  const normalized = normalizeDesignRuntimeSettings(settings)
  writeRuntimeSettingsToStorage(normalized, storage)
  storage.setItem(DESIGN_RUNTIME_SETTINGS_STORAGE_KEY, JSON.stringify({
    themePackId: normalized.designSystem?.themePackId ?? DEFAULT_DESIGN_THEME_PACK_ID,
  }))
}

export function normalizeDesignRuntimeSettings(
  settings: DesignRuntimeSettings,
  options: { forceDesignProfile?: boolean } = {},
): DesignRuntimeSettings {
  return {
    ...settings,
    backend: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
    orchestration: 'none',
    taskCapabilityProfile: options.forceDesignProfile
      ? defaultDesignProfile('design-build')
      : settings.taskCapabilityProfile ?? defaultDesignProfile('design-build'),
    designSystem: {
      themePackId: normalizeThemePackId(settings.designSystem?.themePackId),
    },
  }
}

export function designSystemContextFromSettings(settings: DesignRuntimeSettings): Record<string, unknown> {
  const themePackId = normalizeThemePackId(settings.designSystem?.themePackId)
  const themePack = getBuiltinThemePack(themePackId)
  return {
    id: 'shadcn-first-standalone',
    themePackId,
    themePack: themePack
      ? {
          id: themePack.id,
          label: themePack.label,
          source: 'built-in',
        }
      : undefined,
  }
}

function hasSavedRuntimeSettings(storage: Pick<Storage, 'getItem'>): boolean {
  return storage.getItem(AGENT_MODEL_SETTINGS_STORAGE_KEY) !== null ||
    storage.getItem(LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY) !== null
}

function readDesignSettingsFromStorage(storage: Pick<Storage, 'getItem'>): DesignRuntimeSettings['designSystem'] {
  const raw = storage.getItem(DESIGN_RUNTIME_SETTINGS_STORAGE_KEY)
  if (!raw) return { themePackId: DEFAULT_DESIGN_THEME_PACK_ID }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      themePackId: normalizeThemePackId(typeof parsed.themePackId === 'string' ? parsed.themePackId : undefined),
    }
  } catch {
    return { themePackId: DEFAULT_DESIGN_THEME_PACK_ID }
  }
}

function normalizeThemePackId(value: string | undefined): string {
  if (value && BUILTIN_THEME_PACKS.some(pack => pack.id === value)) return value
  return DEFAULT_DESIGN_THEME_PACK_ID
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
