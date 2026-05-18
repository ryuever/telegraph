import type {
  RuntimeSettings,
  RuntimeTaskCapabilityProfile,
} from '@/packages/agent-protocol'

export const AGENT_MODEL_SETTINGS_STORAGE_KEY = 'telegraph.agent.modelSettings'
export const LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY = 'telegraph.chat.modelSettings'

export interface DefaultRuntimeSettings extends RuntimeSettings {
  provider: string
  modelId: string
  apiKey: string
  backend: string
  orchestration: string
  orchestrationPattern: string
  worktreeIsolation: boolean
  extensionBlocklist: string[]
  taskCapabilityProfile: RuntimeTaskCapabilityProfile
}

export const DEFAULT_RUNTIME_SETTINGS: DefaultRuntimeSettings = {
  provider: 'minimax-cn',
  modelId: 'MiniMax-M2.7',
  apiKey: '',
  backend: 'pi-ai',
  orchestration: 'none',
  orchestrationPattern: 'chain',
  worktreeIsolation: false,
  extensionBlocklist: [],
  taskCapabilityProfile: { kind: 'default' },
}

export function readRuntimeSettingsFromStorage(storage: Pick<Storage, 'getItem'> = globalThis.localStorage): RuntimeSettings {
  const raw = storage.getItem(AGENT_MODEL_SETTINGS_STORAGE_KEY) ??
    storage.getItem(LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY)
  if (!raw) return { ...DEFAULT_RUNTIME_SETTINGS }

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return normalizeRuntimeSettings(parsed)
  } catch {
    return { ...DEFAULT_RUNTIME_SETTINGS }
  }
}

export function writeRuntimeSettingsToStorage(
  settings: RuntimeSettings,
  storage: Pick<Storage, 'setItem'> = globalThis.localStorage,
): void {
  const normalized = normalizeRuntimeSettings(settings as Record<string, unknown>)
  const value = JSON.stringify(normalized)
  storage.setItem(AGENT_MODEL_SETTINGS_STORAGE_KEY, value)
  storage.setItem(LEGACY_CHAT_MODEL_SETTINGS_STORAGE_KEY, value)
}

function normalizeRuntimeSettings(parsed: Record<string, unknown>): RuntimeSettings {
  const str = (value: unknown, fallback: string): string => typeof value === 'string' ? value : fallback
  const bool = (value: unknown, fallback: boolean): boolean => typeof value === 'boolean' ? value : fallback

  return {
    provider: str(parsed.provider, DEFAULT_RUNTIME_SETTINGS.provider),
    modelId: str(parsed.modelId, DEFAULT_RUNTIME_SETTINGS.modelId),
    apiKey: str(parsed.apiKey, DEFAULT_RUNTIME_SETTINGS.apiKey),
    baseUrl: typeof parsed.baseUrl === 'string' ? parsed.baseUrl : undefined,
    backend: str(parsed.backend, DEFAULT_RUNTIME_SETTINGS.backend),
    orchestration: str(parsed.orchestration, DEFAULT_RUNTIME_SETTINGS.orchestration),
    orchestrationPattern: str(parsed.orchestrationPattern, DEFAULT_RUNTIME_SETTINGS.orchestrationPattern),
    worktreeIsolation: bool(parsed.worktreeIsolation, DEFAULT_RUNTIME_SETTINGS.worktreeIsolation),
    extensionBlocklist: stringList(parsed.extensionBlocklist),
    taskCapabilityProfile: normalizeTaskCapabilityProfile(parsed.taskCapabilityProfile),
  }
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter(item => typeof item === 'string')
}

function normalizeTaskCapabilityProfile(value: unknown): RuntimeTaskCapabilityProfile {
  if (!value || typeof value !== 'object') return { ...DEFAULT_RUNTIME_SETTINGS.taskCapabilityProfile }
  const profile = value as Partial<RuntimeTaskCapabilityProfile>

  switch (profile.kind) {
    case 'readonly-workspace':
      return { kind: 'readonly-workspace', scopes: stringList(profile.scopes) }
    case 'shell-automation':
      return {
        kind: 'shell-automation',
        commands: stringList(profile.commands),
        cwdPolicy: profile.cwdPolicy === 'restricted' ? 'restricted' : 'workspace',
      }
    case 'coding-edit':
      return {
        kind: 'coding-edit',
        scopes: stringList(profile.scopes),
        patchPolicy: profile.patchPolicy === 'apply-after-confirm'
          ? 'apply-after-confirm'
          : 'preview',
      }
    case 'design-build':
      return {
        kind: 'design-build',
        scopes: stringList(profile.scopes),
        artifactPolicy: profile.artifactPolicy === 'apply-after-confirm'
          ? 'apply-after-confirm'
          : 'preview',
      }
    default:
      return { ...DEFAULT_RUNTIME_SETTINGS.taskCapabilityProfile }
  }
}
