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

    const selectedUi = input.ledger.selected.filter(asset => asset.type === 'registry:ui')
    const dependencies = dependencyClosure(selectedUi)
    const themePack = this.themePackRegistry.get(input.policy.themePack?.id)
    const operations = upsertOperations(input.artifact.operations, [
      updatePackageJson(input.artifact.operations, projectRoot, dependencies),
      operation(projectRoot, 'components.json', renderComponentsJson()),
      operation(projectRoot, 'tsconfig.json', renderTsconfigJson()),
      operation(projectRoot, 'vite.config.ts', renderViteConfig()),
      operation(projectRoot, 'src/styles.css', renderShadcnStyles(themePack)),
      operation(projectRoot, 'src/lib/utils.ts', renderUtilsSource()),
      ...selectedUi.flatMap(asset => materializeUiAsset(projectRoot, asset)),
      operation(projectRoot, 'design-system.theme.json', renderThemeMetadata(themePack)),
      operation(projectRoot, 'design-system.provenance.json', renderProvenance(input, selectedUi)),
    ])

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
      provenance: selectedUi.map(asset => ({
        name: asset.name,
        source: `${asset.registry}/${asset.name}`,
        type: asset.type,
        files: materializedFilesForAsset(asset),
        dependencies: asset.dependencies ?? [],
        reason: asset.reason,
      })),
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
        react: '19.1.0',
        'react-dom': '19.1.0',
        ...existingDependencies,
        ...dependencies,
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

function materializeUiAsset(projectRoot: string, asset: SelectedComponentAsset): DesignPatchOperation[] {
  const source = uiSource(asset.name)
  if (!source) return []
  return [operation(projectRoot, `src/components/ui/${asset.name}.tsx`, source)]
}

function uiSource(name: string): string | undefined {
  switch (name) {
    case 'button':
      return `import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex min-h-10 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground shadow hover:opacity-90',
        secondary: 'bg-secondary text-secondary-foreground hover:opacity-90',
        outline: 'border border-input bg-background hover:bg-accent hover:text-accent-foreground',
        ghost: 'hover:bg-accent hover:text-accent-foreground',
      },
      size: {
        default: 'h-10 px-4 py-2',
        sm: 'h-9 rounded-md px-3',
        lg: 'h-11 rounded-md px-8',
        icon: 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : 'button'
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
  },
)
Button.displayName = 'Button'

export { buttonVariants }
`
    case 'card':
      return `import * as React from 'react'
import { cn } from '@/lib/utils'

export const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...props} />
  ),
)
Card.displayName = 'Card'

export const CardHeader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex flex-col space-y-1.5 p-6', className)} {...props} />
)

export const CardTitle = ({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) => (
  <h3 className={cn('text-2xl font-semibold leading-none tracking-normal', className)} {...props} />
)

export const CardDescription = ({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) => (
  <p className={cn('text-sm text-muted-foreground', className)} {...props} />
)

export const CardContent = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('p-6 pt-0', className)} {...props} />
)

export const CardFooter = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
  <div className={cn('flex items-center p-6 pt-0', className)} {...props} />
)
`
    case 'input':
      return `import * as React from 'react'
import { cn } from '@/lib/utils'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      type={type}
      className={cn('flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50', className)}
      ref={ref}
      {...props}
    />
  ),
)
Input.displayName = 'Input'
`
    case 'badge':
      return `import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const badgeVariants = cva('inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold transition-colors', {
  variants: {
    variant: {
      default: 'border-transparent bg-primary text-primary-foreground',
      secondary: 'border-transparent bg-secondary text-secondary-foreground',
      outline: 'text-foreground',
    },
  },
  defaultVariants: {
    variant: 'default',
  },
})

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />
}
`
    case 'table':
      return `import * as React from 'react'
import { cn } from '@/lib/utils'

export const Table = React.forwardRef<HTMLTableElement, React.HTMLAttributes<HTMLTableElement>>(
  ({ className, ...props }, ref) => <table ref={ref} className={cn('w-full caption-bottom text-sm', className)} {...props} />,
)
Table.displayName = 'Table'

export const TableHeader = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <thead ref={ref} className={cn('[&_tr]:border-b', className)} {...props} />,
)
TableHeader.displayName = 'TableHeader'

export const TableBody = React.forwardRef<HTMLTableSectionElement, React.HTMLAttributes<HTMLTableSectionElement>>(
  ({ className, ...props }, ref) => <tbody ref={ref} className={cn('[&_tr:last-child]:border-0', className)} {...props} />,
)
TableBody.displayName = 'TableBody'

export const TableRow = React.forwardRef<HTMLTableRowElement, React.HTMLAttributes<HTMLTableRowElement>>(
  ({ className, ...props }, ref) => <tr ref={ref} className={cn('border-b transition-colors hover:bg-muted/50', className)} {...props} />,
)
TableRow.displayName = 'TableRow'

export const TableHead = React.forwardRef<HTMLTableCellElement, React.ThHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <th ref={ref} className={cn('h-12 px-4 text-left align-middle font-medium text-muted-foreground', className)} {...props} />,
)
TableHead.displayName = 'TableHead'

export const TableCell = React.forwardRef<HTMLTableCellElement, React.TdHTMLAttributes<HTMLTableCellElement>>(
  ({ className, ...props }, ref) => <td ref={ref} className={cn('p-4 align-middle', className)} {...props} />,
)
TableCell.displayName = 'TableCell'
`
    case 'tabs':
      return `import * as React from 'react'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '@/lib/utils'

export const Tabs = TabsPrimitive.Root

export const TabsList = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.List>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List ref={ref} className={cn('inline-flex h-10 items-center justify-center rounded-md bg-muted p-1 text-muted-foreground', className)} {...props} />
))
TabsList.displayName = TabsPrimitive.List.displayName

export const TabsTrigger = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Trigger>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger ref={ref} className={cn('inline-flex items-center justify-center rounded-sm px-3 py-1.5 text-sm font-medium transition-all data-[state=active]:bg-background data-[state=active]:text-foreground', className)} {...props} />
))
TabsTrigger.displayName = TabsPrimitive.Trigger.displayName

export const TabsContent = React.forwardRef<
  React.ElementRef<typeof TabsPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content ref={ref} className={cn('mt-2 outline-none', className)} {...props} />
))
TabsContent.displayName = TabsPrimitive.Content.displayName
`
    case 'switch':
      return `import * as React from 'react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { cn } from '@/lib/utils'

export const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    className={cn('peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent bg-input transition-colors checked:bg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary', className)}
    {...props}
    ref={ref}
  >
    <SwitchPrimitive.Thumb className={cn('pointer-events-none block size-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5')} />
  </SwitchPrimitive.Root>
))
Switch.displayName = SwitchPrimitive.Root.displayName
`
    default:
      return undefined
  }
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
    components: selectedUi.map(asset => ({
      name: asset.name,
      source: `${asset.registry}/${asset.name}`,
      type: asset.type,
      files: materializedFilesForAsset(asset),
      dependencies: asset.dependencies ?? [],
      reason: asset.reason,
    })),
    fallbacks: input.ledger.fallbacks,
  }, null, 2)
}

function materializedFilesForAsset(asset: SelectedComponentAsset): string[] {
  return uiSource(asset.name) ? [`src/components/ui/${asset.name}.tsx`] : asset.materializedFiles
}

function operation(projectRoot: string, relativePath: string, content: string): DesignPatchOperation {
  return {
    kind: 'add',
    path: `${projectRoot}/${relativePath}`,
    content,
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
