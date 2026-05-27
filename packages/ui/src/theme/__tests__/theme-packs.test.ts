import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TELEGRAPH_THEME_ID,
  TELEGRAPH_THEME_PACKS,
  getTelegraphThemePack,
  normalizeTelegraphThemeId,
} from '@/packages/ui/theme/theme-packs'

describe('Telegraph theme packs', () => {
  it('includes the standard application theme presets', () => {
    expect(TELEGRAPH_THEME_PACKS.map(pack => pack.id)).toEqual([
      'telegraph-dark-pro',
      'tweakcn-modern',
      'graphite-light-console',
      'shadcn-neutral',
      'catppuccin-mocha',
      'nord-frost',
      'frosted-command',
      'neo-brutalist-lab',
    ])
  })

  it('normalizes unknown theme ids to the default theme', () => {
    expect(normalizeTelegraphThemeId('missing-theme')).toBe(DEFAULT_TELEGRAPH_THEME_ID)
    expect(getTelegraphThemePack('missing-theme').id).toBe(DEFAULT_TELEGRAPH_THEME_ID)
  })

  it('keeps the TweakCN-inspired theme available as a first-class preset', () => {
    expect(getTelegraphThemePack('tweakcn-modern')).toMatchObject({
      id: 'tweakcn-modern',
      label: 'TweakCN Modern',
      mode: 'light',
      source: 'TweakCN inspired',
    })
  })
})
