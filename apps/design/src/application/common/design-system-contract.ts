export type DesignSystemMode = 'standalone-preview' | 'workspace-apply'

export type DesignRegistryKind = 'shadcn-official' | 'community-registry' | 'workspace-ui'

export interface DesignRegistryRef {
  id: string
  kind: DesignRegistryKind
  label: string
  source: string
  trustLevel: 'official' | 'allowlisted' | 'workspace'
}

export interface ThemePackRef {
  id: string
  label: string
  source: 'built-in' | 'project' | 'user'
}

export interface DesignExportPolicy {
  formats: Array<'html-zip' | 'pdf' | 'pptx' | 'png-screenshots'>
  preserveProvenance: boolean
}

export interface DesignSystemPolicy {
  id: string
  mode: DesignSystemMode
  uiLibrary: {
    priority: Array<DesignRegistryKind | 'handwritten'>
    handwritePolicy: 'only-when-unavailable' | 'app-composition-only' | 'allowed'
    allowedRegistries: DesignRegistryRef[]
    blockedRegistries?: DesignRegistryRef[]
  }
  packagePolicy: {
    allowedDependencies: string[]
    pinnedVersions: Record<string, string>
    requireDependencyClosure: boolean
  }
  tokenPolicy: {
    source: 'css-variables' | 'tailwind-theme' | 'design-token-json'
    requiredTokens: string[]
    forbidRawColorsOutsideTheme: boolean
  }
  aliasPolicy: {
    importAlias: '@'
    sourceRoot: 'src'
    requireViteAlias: boolean
    requireTsconfigAlias: boolean
  }
  themePack?: ThemePackRef
  exportPolicy?: DesignExportPolicy
}

export const DEFAULT_DESIGN_SYSTEM_POLICY_ID = 'shadcn-first-standalone'

const DEFAULT_ALLOWED_REGISTRIES: DesignRegistryRef[] = [
  {
    id: '@shadcn',
    kind: 'shadcn-official',
    label: 'shadcn/ui official registry',
    source: 'https://ui.shadcn.com',
    trustLevel: 'official',
  },
]

const DEFAULT_ALLOWED_DEPENDENCIES = [
  '@radix-ui/react-checkbox',
  '@radix-ui/react-dialog',
  '@radix-ui/react-label',
  '@radix-ui/react-slot',
  '@radix-ui/react-switch',
  '@radix-ui/react-tabs',
  'class-variance-authority',
  'clsx',
  'lucide-react',
  'react',
  'react-dom',
  'tailwind-merge',
]

const DEFAULT_REQUIRED_TOKENS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--border',
  '--input',
  '--ring',
  '--radius',
]

export function createDefaultDesignSystemPolicy(): DesignSystemPolicy {
  return {
    id: DEFAULT_DESIGN_SYSTEM_POLICY_ID,
    mode: 'standalone-preview',
    uiLibrary: {
      priority: ['shadcn-official', 'community-registry', 'workspace-ui', 'handwritten'],
      handwritePolicy: 'only-when-unavailable',
      allowedRegistries: DEFAULT_ALLOWED_REGISTRIES.map(registry => ({ ...registry })),
    },
    packagePolicy: {
      allowedDependencies: [...DEFAULT_ALLOWED_DEPENDENCIES],
      pinnedVersions: {},
      requireDependencyClosure: true,
    },
    tokenPolicy: {
      source: 'css-variables',
      requiredTokens: [...DEFAULT_REQUIRED_TOKENS],
      forbidRawColorsOutsideTheme: true,
    },
    aliasPolicy: {
      importAlias: '@',
      sourceRoot: 'src',
      requireViteAlias: true,
      requireTsconfigAlias: true,
    },
    themePack: {
      id: 'shadcn-new-york-neutral',
      label: 'shadcn New York Neutral',
      source: 'built-in',
    },
    exportPolicy: {
      formats: ['html-zip', 'pdf', 'pptx', 'png-screenshots'],
      preserveProvenance: true,
    },
  }
}

export function resolveDesignSystemPolicy(metadata?: Record<string, unknown>): DesignSystemPolicy {
  const defaultPolicy = createDefaultDesignSystemPolicy()
  const candidate = recordField(metadata, 'designSystem') ??
    recordField(recordField(metadata, 'designContext'), 'designSystem')
  if (!candidate) return defaultPolicy

  const mode = designSystemMode(candidate.mode)
  const themePack = themePackRef(candidate.themePack) ??
    themePackRefFromId(stringField(candidate.themePackId))

  return {
    ...defaultPolicy,
    id: stringField(candidate.id) ?? defaultPolicy.id,
    mode: mode ?? defaultPolicy.mode,
    themePack: themePack ?? defaultPolicy.themePack,
  }
}

function designSystemMode(value: unknown): DesignSystemMode | undefined {
  return value === 'standalone-preview' || value === 'workspace-apply' ? value : undefined
}

function themePackRef(value: unknown): ThemePackRef | undefined {
  if (!isRecord(value)) return undefined
  const id = stringField(value.id)
  const label = stringField(value.label)
  const source = value.source
  if (!id || !label || (source !== 'built-in' && source !== 'project' && source !== 'user')) {
    return undefined
  }
  return { id, label, source }
}

function themePackRefFromId(id: string | undefined): ThemePackRef | undefined {
  if (!id) return undefined
  const pack = getBuiltinThemePack(id)
  return pack ? themePackRefFromPack(pack) : undefined
}

function themePackRefFromPack(pack: ThemePack): ThemePackRef {
  return {
    id: pack.id,
    label: pack.label,
    source: 'built-in',
  }
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!isRecord(value)) return undefined
  const field = value[key]
  return isRecord(field) ? field : undefined
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
import {
  getBuiltinThemePack,
  type ThemePack,
} from './theme-pack-contract'
