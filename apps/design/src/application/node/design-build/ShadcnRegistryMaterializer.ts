import {
  inferSandboxProjectRoot,
} from '@/apps/design/application/common/design-project-contract'
import type { DesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import type { ThemePack } from '@/apps/design/application/common/theme-pack-contract'
import type {
  ComponentRetrievalLedger,
  SelectedComponentAsset,
} from './ComponentRetrievalLedger'
import type {
  DesignPatchArtifact,
  DesignPatchOperation,
} from './DesignBuildArtifacts'
import { ThemePackRegistry } from './ThemePackRegistry'

export interface ShadcnRegistryMaterializerInput {
  artifact: DesignPatchArtifact
  ledger: ComponentRetrievalLedger
  policy: DesignSystemPolicy
}

export interface MaterializedRegistryResult {
  artifact: DesignPatchArtifact
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  aliases: Record<string, string>
  provenance: RegistryProvenance[]
}

export interface RegistryProvenance {
  name: string
  source: string
  type: SelectedComponentAsset['type']
  files: string[]
  dependencies: string[]
  reason: string
  sourceKind?: string
  command?: string
}

const SHADCN_RUNTIME_DEPENDENCIES: Record<string, string> = {
  '@radix-ui/react-slot': '^1.2.3',
  'class-variance-authority': '^0.7.1',
  clsx: '^2.1.1',
  'tailwind-merge': '^3.3.1',
}

export class ShadcnRegistryMaterializer {
  constructor(private readonly themePackRegistry = new ThemePackRegistry()) {}

  materialize(input: ShadcnRegistryMaterializerInput): MaterializedRegistryResult {
    const projectRoot = inferSandboxProjectRoot(input.artifact.operations)
    if (!projectRoot) {
      return {
        artifact: input.artifact,
        dependencies: {},
        devDependencies: {},
        aliases: {},
        provenance: [],
      }
    }

    const sanitizedOperations = sanitizeRawColorOperations(input.artifact.operations, projectRoot)
    const selectedUi = installedUiAssets(sanitizedOperations, projectRoot, input.ledger.selected)
    const dependencies = dependencyClosure(selectedUi)
    const themePack = this.themePackRegistry.get(input.policy.themePack?.id)
    const operations = upsertOperations(sanitizedOperations, [
      updatePackageJson(sanitizedOperations, projectRoot, dependencies),
      operation(projectRoot, 'index.html', renderIndexHtml(input.artifact.title)),
      operation(projectRoot, 'src/index.tsx', renderEntrySource()),
      operation(projectRoot, 'components.json', renderComponentsJson()),
      operation(projectRoot, 'tsconfig.json', renderTsconfigJson()),
      operation(projectRoot, 'vite.config.ts', renderViteConfig()),
      operation(projectRoot, 'src/styles.css', renderShadcnStyles(themePack)),
      operation(projectRoot, 'src/lib/utils.ts', renderUtilsSource()),
      operation(projectRoot, 'design-system.theme.json', renderThemeMetadata(themePack)),
      operation(projectRoot, 'design-system.provenance.json', renderProvenance(input, selectedUi)),
    ])

    const provenance = provenanceForArtifact(input, selectedUi)
    return {
      artifact: {
        ...input.artifact,
        operations,
      },
      dependencies,
      devDependencies: {},
      aliases: {
        '@': './src',
      },
      provenance,
    }
  }
}

function dependencyClosure(selected: SelectedComponentAsset[]): Record<string, string> {
  const dependencies: Record<string, string> = { ...SHADCN_RUNTIME_DEPENDENCIES }
  for (const asset of selected) {
    for (const dependency of asset.dependencies ?? []) {
      dependencies[dependency] = defaultVersionForDependency(dependency)
    }
  }
  return dependencies
}

function defaultVersionForDependency(name: string): string {
  return SHADCN_RUNTIME_DEPENDENCIES[name] ?? 'latest'
}

function installedUiAssets(
  operations: DesignPatchOperation[],
  projectRoot: string,
  selected: SelectedComponentAsset[],
): SelectedComponentAsset[] {
  const selectedByName = new Map(selected.map(asset => [normalizeUiName(asset.name), asset]))
  const installedNames = new Set(
    operations
      .filter(operation => operation.kind !== 'delete' && operation.content)
      .map(operation => projectRelativePath(operation.path, projectRoot))
      .map(path => path.match(/^src\/components\/ui\/([a-z0-9-]+)\.(tsx|jsx)$/i)?.[1])
      .filter((name): name is string => Boolean(name))
      .map(normalizeUiName),
  )

  return [...installedNames].map(name => {
    const selectedAsset = selectedByName.get(name)
    return selectedAsset
      ? normalizeInstalledAsset(selectedAsset, name)
      : {
          registry: '@shadcn',
          name,
          type: 'registry:ui',
          description: `${name} installed by shadcn component tool.`,
          score: 0,
          reason: 'Installed by add_shadcn_component.',
          dependencies: [],
          files: [`src/components/ui/${name}.tsx`],
          materializedFiles: [`src/components/ui/${name}.tsx`],
          importExamples: [],
        }
  })
}

function normalizeInstalledAsset(asset: SelectedComponentAsset, name: string): SelectedComponentAsset {
  return {
    ...asset,
    name,
    files: asset.files?.length ? asset.files : [`src/components/ui/${name}.tsx`],
    materializedFiles: asset.materializedFiles.length ? asset.materializedFiles : [`src/components/ui/${name}.tsx`],
  }
}

function normalizeUiName(name: string): string {
  return name
    .trim()
    .replace(/\.(tsx|jsx|ts|js)$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function sanitizeRawColorOperations(
  operations: DesignPatchOperation[],
  projectRoot: string,
): DesignPatchOperation[] {
  return operations.map(operation => {
    if (!operation.content || !shouldSanitizeRawColors(operation.path, projectRoot)) return operation
    return {
      ...operation,
      content: operation.content.replace(/#[0-9a-f]{3,8}\b/gi, semanticColorTokenForHex),
    }
  })
}

function shouldSanitizeRawColors(path: string, projectRoot: string): boolean {
  const relativePath = projectRelativePath(path, projectRoot)
  if (!/\.(tsx|ts|jsx|js|css)$/i.test(relativePath)) return false
  return relativePath !== 'src/styles.css'
}

function semanticColorTokenForHex(hex: string): string {
  const rgb = rgbFromHex(hex)
  if (!rgb) return 'var(--primary)'
  const [red, green, blue] = rgb
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const average = (red + green + blue) / 3

  if (min > 245) return 'var(--background)'
  if (max < 35) return 'var(--foreground)'
  if (average > 226) return 'var(--secondary)'
  if (max - min < 24) return average > 140 ? 'var(--muted-foreground)' : 'var(--foreground)'
  if (green > red && green >= blue) return 'var(--accent)'
  return 'var(--primary)'
}

function rgbFromHex(value: string): [number, number, number] | undefined {
  const raw = value.replace('#', '')
  const hex = raw.length === 3
    ? raw.split('').map(character => `${character}${character}`).join('')
    : raw.slice(0, 6)
  if (!/^[0-9a-f]{6}$/i.test(hex)) return undefined
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ]
}

function updatePackageJson(
  operations: DesignPatchOperation[],
  projectRoot: string,
  dependencies: Record<string, string>,
): DesignPatchOperation {
  const packageOperation = operations.find(operation => operation.path === `${projectRoot}/package.json`)
  const packageJson = parseRecord(packageOperation?.content) ?? {}
  const currentDependencies = isRecord(packageJson.dependencies) ? packageJson.dependencies : {}
  const currentDevDependencies = isRecord(packageJson.devDependencies) ? packageJson.devDependencies : {}
  const existingDependencies = stringRecord(currentDependencies)
  const existingDevDependencies = stringRecord(currentDevDependencies)

  return {
    kind: packageOperation ? 'update' : 'add',
    path: `${projectRoot}/package.json`,
    content: JSON.stringify({
      ...packageJson,
      dependencies: sortRecord({
        ...existingDependencies,
        ...dependencies,
        react: '19.1.0',
        'react-dom': '19.1.0',
      }),
      devDependencies: sortRecord({
        '@vitejs/plugin-react': 'latest',
        typescript: '5.3.3',
        vite: '^5.4.0',
        ...existingDevDependencies,
      }),
    }, null, 2),
  }
}

function renderIndexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/index.tsx?entry"></script>
  </body>
</html>
`
}

function renderEntrySource(): string {
  return `import React from 'react'
import { createRoot } from 'react-dom/client'
import GeneratedDesignPage from './App'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GeneratedDesignPage />
  </React.StrictMode>,
)
`
}

function renderComponentsJson(): string {
  return JSON.stringify({
    $schema: 'https://ui.shadcn.com/schema.json',
    style: 'new-york',
    rsc: false,
    tsx: true,
    tailwind: {
      config: '',
      css: 'src/styles.css',
      baseColor: 'neutral',
      cssVariables: true,
      prefix: '',
    },
    aliases: {
      components: '@/components',
      utils: '@/lib/utils',
      ui: '@/components/ui',
      lib: '@/lib',
      hooks: '@/hooks',
    },
  }, null, 2)
}

function renderTsconfigJson(): string {
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2020',
      useDefineForClassFields: true,
      lib: ['DOM', 'DOM.Iterable', 'ES2020'],
      allowJs: false,
      skipLibCheck: true,
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      strict: true,
      forceConsistentCasingInFileNames: true,
      module: 'ESNext',
      moduleResolution: 'Node',
      resolveJsonModule: true,
      isolatedModules: true,
      noEmit: true,
      jsx: 'react-jsx',
      baseUrl: '.',
      paths: {
        '@/*': ['./src/*'],
      },
    },
    include: ['src'],
    references: [],
  }, null, 2)
}

function renderViteConfig(): string {
  return `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
})
`
}

function renderUtilsSource(): string {
  return `import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
`
}

function renderShadcnStyles(themePack: ThemePack): string {
  return `:root {
${renderCssVariables(themePack)}
  color: var(--foreground);
  background: var(--background);
  font-family: ${themePack.tokens.typography.fontFamily};
  font-size: ${themePack.tokens.typography.bodySize};
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
  min-height: 100vh;
  background: var(--background);
}

button {
  font: inherit;
}

.app-shell {
  min-height: 100vh;
  background: var(--background);
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 48px;
  border-bottom: 1px solid var(--border);
  background: var(--card);
}

.brand {
  font-size: 14px;
  font-weight: ${themePack.tokens.typography.headingWeight};
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.nav-links {
  display: flex;
  gap: 18px;
  color: var(--muted-foreground);
  font-size: 14px;
}

.hero {
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
  gap: 42px;
  align-items: center;
  width: min(1120px, calc(100% - 48px));
  min-height: calc(100vh - 74px);
  margin: 0 auto;
  padding: 54px 0;
}

.eyebrow {
  margin: 0 0 16px;
  color: var(--muted-foreground);
  font-size: 13px;
  font-weight: 800;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

h1 {
  max-width: 760px;
  margin: 0;
  color: var(--foreground);
  font-size: clamp(40px, 7vw, 76px);
  font-weight: ${themePack.tokens.typography.headingWeight};
  line-height: 0.96;
  letter-spacing: 0;
}

.lede {
  max-width: 680px;
  margin: 24px 0 0;
  color: var(--muted-foreground);
  font-size: 18px;
  line-height: 1.7;
}

.actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.status-panel {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--card);
  box-shadow: 0 24px 70px rgba(15, 23, 42, 0.12);
  padding: 22px;
}

.status-panel h2 {
  margin: 0 0 10px;
  color: var(--card-foreground);
  font-size: 18px;
}

.status-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border-top: 1px solid var(--border);
  padding: 15px 0;
  color: var(--muted-foreground);
}

.status-row strong {
  color: var(--foreground);
}

@media (max-width: 820px) {
  .topbar {
    padding: 18px 22px;
  }

  .nav-links {
    display: none;
  }

  .hero {
    grid-template-columns: 1fr;
    width: min(100% - 36px, 640px);
    min-height: auto;
    padding: 42px 0;
  }
}
`
}

function renderCssVariables(themePack: ThemePack): string {
  return Object.entries({
    ...themePack.tokens.cssVariables,
    '--radius': themePack.tokens.radius,
  })
    .map(([name, value]) => `  ${name}: ${value};`)
    .join('\n')
}

function renderThemeMetadata(themePack: ThemePack): string {
  return JSON.stringify({
    id: themePack.id,
    label: themePack.label,
    description: themePack.description,
    useCases: themePack.useCases,
    tokens: themePack.tokens,
    layoutRules: themePack.layoutRules,
    motionRules: themePack.motionRules,
    antiPatterns: themePack.antiPatterns,
    reviewerChecks: themePack.reviewerChecks,
  }, null, 2)
}

function renderProvenance(
  input: ShadcnRegistryMaterializerInput,
  selectedUi: SelectedComponentAsset[],
): string {
  return JSON.stringify({
    policyId: input.policy.id,
    themePackId: input.policy.themePack?.id,
    registries: input.policy.uiLibrary.allowedRegistries.map(registry => registry.id),
    retrievalStatus: input.ledger.retrieval.status,
    components: provenanceForArtifact(input, selectedUi),
    fallbacks: input.ledger.fallbacks,
  }, null, 2)
}

function provenanceForArtifact(
  input: ShadcnRegistryMaterializerInput,
  selectedUi: SelectedComponentAsset[],
): RegistryProvenance[] {
  const installations = shadcnToolInstallations(input.artifact.metadata)
  if (installations.length > 0) {
    return installations.map(installation => ({
      name: installation.name,
      source: installation.source,
      type: 'registry:ui',
      files: installation.files,
      dependencies: installation.dependencies,
      reason: installation.reason,
      sourceKind: installation.sourceKind,
      command: installation.command,
    }))
  }
  return selectedUi.map(asset => ({
    name: asset.name,
    source: `${asset.registry}/${asset.name}`,
    type: asset.type,
    files: asset.materializedFiles,
    dependencies: asset.dependencies ?? [],
    reason: asset.reason,
    sourceKind: 'legacy-installed-file',
  }))
}

function shadcnToolInstallations(metadata: Record<string, unknown> | undefined): Array<{
  name: string
  source: string
  sourceKind: string
  command?: string
  files: string[]
  dependencies: string[]
  reason: string
}> {
  const raw = metadata?.shadcnToolInstallations
  if (!Array.isArray(raw)) return []
  return raw
    .filter(isRecord)
    .flatMap(item => {
      const name = stringField(item, 'name')
      const source = stringField(item, 'source')
      const sourceKind = stringField(item, 'sourceKind')
      const reason = stringField(item, 'reason')
      const files = stringArrayField(item, 'files')
      if (!name || !source || !sourceKind || !reason || files.length === 0) return []
      return [{
        name,
        source,
        sourceKind,
        command: stringField(item, 'command'),
        files,
        dependencies: stringArrayField(item, 'dependencies'),
        reason,
      }]
    })
}

function operation(projectRoot: string, relativePath: string, content: string): DesignPatchOperation {
  return {
    kind: 'add',
    path: `${projectRoot}/${relativePath}`,
    content,
  }
}

function projectRelativePath(path: string, projectRoot: string): string {
  const normalized = path.trim().replace(/^\/+/, '')
  return normalized.startsWith(`${projectRoot}/`)
    ? normalized.slice(projectRoot.length + 1)
    : normalized
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function upsertOperations(
  operations: DesignPatchOperation[],
  generatedOperations: DesignPatchOperation[],
): DesignPatchOperation[] {
  const next = new Map(operations.map(operation => [operation.path, operation]))
  for (const generated of generatedOperations) {
    const existing = next.get(generated.path)
    next.set(generated.path, {
      ...generated,
      kind: existing ? 'update' : generated.kind,
    })
  }
  return [...next.values()]
}

function parseRecord(content: string | undefined): Record<string, unknown> | undefined {
  if (!content) return undefined
  try {
    const parsed = JSON.parse(content) as unknown
    return isRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function stringRecord(value: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

function sortRecord(value: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field.trim().length > 0 ? field : undefined
}

function stringArrayField(value: Record<string, unknown>, key: string): string[] {
  const field = value[key]
  return Array.isArray(field) ? field.filter((item): item is string => typeof item === 'string') : []
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
