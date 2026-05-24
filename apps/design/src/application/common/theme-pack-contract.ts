export interface ThemePack {
  id: string
  label: string
  description: string
  useCases: string[]
  tokens: {
    cssVariables: Record<string, string>
    radius: string
    typography: ThemeTypography
    spacingScale: string[]
  }
  layoutRules: string[]
  motionRules: string[]
  examplePrompts: string[]
  antiPatterns: string[]
  reviewerChecks: Array<{
    id: string
    summary: string
  }>
}

export interface ThemeTypography {
  fontFamily: string
  headingWeight: string
  bodySize: string
}

export const BUILTIN_THEME_PACKS: ThemePack[] = [
  {
    id: 'shadcn-new-york-neutral',
    label: 'shadcn New York Neutral',
    description: 'Default neutral shadcn SaaS style with compact surfaces and semantic tokens.',
    useCases: ['SaaS dashboards', 'settings', 'forms', 'internal tools'],
    tokens: {
      cssVariables: {
        '--background': '#ffffff',
        '--foreground': '#0f172a',
        '--card': '#ffffff',
        '--card-foreground': '#0f172a',
        '--primary': '#111827',
        '--primary-foreground': '#f8fafc',
        '--secondary': '#f1f5f9',
        '--secondary-foreground': '#0f172a',
        '--muted': '#f8fafc',
        '--muted-foreground': '#64748b',
        '--accent': '#f1f5f9',
        '--accent-foreground': '#0f172a',
        '--border': '#e2e8f0',
        '--input': '#e2e8f0',
        '--ring': '#94a3b8',
        '--radius': '0.5rem',
      },
      radius: '0.5rem',
      typography: {
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        headingWeight: '700',
        bodySize: '15px',
      },
      spacingScale: ['0.5rem', '0.75rem', '1rem', '1.5rem', '2rem'],
    },
    layoutRules: ['Use restrained borders and clear content grouping.', 'Prefer scan-friendly density over decorative hero composition.'],
    motionRules: ['Keep transitions subtle and functional.'],
    examplePrompts: ['Design a SaaS settings page', 'Create a neutral analytics dashboard'],
    antiPatterns: ['Oversized marketing hero for operational tools', 'Raw color classes outside theme tokens'],
    reviewerChecks: [
      { id: 'theme:neutral-density', summary: 'Layout keeps a compact neutral SaaS density.' },
      { id: 'theme:semantic-colors', summary: 'Visible UI uses semantic shadcn tokens.' },
    ],
  },
  {
    id: 'dense-operator-console',
    label: 'Dense Operator Console',
    description: 'Operational console style for repeated scanning, triage, tables, and status-heavy workflows.',
    useCases: ['CRM', 'admin consoles', 'incident operations', 'monitoring'],
    tokens: {
      cssVariables: {
        '--background': '#f7f8fa',
        '--foreground': '#172033',
        '--card': '#ffffff',
        '--card-foreground': '#172033',
        '--primary': '#155e75',
        '--primary-foreground': '#ecfeff',
        '--secondary': '#e9eef2',
        '--secondary-foreground': '#172033',
        '--muted': '#eef2f5',
        '--muted-foreground': '#5f6b7a',
        '--accent': '#dff3f4',
        '--accent-foreground': '#164e63',
        '--border': '#d6dde5',
        '--input': '#cfd8e3',
        '--ring': '#0891b2',
        '--radius': '0.375rem',
      },
      radius: '0.375rem',
      typography: {
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        headingWeight: '700',
        bodySize: '14px',
      },
      spacingScale: ['0.375rem', '0.5rem', '0.75rem', '1rem', '1.25rem'],
    },
    layoutRules: ['Prioritize tables, filters, and status rows.', 'Avoid decorative cards that reduce scan density.'],
    motionRules: ['Motion should only clarify state changes.'],
    examplePrompts: ['Design an operations queue', 'Create a dense CRM account view'],
    antiPatterns: ['Marketing landing page layout', 'Large empty hero panels'],
    reviewerChecks: [
      { id: 'theme:dense-scan', summary: 'Information is compact enough for repeated operator scanning.' },
      { id: 'theme:status-clarity', summary: 'Statuses and filters are visually distinct without relying on raw colors.' },
    ],
  },
  {
    id: 'editorial-commerce',
    label: 'Editorial Commerce',
    description: 'Commerce and portfolio style with clear editorial rhythm, product emphasis, and generous section spacing.',
    useCases: ['commerce', 'portfolio', 'product pages', 'brand storytelling'],
    tokens: {
      cssVariables: {
        '--background': '#fbfbf7',
        '--foreground': '#20251f',
        '--card': '#ffffff',
        '--card-foreground': '#20251f',
        '--primary': '#7c2d12',
        '--primary-foreground': '#fff7ed',
        '--secondary': '#ece7dc',
        '--secondary-foreground': '#20251f',
        '--muted': '#f2eee6',
        '--muted-foreground': '#6f675c',
        '--accent': '#dbeafe',
        '--accent-foreground': '#1e3a8a',
        '--border': '#ddd6c8',
        '--input': '#ddd6c8',
        '--ring': '#a16207',
        '--radius': '0.625rem',
      },
      radius: '0.625rem',
      typography: {
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        headingWeight: '750',
        bodySize: '16px',
      },
      spacingScale: ['0.75rem', '1rem', '1.5rem', '2.25rem', '3rem'],
    },
    layoutRules: ['Use stronger section rhythm and product/content hierarchy.', 'Keep the product or offer visible in the first viewport.'],
    motionRules: ['Use measured reveal motion for section transitions only.'],
    examplePrompts: ['Design an editorial product page', 'Create a boutique portfolio homepage'],
    antiPatterns: ['Generic dashboard grid', 'Object or offer hidden below the fold'],
    reviewerChecks: [
      { id: 'theme:editorial-rhythm', summary: 'Sections have a clear editorial rhythm and offer hierarchy.' },
      { id: 'theme:first-viewport-object', summary: 'The product, place, or offer is visible in the first viewport.' },
    ],
  },
  {
    id: 'studio-dark',
    label: 'Studio Dark',
    description: 'Dark workbench style for creative tools, devtools, and canvas-like interfaces.',
    useCases: ['creative tools', 'developer tools', 'AI workbenches', 'studio dashboards'],
    tokens: {
      cssVariables: {
        '--background': '#0d1117',
        '--foreground': '#f4f7fb',
        '--card': '#161b22',
        '--card-foreground': '#f4f7fb',
        '--primary': '#f4f7fb',
        '--primary-foreground': '#0d1117',
        '--secondary': '#242b36',
        '--secondary-foreground': '#e5edf5',
        '--muted': '#1f2630',
        '--muted-foreground': '#9ba7b4',
        '--accent': '#26354a',
        '--accent-foreground': '#d7e6ff',
        '--border': '#303846',
        '--input': '#303846',
        '--ring': '#8ab4ff',
        '--radius': '0.5rem',
      },
      radius: '0.5rem',
      typography: {
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        headingWeight: '700',
        bodySize: '15px',
      },
      spacingScale: ['0.5rem', '0.75rem', '1rem', '1.5rem', '2rem'],
    },
    layoutRules: ['Use workbench regions, inspectors, and command surfaces.', 'Keep canvas/tool areas unframed when they are the primary experience.'],
    motionRules: ['Use short state transitions; avoid decorative ambient motion.'],
    examplePrompts: ['Design a dark AI studio', 'Create a developer workbench'],
    antiPatterns: ['Low contrast text', 'Decorative dark hero with no usable work surface'],
    reviewerChecks: [
      { id: 'theme:dark-contrast', summary: 'Dark surfaces preserve readable contrast.' },
      { id: 'theme:workbench-layout', summary: 'Primary tool or canvas surface is prominent and usable.' },
    ],
  },
]

export function getBuiltinThemePack(id: string): ThemePack | undefined {
  return BUILTIN_THEME_PACKS.find(pack => pack.id === id)
}
