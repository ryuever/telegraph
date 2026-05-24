import type { PiAiExecutableTool } from '@/packages/agent/runtime/streamPiAiRuntime'
import type { DesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import type {
  DesignPatchArtifact,
  DesignPatchOperation,
} from './DesignBuildArtifacts'
import {
  createRetrievalPolicySnapshot,
  type ComponentCandidate,
  type ComponentRetrievalLedger,
  type ComponentRetrievalSource,
  type SelectedComponentAsset,
} from './ComponentRetrievalLedger'
import {
  RegistryTrustPolicy,
  retrievalMetrics,
} from './RegistryTrustPolicy'
import { ShadcnRegistryMaterializer } from './ShadcnRegistryMaterializer'
import {
  ShadcnUiLibraryProvider,
  type UiComponentCatalogEntry,
  type UiComponentInstallPlan,
  type UiComponentLibraryProvider,
} from './ui-component-library'

export interface DesignBuildShadcnToolOptions {
  prompt: string
  policy: DesignSystemPolicy
  componentLibraryProvider?: UiComponentLibraryProvider
}

export interface DesignBuildShadcnProjectToolOptions extends DesignBuildShadcnToolOptions {
  artifact: DesignPatchArtifact
  ledger: ComponentRetrievalLedger
  materializer?: ShadcnRegistryMaterializer
}

export const SHADCN_COMPONENT_RETRIEVAL_TOOL_NAMES = [
  'get_shadcn_project_llms',
  'get_shadcn_component_usage',
  'select_shadcn_components',
] as const

export const SHADCN_PROJECT_TOOL_NAMES = [
  'create_shadcn_project',
  'add_shadcn_component',
] as const

const SHADCN_TOOL_SOURCE: ComponentRetrievalSource = {
  kind: 'shadcn-llms',
  registry: '@shadcn',
  query: 'llms.txt',
  status: 'ok',
}

export function createDesignBuildShadcnTools(options: DesignBuildShadcnToolOptions): PiAiExecutableTool[] {
  const trustPolicy = new RegistryTrustPolicy()
  const componentLibraryProvider = options.componentLibraryProvider ?? new ShadcnUiLibraryProvider()

  return [
    {
      name: 'get_shadcn_project_llms',
      description: [
        'Shadcn component workflow Step 1. Get the component overview catalog before selecting components.',
        'Use this to decide which shadcn components fit the current design brief.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
      execute: async () => {
        const catalog = await componentLibraryProvider.listComponents()
        return {
          registry: '@shadcn',
          source: 'https://ui.shadcn.com/llms.txt',
          policy: createRetrievalPolicySnapshot(options.policy),
          components: catalog.map(entry => ({
            name: entry.name,
            title: entry.title,
            category: entry.category,
            type: 'registry:ui',
            description: entry.description,
            docsUrl: entry.docsUrl,
            usageUrl: entry.usageUrl,
            aliases: entry.aliases,
            importExample: `import { ${pascalCase(entry.name)} } from "@/components/ui/${entry.name}"`,
          })),
        }
      },
    },
    {
      name: 'get_shadcn_component_usage',
      description: [
        'Shadcn component workflow Step 2. Fetch official markdown usage docs for selected components before code generation.',
        'Call this after reading the overview and before selecting/installing components. Returns the shadcn .md content directly.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          components: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                componentName: { type: 'string' },
                componentKnowledgePoint: {
                  type: 'array',
                  items: { type: 'string' },
                },
              },
              required: ['componentName'],
              additionalProperties: false,
            },
          },
        },
        required: ['components'],
        additionalProperties: false,
      },
      execute: async input => {
        const names = componentNamesFromInput(input, componentLibraryProvider)
        return {
          source: 'shadcn-docs-markdown',
          components: await componentLibraryProvider.getComponentUsages(names),
        }
      },
    },
    {
      name: 'select_shadcn_components',
      description: [
        'Shadcn component workflow Step 3. Submit the components selected by the model for this design.',
        'Returns the ComponentRetrievalLedger that must be included in the final component-retrieval output.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          components: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                componentName: { type: 'string' },
                reason: { type: 'string' },
              },
              required: ['componentName'],
              additionalProperties: false,
            },
          },
        },
        required: ['components'],
        additionalProperties: false,
      },
      execute: async input => {
        const requested = componentNamesFromInput(input, componentLibraryProvider)
        const catalog = await componentLibraryProvider.listComponents()
        const candidates = requested
          .map(name => catalogCandidate(name, catalog))
          .filter((candidate): candidate is ComponentCandidate => Boolean(candidate))
        const trust = trustPolicy.evaluate(candidates)
        const selected = trust.allowed.map(toSelectedComponentAsset)
        const selectedNames = new Set(selected.map(candidate => candidate.name))
        const rejected = [
          ...trust.rejected,
          ...requested
            .filter(name => !selectedNames.has(name))
            .map(name => ({
              ...(catalogCandidate(name, catalog) ?? component(name, 0, 'Unknown component requested by model.', [])),
              rejectionReason: 'Component was not available or not allowed by registry trust policy.',
            })),
        ]

        const ledger: ComponentRetrievalLedger = {
          query: {
            prompt: options.prompt,
            pageType: 'model-selected',
            roles: selected.map(asset => ({
              role: asset.name,
              required: true,
              examples: [asset.name],
            })),
            selectedThemePack: options.policy.themePack?.id,
          },
          policy: createRetrievalPolicySnapshot(options.policy),
          trust: trust.metadata,
          retrieval: {
            status: 'complete',
            sources: [SHADCN_TOOL_SOURCE],
            metrics: retrievalMetrics({
              candidateCount: candidates.length,
              selectedCount: selected.length,
              rejectedCount: rejected.length,
              fallbackCount: 0,
            }),
          },
          candidates,
          selected,
          fallbacks: [],
          rejected,
        }
        return {
          ledger,
          selected,
          rejected,
        }
      },
    },
  ]
}

export function createDesignBuildShadcnProjectTools(options: DesignBuildShadcnProjectToolOptions): PiAiExecutableTool[] {
  const materializer = options.materializer ?? new ShadcnRegistryMaterializer()
  const componentLibraryProvider = options.componentLibraryProvider ?? new ShadcnUiLibraryProvider()
  const projectRoot = projectRootFromArtifact(options.artifact)

  return [
    {
      name: 'create_shadcn_project',
      description: [
        'Shadcn project workflow Step 1. Create or normalize the standalone Vite/shadcn project shell.',
        'Returns artifact operations for package.json, index.html, alias config, theme CSS, cn helper, components.json, and audit metadata.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          projectRoot: { type: 'string' },
          title: { type: 'string' },
        },
        additionalProperties: false,
      },
      execute: input => {
        const root = stringField(input, 'projectRoot') ?? projectRoot
        const title = stringField(input, 'title') ?? options.artifact.title
        const targetArtifact = root && root !== projectRoot
          ? retargetArtifactRoot(options.artifact, root, title)
          : { ...options.artifact, title }
        const artifact = materializer.materialize({
          artifact: targetArtifact,
          ledger: options.ledger,
          policy: options.policy,
        }).artifact

        return Promise.resolve({
          source: 'shadcn-tool:create-project',
          projectRoot: root,
          artifact,
          operations: artifact.operations,
        })
      },
    },
    {
      name: 'add_shadcn_component',
      description: [
        'Shadcn project workflow Step 2. Install one selected shadcn component into the generated project from the trusted registry cache.',
        'Call once for each component selected by the component scout before submitting the final design artifact.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          componentName: { type: 'string' },
          reason: { type: 'string' },
          projectRoot: { type: 'string' },
        },
        required: ['componentName'],
        additionalProperties: false,
      },
      execute: async input => {
        const requestedName = stringField(input, 'componentName')
        if (!requestedName) {
          return {
            available: false,
            error: 'componentName is required.',
          }
        }
        const root = stringField(input, 'projectRoot') ?? projectRoot
        const installed = installableComponent(requestedName, stringField(input, 'reason'), options.ledger.selected)
        if (!root || !installed) {
          return {
            available: false,
            componentName: requestedName,
            source: 'shadcn-registry',
            error: installed ? 'Project root is unavailable.' : 'Component is not available in the trusted shadcn cache.',
          }
        }

        let installPlan: UiComponentInstallPlan
        try {
          installPlan = await componentLibraryProvider.installComponent(installed.name)
        } catch (error) {
          return {
            available: false,
            componentName: installed.name,
            source: 'shadcn-registry',
            error: error instanceof Error ? error.message : String(error),
          }
        }

        const operations = operationsForInstallPlan(root, installPlan)
        const componentOperations = operations.filter(operation => !operation.path.endsWith('/package.json'))
        const installation = {
          name: installed.name,
          source: installPlan.sourceUrl,
          sourceKind: 'shadcn-registry-json',
          command: `add_shadcn_component ${installed.name}`,
          files: componentOperations.map(operation => operation.path),
          dependencies: unique([...(installed.dependencies ?? []), ...installPlan.dependencies]),
          registryDependencies: installPlan.registryDependencies,
          installedComponentNames: installPlan.installedComponentNames,
          reason: installed.reason,
        }
        const artifact: DesignPatchArtifact = {
          ...options.artifact,
          id: `${options.artifact.id}:shadcn-${installed.name}`,
          title: `${options.artifact.title} + ${installed.name}`,
          operations,
          metadata: {
            ...options.artifact.metadata,
            shadcnToolInstallations: [installation],
          },
        }

        return {
          available: true,
          source: 'shadcn-registry',
          component: {
            ...installed,
            dependencies: installation.dependencies,
            files: installPlan.files.map(file => `src/components/${file.path}`),
            materializedFiles: componentOperations.map(operation => operation.path),
          },
          installPlan,
          installation,
          artifact,
          operations: artifact.operations,
        }
      },
    },
  ]
}

function component(
  name: string,
  score: number,
  description: string,
  dependencies: string[],
): ComponentCandidate {
  return {
    registry: '@shadcn',
    name,
    type: 'registry:ui',
    description,
    score,
    reason: 'Selected through shadcn component tools.',
    dependencies,
    files: [`src/components/ui/${name}.tsx`],
  }
}

function catalogCandidate(name: string, catalog: UiComponentCatalogEntry[]): ComponentCandidate | undefined {
  const normalized = normalizeComponentName(name)
  const entry = catalog.find(candidate =>
    candidate.name === normalized ||
    candidate.aliases.includes(normalized) ||
    candidate.aliases.includes(normalized.replace(/-/g, ''))
  )
  if (!entry) return undefined
  return component(entry.name, scoreForCatalogEntry(entry), entry.description, [])
}

function componentNamesFromInput(
  input: Record<string, unknown>,
  provider: UiComponentLibraryProvider,
): string[] {
  const components = input.components
  if (!Array.isArray(components)) return []
  return [...new Set(components
    .map(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
      const componentName = (value as { componentName?: unknown }).componentName
      return typeof componentName === 'string' ? provider.normalizeComponentName(componentName) : undefined
    })
    .filter((name): name is string => Boolean(name)))]
}

function installableComponent(
  name: string,
  reason: string | undefined,
  selected: SelectedComponentAsset[],
): SelectedComponentAsset | undefined {
  const normalized = normalizeComponentName(name)
  const asset = selected.find(candidate => normalizeComponentName(candidate.name) === normalized)
  if (!asset || asset.type !== 'registry:ui') return undefined
  return {
    ...asset,
    reason: reason ?? asset.reason,
  }
}

function scoreForCatalogEntry(entry: UiComponentCatalogEntry): number {
  const categoryScore: Record<string, number> = {
    'Form & Input': 8,
    'Layout & Navigation': 7,
    'Overlays & Dialogs': 7,
    'Feedback & Status': 7,
    'Display & Media': 7,
  }
  return categoryScore[entry.category] ?? 6
}

function operationsForInstallPlan(
  projectRoot: string,
  installPlan: UiComponentInstallPlan,
): DesignPatchOperation[] {
  return [
    ...installPlan.files.map(file => ({
      kind: 'add' as const,
      path: `${projectRoot}/src/components/${normalizeRegistryFilePath(file.path)}`,
      content: file.content,
    })),
    dependencyPatchOperation(projectRoot, installPlan.dependencies),
  ]
}

function dependencyPatchOperation(
  projectRoot: string,
  dependencies: string[],
): DesignPatchOperation {
  return {
    kind: 'update',
    path: `${projectRoot}/package.json`,
    content: JSON.stringify({
      dependencies: Object.fromEntries(dependencies.map(dependency => [dependencyName(dependency), dependencyVersion(dependency)])),
    }, null, 2),
  }
}

function dependencyName(dependency: string): string {
  const atIndex = dependency.lastIndexOf('@')
  return atIndex > 0 ? dependency.slice(0, atIndex) : dependency
}

function dependencyVersion(dependency: string): string {
  const atIndex = dependency.lastIndexOf('@')
  return atIndex > 0 ? dependency.slice(atIndex + 1) : 'latest'
}

function normalizeRegistryFilePath(filePath: string): string {
  return filePath
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/(^|\/)\.\.(?=\/|$)/g, '')
}

function toSelectedComponentAsset(candidate: ComponentCandidate): SelectedComponentAsset {
  return {
    ...candidate,
    materializedFiles: candidate.files ?? [`src/components/ui/${candidate.name}.tsx`],
    importExamples: [`import { ${pascalCase(candidate.name)} } from "@/components/ui/${candidate.name}"`],
  }
}

function projectRootFromArtifact(artifact: DesignPatchArtifact): string | undefined {
  const packageOperation = artifact.operations.find(operation =>
    operation.kind !== 'delete' && operation.path.split('/').at(-1) === 'package.json'
  )
  if (!packageOperation) return undefined
  const segments = packageOperation.path.split('/').filter(Boolean)
  return segments.at(-1) === 'package.json' && segments.length > 1
    ? segments.slice(0, -1).join('/')
    : undefined
}

function retargetArtifactRoot(
  artifact: DesignPatchArtifact,
  projectRoot: string,
  title: string,
): DesignPatchArtifact {
  const currentRoot = projectRootFromArtifact(artifact)
  if (!currentRoot) return { ...artifact, title }
  return {
    ...artifact,
    title,
    operations: artifact.operations.map(operation => ({
      ...operation,
      path: operation.path.startsWith(`${currentRoot}/`)
        ? `${projectRoot}/${operation.path.slice(currentRoot.length + 1)}`
        : operation.path,
    })),
  }
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field.trim().length > 0 ? field.trim() : undefined
}

function normalizeComponentName(name: string): string {
  return name
    .trim()
    .replace(/\.(tsx|jsx|ts|js)$/i, '')
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase()
}

function pascalCase(value: string): string {
  return value
    .split('-')
    .filter(Boolean)
    .map(part => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join('')
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)]
}
