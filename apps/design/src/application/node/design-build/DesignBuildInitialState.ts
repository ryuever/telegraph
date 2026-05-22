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

export interface DesignBuildInitialStateInput {
  runId: string
  prompt: string
  metadata?: Record<string, unknown>
}

export interface DesignBuildContextSnapshot {
  runtime: 'telegraph-design-build'
  aliasRule: '@/ mirrors the monorepo root with src elided'
  artifactPolicy: 'preview'
  defaultOutputMode: 'design-patch'
  revision?: DesignBuildRevisionContext
}

export interface DesignBuildRevisionContext {
  parentArtifactId: string
  parentArtifactKind?: string
  revision: number
  changeSummary: string
  operationPaths: string[]
  selectedComponent?: DesignBuildSelectedComponentContext
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
  const context = createDesignBuildContext(revision)
  const components = createDefaultComponentAssetRegistry().searchComponents(input.prompt, { limit: 5 })
  const artifact = createTemplateDesignPatchArtifact({
    runId: input.runId,
    prompt: input.prompt,
    parentArtifactId: revision?.parentArtifactId,
    revision: revision?.revision,
    changeSummary: revision?.changeSummary,
  })
  const plan = createPagePlan(artifact)
  const review = evaluateDesignBuildArtifact(artifact)
  return { brief, context, components, plan, artifact, review }
}

export function repairDesignBuildArtifact(
  artifact: DesignBuildArtifact,
  review: DesignBuildReview,
): DesignBuildArtifact {
  if (review.verdict !== 'repair_required' || artifact.kind !== 'design-patch') return artifact

  const operations = artifact.operations.map(operation => ({
    ...operation,
    content: operation.content
      ?.replace(/@telegraph\/ui\//g, '@/packages/ui/')
      .replace(/@\/invalid-ui\//g, '@/packages/ui/'),
  }))

  return {
    ...artifact,
    title: `${artifact.title} repaired`,
    changeSummary: artifact.changeSummary
      ? `${artifact.changeSummary} Repaired failed review checks.`
      : 'Repaired failed review checks.',
    operations,
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
  return {
    prompt,
    summary: revision ? [
      `Revise artifact ${revision.parentArtifactId}: ${prompt.trim()}`,
      selected ? `Selected component: ${selected}.` : undefined,
    ].filter(Boolean).join(' ') : prompt.trim(),
    acceptanceCriteria: [
      'Produce a visible preview artifact.',
      'Do not write workspace files during initial generation.',
      'Keep output structured so the Design workbench can project it.',
      ...(selected ? [`Preserve component-level intent for ${selected}.`] : []),
    ],
  }
}

function createDesignBuildContext(revision?: DesignBuildRevisionContext): DesignBuildContextSnapshot {
  return {
    runtime: 'telegraph-design-build',
    aliasRule: '@/ mirrors the monorepo root with src elided',
    artifactPolicy: 'preview',
    defaultOutputMode: 'design-patch',
    revision,
  }
}

function createPagePlan(artifact: DesignBuildArtifact): DesignBuildPagePlan {
  const sourceTarget = artifact.kind === 'design-patch'
    ? artifact.operations[0]?.path ?? 'apps/design/src/generated/generated-design-page.tsx'
    : 'preview-only'
  return {
    sourceTarget,
    sections: ['Header signal', 'Primary content', 'Summary panel'],
    componentTree: ['main', 'section', 'Badge', 'Button', 'Card'],
    responsiveStrategy: 'Single-column mobile layout, two-column desktop layout.',
  }
}

function extractRevisionContext(metadata: Record<string, unknown> | undefined): DesignBuildRevisionContext | undefined {
  const designContext = recordField(metadata, 'designContext')
  const activeArtifact = recordField(designContext, 'activeArtifact')
  const selectedComponent = extractSelectedComponentContext(recordField(designContext, 'selectedComponent'))
  const id = stringField(activeArtifact, 'id') ?? stringField(designContext, 'artifactId')
  if (!id) return undefined

  const operationPaths = arrayField(activeArtifact, 'operationPaths')
    .filter((item): item is string => typeof item === 'string')
  const previousRevision = numberField(activeArtifact, 'revision') ?? 0
  const prompt = stringField(designContext, 'prompt') ?? stringField(designContext, 'userPrompt')
  const selected = selectedComponentSummary(selectedComponent)

  return {
    parentArtifactId: id,
    parentArtifactKind: stringField(activeArtifact, 'kind') ?? stringField(designContext, 'artifactKind'),
    revision: previousRevision + 1,
    changeSummary: [
      prompt ? `Apply requested change: ${prompt}` : 'Apply requested design change.',
      selected ? `Target selected component: ${selected}.` : undefined,
    ].filter(Boolean).join(' '),
    operationPaths,
    selectedComponent,
  }
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

function selectedComponentSummary(component: DesignBuildSelectedComponentContext | undefined): string | undefined {
  if (!component) return undefined
  const tag = component.elementTag ? `<${component.elementTag}>` : undefined
  return [component.label ?? component.path ?? component.id, tag, component.className].filter(Boolean).join(' ')
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
