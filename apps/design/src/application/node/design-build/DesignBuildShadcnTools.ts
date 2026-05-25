import type { PiAiExecutableTool } from '@/packages/agent/runtime/streamPiAiRuntime'
import type { DesignSystemPolicy } from '@/apps/design/application/common/design-system-contract'
import type {
  DesignPatchArtifact,
  DesignPatchOperation,
} from './DesignBuildArtifacts'
import { isDesignPatchArtifact } from './DesignBuildArtifacts'
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
import { evaluateDesignBuildArtifact } from './DesignBuildReviewPolicy'

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
  'get_shadcn_component_usage',
  'create_shadcn_project',
  'add_shadcn_component',
  'validate_shadcn_component_usage',
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
  let currentArtifact: DesignPatchArtifact = options.artifact

  return [
    createGetShadcnComponentUsageTool(componentLibraryProvider),
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
        currentArtifact = mergePatchArtifacts(currentArtifact, artifact)

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
        currentArtifact = mergePatchArtifacts(currentArtifact, artifact)

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
    {
      name: 'validate_shadcn_component_usage',
      description: [
        'Shadcn codegen workflow final check. Validate the candidate generated composition uses every selected shadcn component.',
        'Call after create_shadcn_project and add_shadcn_component calls, and before submit_design_child_output.',
        'Pass the candidate design-patch artifact that includes the final src/App.tsx composition update.',
        'If this returns passed=false, update the composition source and call this tool again before submitting.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          artifact: {
            type: 'object',
            description: 'Candidate DesignPatchArtifact containing the final composition source, usually src/App.tsx.',
          },
        },
        required: ['artifact'],
        additionalProperties: false,
      },
      execute: input => {
        const candidate = isRecord(input) ? input.artifact : undefined
        if (!isDesignPatchArtifact(candidate)) {
          return Promise.resolve({
            passed: false,
            error: 'artifact must be a valid design-patch artifact with operations.',
          })
        }
        const mergedArtifact = mergePatchArtifacts(currentArtifact, candidate)
        const review = evaluateDesignBuildArtifact(mergedArtifact, {
          designSystemPolicy: options.policy,
          componentLedger: options.ledger,
        })
        const usageChecks = review.checks.filter(check => check.id.startsWith('selected-shadcn-components-'))
        const failed = usageChecks.filter(check => !check.passed)
        currentArtifact = mergedArtifact
        return Promise.resolve({
          passed: failed.length === 0,
          artifact: mergedArtifact,
          checks: usageChecks,
          missing: failed.map(check => ({
            id: check.id,
            summary: check.summary,
          })),
        })
      },
    },
  ]
}

function createGetShadcnComponentUsageTool(componentLibraryProvider: UiComponentLibraryProvider): PiAiExecutableTool {
  return {
    name: 'get_shadcn_component_usage',
    description: [
      'Shadcn codegen workflow Step 0. Fetch official markdown usage docs for the selected components before writing composition source.',
      'Call this in the Design Worker for every component from componentLedger.selected so the same model that writes src/App.tsx sees the official imports and JSX patterns.',
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
  }
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

function mergePatchArtifacts(
  base: DesignPatchArtifact,
  next: DesignPatchArtifact,
): DesignPatchArtifact {
  const operationsByPath = new Map(base.operations.map(operation => [operation.path, operation]))
  for (const operation of next.operations) {
    operationsByPath.set(operation.path, mergeOperation(operationsByPath.get(operation.path), operation))
  }
  return {
    ...base,
    ...next,
    metadata: {
      ...base.metadata,
      ...next.metadata,
      shadcnToolInstallations: [
        ...arrayField(base.metadata, 'shadcnToolInstallations'),
        ...arrayField(next.metadata, 'shadcnToolInstallations'),
      ],
    },
    operations: [...operationsByPath.values()],
  }
}

function mergeOperation(
  existing: DesignPatchOperation | undefined,
  incoming: DesignPatchOperation,
): DesignPatchOperation {
  if (!existing || !existing.content || !incoming.content || !incoming.path.endsWith('/package.json')) {
    return incoming
  }
  const existingJson = parseRecord(existing.content)
  const incomingJson = parseRecord(incoming.content)
  if (!existingJson || !incomingJson) return incoming
  return {
    ...incoming,
    kind: existing.kind === 'add' && incoming.kind !== 'delete' ? 'add' : incoming.kind,
    content: JSON.stringify({
      ...existingJson,
      ...incomingJson,
      dependencies: {
        ...recordField(existingJson, 'dependencies'),
        ...recordField(incomingJson, 'dependencies'),
      },
      devDependencies: {
        ...recordField(existingJson, 'devDependencies'),
        ...recordField(incomingJson, 'devDependencies'),
      },
    }, null, 2),
  }
}

function parseRecord(content: string): Record<string, unknown> | undefined {
  try {
    const value = JSON.parse(content) as unknown
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function recordField(value: Record<string, unknown>, key: string): Record<string, unknown> {
  const field = value[key]
  return isRecord(field) ? field : {}
}

function arrayField(value: Record<string, unknown> | undefined, key: string): unknown[] {
  const field = value?.[key]
  return Array.isArray(field) ? field : []
}

function stringField(value: Record<string, unknown>, key: string): string | undefined {
  const field = value[key]
  return typeof field === 'string' && field.trim().length > 0 ? field.trim() : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
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
