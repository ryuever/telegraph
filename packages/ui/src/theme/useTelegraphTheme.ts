import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  getTelegraphThemePack,
  type TelegraphThemeId,
  type TelegraphThemePack,
} from '@/packages/ui/theme/theme-packs'
import {
  initializeTelegraphTheme,
  setTelegraphTheme,
  subscribeToTelegraphThemeChange,
} from '@/packages/ui/theme/theme-manager'

export interface UseTelegraphThemeResult {
  themeId: TelegraphThemeId
  themePack: TelegraphThemePack
  setThemeId: (themeId: TelegraphThemeId) => void
}

export function useTelegraphTheme(): UseTelegraphThemeResult {
  const [themeId, setThemeIdState] = useState<TelegraphThemeId>(() => initializeTelegraphTheme())

  useEffect(() => subscribeToTelegraphThemeChange(setThemeIdState), [])

  const setThemeId = useCallback((nextThemeId: TelegraphThemeId) => {
    setThemeIdState(setTelegraphTheme(nextThemeId))
  }, [])

  const themePack = useMemo(() => getTelegraphThemePack(themeId), [themeId])

  return { themeId, themePack, setThemeId }
}
