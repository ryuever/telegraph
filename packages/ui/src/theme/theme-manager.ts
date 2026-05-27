import {
  DEFAULT_TELEGRAPH_THEME_ID,
  TELEGRAPH_THEME_STORAGE_KEY,
  getTelegraphThemePack,
  normalizeTelegraphThemeId,
  type TelegraphThemeId,
} from '@/packages/ui/theme/theme-packs'

export const TELEGRAPH_THEME_CHANGE_EVENT = 'telegraph-theme-change'
const TELEGRAPH_THEME_BROADCAST_CHANNEL = 'telegraph-theme'
const TELEGRAPH_THEME_BROADCAST_TYPE = 'theme-change'

export interface TelegraphThemeChangeEventDetail {
  themeId: TelegraphThemeId
}

interface TelegraphThemeBroadcastMessage {
  type: typeof TELEGRAPH_THEME_BROADCAST_TYPE
  themeId: TelegraphThemeId
}

export function loadStoredTelegraphTheme(): TelegraphThemeId {
  const storage = getLocalStorage()
  if (!storage) return DEFAULT_TELEGRAPH_THEME_ID

  try {
    return normalizeTelegraphThemeId(storage.getItem(TELEGRAPH_THEME_STORAGE_KEY))
  } catch {
    return DEFAULT_TELEGRAPH_THEME_ID
  }
}

export function applyTelegraphTheme(value: string | null | undefined): TelegraphThemeId {
  const themeId = normalizeTelegraphThemeId(value)
  const themePack = getTelegraphThemePack(themeId)
  const root = getDocumentRoot()

  if (root) {
    root.dataset.telegraphTheme = themeId
    root.classList.toggle('dark', themePack.mode === 'dark')
    root.classList.toggle('light', themePack.mode === 'light')
    root.style.colorScheme = themePack.mode
  }

  return themeId
}

export function initializeTelegraphTheme(): TelegraphThemeId {
  return applyTelegraphTheme(loadStoredTelegraphTheme())
}

export function setTelegraphTheme(value: string): TelegraphThemeId {
  const themeId = applyTelegraphTheme(value)
  const storage = getLocalStorage()

  if (storage) {
    try {
      storage.setItem(TELEGRAPH_THEME_STORAGE_KEY, themeId)
    } catch {
      // Theme still applies for the current window when persistence is unavailable.
    }
  }

  dispatchThemeChange(themeId)
  broadcastThemeChange(themeId)
  return themeId
}

export function subscribeToTelegraphThemeChange(
  listener: (themeId: TelegraphThemeId) => void,
): () => void {
  if (typeof window === 'undefined') return () => {}

  const handleStorage = (event: StorageEvent): void => {
    if (event.key !== TELEGRAPH_THEME_STORAGE_KEY) return
    listener(applyTelegraphTheme(event.newValue))
  }

  const handleCustom = (event: Event): void => {
    const themeId = readThemeIdFromCustomEvent(event)
    if (themeId) listener(themeId)
  }

  const broadcastChannel = createThemeBroadcastChannel()
  const handleBroadcast = (event: MessageEvent<unknown>): void => {
    const themeId = readThemeIdFromBroadcastMessage(event.data)
    if (themeId) listener(applyTelegraphTheme(themeId))
  }

  window.addEventListener('storage', handleStorage)
  window.addEventListener(TELEGRAPH_THEME_CHANGE_EVENT, handleCustom)
  broadcastChannel?.addEventListener('message', handleBroadcast)

  return () => {
    window.removeEventListener('storage', handleStorage)
    window.removeEventListener(TELEGRAPH_THEME_CHANGE_EVENT, handleCustom)
    broadcastChannel?.removeEventListener('message', handleBroadcast)
    broadcastChannel?.close()
  }
}

function dispatchThemeChange(themeId: TelegraphThemeId): void {
  if (typeof window === 'undefined') return

  window.dispatchEvent(
    new CustomEvent<TelegraphThemeChangeEventDetail>(TELEGRAPH_THEME_CHANGE_EVENT, {
      detail: { themeId },
    }),
  )
}

function broadcastThemeChange(themeId: TelegraphThemeId): void {
  const broadcastChannel = createThemeBroadcastChannel()
  if (!broadcastChannel) return

  try {
    broadcastChannel.postMessage({
      type: TELEGRAPH_THEME_BROADCAST_TYPE,
      themeId,
    } satisfies TelegraphThemeBroadcastMessage)
  } finally {
    broadcastChannel.close()
  }
}

function readThemeIdFromCustomEvent(event: Event): TelegraphThemeId | null {
  if (!(event instanceof CustomEvent)) return null
  const detail = event.detail as unknown
  if (!isRecord(detail)) return null

  const themeId = detail.themeId
  return typeof themeId === 'string' ? normalizeTelegraphThemeId(themeId) : null
}

function readThemeIdFromBroadcastMessage(value: unknown): TelegraphThemeId | null {
  if (!isRecord(value)) return null
  if (value.type !== TELEGRAPH_THEME_BROADCAST_TYPE) return null

  const themeId = value.themeId
  return typeof themeId === 'string' ? normalizeTelegraphThemeId(themeId) : null
}

function getDocumentRoot(): HTMLElement | null {
  if (typeof document === 'undefined') return null
  return document.documentElement
}

function getLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function createThemeBroadcastChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null
  try {
    return new BroadcastChannel(TELEGRAPH_THEME_BROADCAST_CHANNEL)
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
