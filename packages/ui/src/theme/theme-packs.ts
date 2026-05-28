export type TelegraphThemeMode = 'light' | 'dark'

interface TelegraphThemePackDefinition {
  id: string
  label: string
  description: string
  mode: TelegraphThemeMode
  source: string
  swatches: readonly string[]
  window: {
    backgroundColor: string
    accentColor: string
  }
}

export const TELEGRAPH_THEME_STORAGE_KEY = 'telegraph.theme.id'

export const TELEGRAPH_THEME_PACKS = [
  {
    id: 'telegraph-dark-pro',
    label: 'Telegraph Dark Pro',
    description: 'Deep studio workbench tuned for long-running agent and developer sessions.',
    mode: 'dark',
    source: 'Primer and Carbon inspired',
    swatches: ['#0b0f17', '#161b24', '#ff6542', '#42d6a4', '#a78bfa'],
    window: { backgroundColor: '#0b0f17', accentColor: '#ff6542' },
  },
  {
    id: 'tweakcn-modern',
    label: 'TweakCN Modern',
    description: 'Expressive shadcn token set with lively accents, charts, and sidebar colors.',
    mode: 'light',
    source: 'TweakCN inspired',
    swatches: ['#fafafa', '#ffffff', '#695cff', '#0ea5e9', '#f97316'],
    window: { backgroundColor: '#fafafa', accentColor: '#695cff' },
  },
  {
    id: 'graphite-light-console',
    label: 'Graphite Light Console',
    description: 'Crisp high-density console style for tables, settings, and status panels.',
    mode: 'light',
    source: 'Cloudscape and Atlassian inspired',
    swatches: ['#f7f8fa', '#ffffff', '#155e75', '#0891b2', '#d6dde5'],
    window: { backgroundColor: '#f7f8fa', accentColor: '#155e75' },
  },
  {
    id: 'shadcn-neutral',
    label: 'shadcn Neutral',
    description: 'Compact neutral SaaS styling with restrained borders and semantic surfaces.',
    mode: 'light',
    source: 'shadcn/ui New York inspired',
    swatches: ['#ffffff', '#f8fafc', '#111827', '#64748b', '#e2e8f0'],
    window: { backgroundColor: '#ffffff', accentColor: '#111827' },
  },
  {
    id: 'catppuccin-mocha',
    label: 'Catppuccin Mocha',
    description: 'Soft developer palette with pastel accents and warm dark surfaces.',
    mode: 'dark',
    source: 'Catppuccin inspired',
    swatches: ['#1e1e2e', '#313244', '#cba6f7', '#89b4fa', '#a6e3a1'],
    window: { backgroundColor: '#1e1e2e', accentColor: '#cba6f7' },
  },
  {
    id: 'nord-frost',
    label: 'Nord Frost',
    description: 'Calm arctic palette for focused reading, review, and low-noise operation.',
    mode: 'dark',
    source: 'Nord inspired',
    swatches: ['#2e3440', '#3b4252', '#88c0d0', '#a3be8c', '#d8dee9'],
    window: { backgroundColor: '#2e3440', accentColor: '#88c0d0' },
  },
  {
    id: 'frosted-command',
    label: 'Frosted Command',
    description: 'Light command-center theme with translucent-feeling layers and cool accents.',
    mode: 'light',
    source: 'Apple materials inspired',
    swatches: ['#f4f8fb', '#ffffff', '#2563eb', '#14b8a6', '#cbd5e1'],
    window: { backgroundColor: '#f4f8fb', accentColor: '#2563eb' },
  },
  {
    id: 'neo-brutalist-lab',
    label: 'Neo Brutalist Lab',
    description: 'High-contrast experimental lab style with chunky borders and bold accents.',
    mode: 'light',
    source: 'Neo brutalism inspired',
    swatches: ['#fffef3', '#ffe66d', '#111827', '#ff5d2e', '#00c2ff'],
    window: { backgroundColor: '#fffef3', accentColor: '#ff5d2e' },
  },
] as const satisfies readonly TelegraphThemePackDefinition[]

export type TelegraphThemePack = (typeof TELEGRAPH_THEME_PACKS)[number]
export type TelegraphThemeId = TelegraphThemePack['id']

export const DEFAULT_TELEGRAPH_THEME_ID: TelegraphThemeId = 'telegraph-dark-pro'

export function isTelegraphThemeId(value: string): value is TelegraphThemeId {
  return TELEGRAPH_THEME_PACKS.some(pack => pack.id === value)
}

export function normalizeTelegraphThemeId(value: string | null | undefined): TelegraphThemeId {
  return value && isTelegraphThemeId(value) ? value : DEFAULT_TELEGRAPH_THEME_ID
}

export function getTelegraphThemePack(value: string | null | undefined): TelegraphThemePack {
  const themeId = normalizeTelegraphThemeId(value)
  return TELEGRAPH_THEME_PACKS.find(pack => pack.id === themeId) ?? TELEGRAPH_THEME_PACKS[0]
}
