import {
  createTemplateDesignPatchArtifact,
  type DesignBrief,
  type DesignBuildArtifact,
} from './DesignBuildArtifacts'
import {
  createDefaultComponentAssetRegistry,
  type ComponentSearchResult,
} from './ComponentAssetRegistry'
import { evaluateDesignBuildArtifact } from './DesignBuildReviewPolicy'
import {
  resolveDesignSystemPolicy,
  type DesignSystemPolicy,
} from '@/apps/design/application/common/design-system-contract'
import {
  isComponentEditContext,
  type ComponentEditContext,
} from '@/apps/design/application/common/component-edit-contract'

export interface DesignBuildInitialStateInput {
  runId: string
  prompt: string
  metadata?: Record<string, unknown>
}

export interface DesignBuildContextSnapshot {
  runtime: 'telegraph-design-build'
  artifactPolicy: 'preview'
  defaultOutputMode: 'design-patch'
  designSystem: DesignSystemPolicy
  sandboxProject: {
    projectRoot?: string
    dependencySource: 'package.json'
    requiredFiles: string[]
  }
  revision?: DesignBuildRevisionContext
}

export interface DesignBuildRevisionContext {
  parentArtifactId: string
  parentArtifactKind?: string
  revision: number
  changeKind: 'natural-language' | 'component-edit'
  changeSummary: string
  operationPaths: string[]
  operationSummaries: DesignBuildOperationContext[]
  selectedComponent?: DesignBuildSelectedComponentContext
  componentEdit?: ComponentEditContext
}

export interface DesignBuildOperationContext {
  kind: 'add' | 'update' | 'delete'
  path: string
  contentPreview?: string
  contentLength?: number
  expectedOriginalLength?: number
}

export interface DesignBuildSelectedComponentContext {
  id: string
  label?: string
  source?: string
  path?: string
  operationKind?: string
  elementTag?: string
  className?: string
  sourceLocation?: {
    filePath: string
    line: number
    column: number
  }
}

export interface DesignBuildPagePlan {
  sourceTarget: string
  sections: string[]
  componentTree: string[]
  responsiveStrategy: string
}

export interface DesignBuildReview {
  verdict: 'pass' | 'repair_required' | 'blocked'
  checks: Array<{
    id: string
    passed: boolean
    summary: string
  }>
}

export interface DesignBuildInitialState {
  brief: DesignBrief
  context: DesignBuildContextSnapshot
  components: ComponentSearchResult[]
  plan: DesignBuildPagePlan
  artifact: DesignBuildArtifact
  review: DesignBuildReview
}

export function createDesignBuildInitialState(
  input: DesignBuildInitialStateInput,
): DesignBuildInitialState {
  if (!input.prompt.trim()) {
    throw new DesignBuildRuntimeError('brief_failed', 'Design prompt is empty.')
  }
  const revision = extractRevisionContext(input.metadata)
  const brief = createDesignIntentBrief(input.prompt, revision)
  const components = createDefaultComponentAssetRegistry().searchComponents(input.prompt, { limit: 5 })
  const designSystem = resolveDesignSystemPolicy(input.metadata)
  const artifact = createTemplateDesignPatchArtifact({
    runId: input.runId,
    prompt: input.prompt,
    parentArtifactId: revision?.parentArtifactId,
    revision: revision?.revision,
    changeSummary: revision?.changeSummary,
  })
  const context = createDesignBuildContext(revision, projectRootFromArtifact(artifact), designSystem)
  const plan = createPagePlan(artifact)
  const review = evaluateDesignBuildArtifact(artifact, { designSystemPolicy: context.designSystem })
  return { brief, context, components, plan, artifact, review }
}

export function repairDesignBuildArtifact(
  artifact: DesignBuildArtifact,
  review: DesignBuildReview,
): DesignBuildArtifact {
  if (review.verdict !== 'repair_required' || artifact.kind !== 'design-patch') return artifact

  return {
    ...artifact,
    title: `${artifact.title} repaired`,
    changeSummary: artifact.changeSummary
      ? `${artifact.changeSummary} Repaired failed review checks.`
      : 'Repaired failed review checks.',
  }
}

export class DesignBuildRuntimeError extends Error {
  constructor(
    readonly code: DesignBuildFailureCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(message)
    this.name = 'DesignBuildRuntimeError'
  }
}

export type DesignBuildFailureCode =
  | 'brief_failed'
  | 'retrieval_failed'
  | 'codegen_failed'
  | 'review_failed'
  | 'patch_invalid'

function createDesignIntentBrief(prompt: string, revision?: DesignBuildRevisionContext): DesignBrief {
  const selected = selectedComponentSummary(revision?.selectedComponent)
  const componentEdit = componentEditSummary(revision?.componentEdit)
  return {
    prompt,
    summary: revision ? [
      `Revise artifact ${revision.parentArtifactId}: ${prompt.trim()}`,
      selected ? `Selected component: ${selected}.` : undefined,
      componentEdit ? `Component edit context: ${componentEdit}.` : undefined,
    ].filter(Boolean).join(' ') : prompt.trim(),
    acceptanceCriteria: [
      'Produce a visible preview artifact.',
      'Do not write workspace files during initial generation.',
      'Keep output structured so the Design workbench can project it.',
      ...(selected ? [`Preserve component-level intent for ${selected}.`] : []),
      ...(revision?.componentEdit ? [
        'Apply component-edit changes to the composition usage first; do not directly edit shadcn primitive source files for instance-level styling.',
      ] : []),
    ],
  }
}

function createDesignBuildContext(
  revision: DesignBuildRevisionContext | undefined,
  projectRoot: string | undefined,
  designSystem: DesignSystemPolicy,
): DesignBuildContextSnapshot {
  return {
    runtime: 'telegraph-design-build',
    artifactPolicy: 'preview',
    defaultOutputMode: 'design-patch',
    designSystem,
    sandboxProject: {
      projectRoot,
      dependencySource: 'package.json',
      requiredFiles: [
        'package.json',
        'index.html',
        'src/index.tsx or src/main.tsx',
        'component files imported by the entry',
      ],
    },
    revision,
  }
}

function createPagePlan(artifact: DesignBuildArtifact): DesignBuildPagePlan {
  const appOperation = artifact.kind === 'design-patch'
    ? artifact.operations.find(operation => operation.path.endsWith('/src/App.tsx'))
    : undefined
  const sourceTarget = artifact.kind === 'design-patch'
    ? appOperation?.path ??
      firstOperationPath(artifact.operations) ??
      'apps/design/src/generated/generated-design-page/src/App.tsx'
    : 'preview-only'
  return {
    sourceTarget,
    sections: ['Top navigation', 'Primary content', 'Project status panel'],
    componentTree: ['main', 'nav', 'section', 'aside', 'button'],
    responsiveStrategy: 'Single-column mobile layout, two-column desktop layout with stable spacing.',
  }
}

function firstOperationPath(operations: Array<{ path: string }>): string | undefined {
  return operations.length > 0 ? operations[0].path : undefined
}

function projectRootFromArtifact(artifact: DesignBuildArtifact): string | undefined {
  if (artifact.kind !== 'design-patch') return undefined
  const packageOperation = artifact.operations.find(operation =>
    operation.kind !== 'delete' && operation.path.split('/').at(-1) === 'package.json'
  )
  if (!packageOperation) return undefined
  const segments = packageOperation.path.split('/').filter(Boolean)
  if (segments.at(-1) !== 'package.json' || segments.length <= 1) return undefined
  return segments.slice(0, -1).join('/')
}

function extractRevisionContext(metadata: Record<string, unknown> | undefined): DesignBuildRevisionContext | undefined {
  const designContext = recordField(metadata, 'designContext')
  const activeArtifact = recordField(designContext, 'activeArtifact')
  const componentEdit = extractComponentEditContext(recordField(designContext, 'componentEdit'))
  const componentEditTarget = componentEdit?.target
    ? componentEdit.target as unknown as Record<string, unknown>
    : undefined
  const selectedComponent = extractSelectedComponentContext(recordField(designContext, 'selectedComponent')) ??
    extractSelectedComponentContext(componentEditTarget)
  const id = stringField(activeArtifact, 'id') ?? stringField(designContext, 'artifactId')
  if (!id) return undefined

  const operationPaths = arrayField(activeArtifact, 'operationPaths')
    .filter((item): item is string => typeof item === 'string')
  const operationSummaries = extractOperationSummaries(arrayField(activeArtifact, 'operationSummaries'))
  const previousRevision = numberField(activeArtifact, 'revision') ?? 0
  const prompt = stringField(designContext, 'prompt') ?? stringField(designContext, 'userPrompt')
  const selected = selectedComponentSummary(selectedComponent)
  const componentEditLabel = componentEditSummary(componentEdit)

  return {
    parentArtifactId: id,
    parentArtifactKind: stringField(activeArtifact, 'kind') ?? stringField(designContext, 'artifactKind'),
    revision: previousRevision + 1,
    changeKind: componentEdit ? 'component-edit' : 'natural-language',
    changeSummary: [
      prompt ? `Apply requested change: ${prompt}` : 'Apply requested design change.',
      selected ? `Target selected component: ${selected}.` : undefined,
      componentEditLabel ? `Use component edit context: ${componentEditLabel}.` : undefined,
      operationSummaries.length > 0 ? `Current artifact operations: ${operationSummaries.map(operationContextSummary).join('; ')}.` : undefined,
    ].filter(Boolean).join(' '),
    operationPaths: operationPaths.length > 0 ? operationPaths : operationSummaries.map(operation => operation.path),
    operationSummaries,
    selectedComponent,
    componentEdit,
  }
}

function extractOperationSummaries(values: unknown[]): DesignBuildOperationContext[] {
  const summaries: DesignBuildOperationContext[] = []
  for (const value of values) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    const record = value as Record<string, unknown>
    const kind = record.kind
    const path = record.path
    if ((kind !== 'add' && kind !== 'update' && kind !== 'delete') || typeof path !== 'string') {
      continue
    }
    const summary: DesignBuildOperationContext = { kind, path }
    const contentPreview = stringField(record, 'contentPreview')
    const contentLength = numberField(record, 'contentLength')
    const expectedOriginalLength = numberField(record, 'expectedOriginalLength')
    if (contentPreview !== undefined) summary.contentPreview = contentPreview
    if (contentLength !== undefined) summary.contentLength = contentLength
    if (expectedOriginalLength !== undefined) summary.expectedOriginalLength = expectedOriginalLength
    summaries.push(summary)
  }
  return summaries
}

function operationContextSummary(operation: DesignBuildOperationContext): string {
  const length = operation.contentLength !== undefined ? `, ${String(operation.contentLength)} chars` : ''
  const preview = operation.contentPreview ? `, preview: ${inlineOperationPreview(operation.contentPreview)}` : ''
  return `${operation.kind} ${operation.path}${length}${preview}`
}

function inlineOperationPreview(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 96 ? `${normalized.slice(0, 96)}...` : normalized
}

function extractSelectedComponentContext(
  value: Record<string, unknown> | undefined,
): DesignBuildSelectedComponentContext | undefined {
  const id = stringField(value, 'id')
  if (!id) return undefined
  return {
    id,
    label: stringField(value, 'label'),
    source: stringField(value, 'source'),
    path: stringField(value, 'path'),
    operationKind: stringField(value, 'operationKind'),
    elementTag: stringField(value, 'elementTag'),
    className: stringField(value, 'className'),
    sourceLocation: sourceLocationField(value),
  }
}

function extractComponentEditContext(value: Record<string, unknown> | undefined): ComponentEditContext | undefined {
  return isComponentEditContext(value) ? value : undefined
}

function selectedComponentSummary(component: DesignBuildSelectedComponentContext | undefined): string | undefined {
  if (!component) return undefined
  const tag = component.elementTag ? `<${component.elementTag}>` : undefined
  return [component.label ?? component.path ?? component.id, tag, component.className].filter(Boolean).join(' ')
}

function componentEditSummary(componentEdit: ComponentEditContext | undefined): string | undefined {
  if (!componentEdit) return undefined
  const target = componentEdit.target?.label ?? componentEdit.binding.preferredOperationPath ?? componentEdit.artifactId
  const dirty = componentEdit.dirtyOperationPaths.length > 0
    ? `${String(componentEdit.dirtyOperationPaths.length)} dirty operation(s)`
    : 'no dirty operations'
  const preferred = componentEdit.binding.preferredOperationPath
    ? `preferred path ${componentEdit.binding.preferredOperationPath}`
    : undefined
  return [target, dirty, preferred, `scope ${componentEdit.binding.editScope}`].filter(Boolean).join(', ')
}

function sourceLocationField(value: unknown): DesignBuildSelectedComponentContext['sourceLocation'] {
  const sourceLocation = recordField(value, 'sourceLocation')
  const filePath = stringField(sourceLocation, 'filePath')
  const line = numberField(sourceLocation, 'line')
  const column = numberField(sourceLocation, 'column')
  if (!filePath || line === undefined || column === undefined) return undefined
  return { filePath, line, column }
}

function recordField(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return field && typeof field === 'object' && !Array.isArray(field)
    ? field as Record<string, unknown>
    : undefined
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'string' && field.length > 0 ? field : undefined
}

function numberField(value: unknown, key: string): number | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const field = (value as Record<string, unknown>)[key]
  return typeof field === 'number' && Number.isFinite(field) ? field : undefined
}

function arrayField(value: unknown, key: string): unknown[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const field = (value as Record<string, unknown>)[key]
  return Array.isArray(field) ? field : []
}
