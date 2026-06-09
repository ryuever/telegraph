import type {
  RuntimeSettings,
  RuntimeTaskCapabilityProfile,
} from '@/packages/agent-protocol'
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

export const DEFAULT_DESIGN_THEME_PACK_ID = 'shadcn-new-york-neutral'
const DEFAULT_DESIGN_RUNTIME_SETTINGS: RuntimeSettings = {
  provider: 'zai',
  modelId: 'glm-5.1',
  apiKey: '',
  authMode: 'api-key',
  backend: TELEGRAPH_DESIGN_BUILD_RUNTIME_ID,
  orchestration: 'none',
  orchestrationPattern: 'chain',
  worktreeIsolation: false,
  extensionBlocklist: [],
  taskCapabilityProfile: defaultDesignProfile('design-build'),
}

export function loadDesignRuntimeSettings(): DesignRuntimeSettings {
  return normalizeDesignRuntimeSettings({
    ...DEFAULT_DESIGN_RUNTIME_SETTINGS,
    designSystem: { themePackId: DEFAULT_DESIGN_THEME_PACK_ID },
  }, {
    forceDesignProfile: true,
  })
}

export function saveDesignRuntimeSettings(
  _settings: DesignRuntimeSettings,
): void {
  // Runtime settings are persisted by the design pagelet into project config.
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

export function selectDesignRuntimeModel(
  settings: DesignRuntimeSettings,
  provider: string,
  modelId: string,
): DesignRuntimeSettings {
  return normalizeDesignRuntimeSettings({
    ...settings,
    provider,
    modelId,
    apiKey: '',
    authMode: 'api-key',
    subscriptionProvider: undefined,
    subscriptionCredentials: undefined,
    baseUrl: undefined,
  })
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
