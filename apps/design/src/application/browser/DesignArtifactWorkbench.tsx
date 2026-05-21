import type { JSX } from 'react'
import { Check, Code2, Eye, MousePointer2, SendHorizontal, X } from 'lucide-react'
import { Button } from '@/packages/ui/components/ui/button'
import { cn } from '@/packages/ui/lib/utils'
import type { DesignProjectedArtifact } from './design-agent-projector'
import type {
  DesignPatchFileOperation,
  DesignPatchPreview,
  DesignSelectedComponentSnapshot,
} from '@/apps/design/application/common'
import { createDesignArtifactViewModel, extractDesignPatchOperations } from './design-artifact-view'
import { DesignSandpackerPreview } from './DesignSandpackerPreview'

type ArtifactMode = 'preview' | 'code' | 'inspect'
export type ArtifactApplyStage = 'previewing' | 'previewed' | 'applying' | 'applied' | 'failed'

export interface ArtifactApplyState {
  stage: ArtifactApplyStage
  preview?: DesignPatchPreview
  error?: string
}

export type DesignSelectedComponent = DesignSelectedComponentSnapshot

interface DesignArtifactWorkbenchProps {
  artifacts: DesignProjectedArtifact[]
  activeArtifactId: string | null
  requestedArtifactIds: Set<string>
  applyStates?: Map<string, ArtifactApplyState>
  mode: ArtifactMode
  selectedComponent?: DesignSelectedComponent | null
  onSelectArtifact: (artifactId: string) => void
  onModeChange: (mode: ArtifactMode) => void
  onSelectComponent?: (component: DesignSelectedComponent) => void
  onClearSelectedComponent?: () => void
  onPatchOperationsChange?: (artifactId: string, operations: DesignPatchFileOperation[]) => void
  onApplyArtifact: (artifact: DesignProjectedArtifact) => void
}

export function DesignArtifactWorkbench({
  artifacts,
  activeArtifactId,
  requestedArtifactIds,
  applyStates,
  mode,
  selectedComponent,
  onSelectArtifact,
  onModeChange,
  onSelectComponent,
  onClearSelectedComponent,
  onPatchOperationsChange,
  onApplyArtifact,
}: DesignArtifactWorkbenchProps): JSX.Element {
  const activeArtifact = artifacts.find(artifact => artifact.id === activeArtifactId) ?? artifacts.at(-1)

  if (!activeArtifact) {
    return (
      <div className="flex flex-1 items-center justify-center bg-background p-8">
        <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
          <p className="text-center text-sm text-muted-foreground">生成的界面将在这里预览</p>
        </div>
      </div>
    )
  }

  const viewModel = createDesignArtifactViewModel(activeArtifact)
  const isRequested = requestedArtifactIds.has(activeArtifact.id)
  const applyState = applyStates?.get(activeArtifact.id)
  const isPatch = viewModel.viewKind === 'patch'
  const applyDisabled = isPatch
    ? applyState?.stage === 'previewing' || applyState?.stage === 'applying' || applyState?.stage === 'applied'
    : isRequested
  const applyLabel = applyButtonLabel({ isPatch, isRequested, state: applyState })

  return (
    <div className="flex min-h-0 flex-1 bg-background">
      <aside className="w-56 shrink-0 overflow-y-auto border-r border-border bg-muted/20 p-2">
        <div className="space-y-1">
          {artifacts.map(artifact => {
            const selected = artifact.id === activeArtifact.id
            const meta = artifactRevisionMeta(artifact)
            return (
              <button
                key={artifact.id}
                type="button"
                onClick={() => { onSelectArtifact(artifact.id) }}
                className={cn(
                  'block w-full rounded-md px-2.5 py-2 text-left transition-colors',
                  selected
                    ? 'bg-accent text-accent-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <span className="block truncate text-xs font-medium">
                  {artifact.title ?? artifact.id}
                </span>
                <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="truncate">{artifact.kind}</span>
                  {meta.revision !== undefined && <span>rev {meta.revision}</span>}
                  {requestedArtifactIds.has(artifact.id) && <Check size={11} />}
                </span>
                {meta.changeSummary && (
                  <span className="mt-1 block truncate text-[10px] text-muted-foreground">
                    {meta.changeSummary}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-10 items-center justify-between border-b border-border px-4">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-foreground">{viewModel.title}</div>
            <div className="truncate text-[10px] text-muted-foreground">
              {artifactHeaderMeta(viewModel.kind, activeArtifact)}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <div className="flex rounded-md border border-border p-0.5">
              <button
                type="button"
                aria-label="Preview artifact"
                onClick={() => { onModeChange('preview') }}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded text-muted-foreground',
                  mode === 'preview' && 'bg-accent text-accent-foreground',
                )}
              >
                <Eye size={15} />
              </button>
              <button
                type="button"
                aria-label="View artifact code"
                onClick={() => { onModeChange('code') }}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded text-muted-foreground',
                  mode === 'code' && 'bg-accent text-accent-foreground',
                )}
              >
                <Code2 size={15} />
              </button>
              <button
                type="button"
                aria-label="Inspect selected component"
                onClick={() => { onModeChange('inspect') }}
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded text-muted-foreground',
                  mode === 'inspect' && 'bg-accent text-accent-foreground',
                )}
              >
                <MousePointer2 size={15} />
              </button>
            </div>
            <Button
              type="button"
              size="sm"
              variant={applyState?.stage === 'previewed' ? 'default' : isRequested || applyState?.stage === 'applied' ? 'secondary' : 'default'}
              onClick={() => { onApplyArtifact(activeArtifact) }}
              disabled={applyDisabled}
              aria-label="Apply artifact"
            >
              {isRequested || applyState?.stage === 'applied' ? <Check size={14} /> : <SendHorizontal size={14} />}
              {applyLabel}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {mode === 'preview' ? (
            <ArtifactPreview
              artifact={activeArtifact}
              viewModel={viewModel}
              applyState={applyState}
              selectedComponent={selectedComponent}
              onSelectComponent={onSelectComponent}
              onPatchOperationsChange={onPatchOperationsChange}
            />
          ) : mode === 'inspect' ? (
            <ComponentInspector
              artifact={activeArtifact}
              selectedComponent={selectedComponent}
              onSelectComponent={onSelectComponent}
              onClearSelectedComponent={onClearSelectedComponent}
            />
          ) : (
            <pre className="min-h-full whitespace-pre-wrap rounded-md border border-border bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">
              {viewModel.code}
            </pre>
          )}
        </div>
      </section>
    </div>
  )
}

function artifactHeaderMeta(kind: string, artifact: DesignProjectedArtifact): string {
  const meta = artifactRevisionMeta(artifact)
  const parts = [kind]
  if (meta.revision !== undefined) parts.push(`rev ${String(meta.revision)}`)
  if (meta.parentArtifactId) parts.push(`parent ${meta.parentArtifactId}`)
  return parts.join(' / ')
}

function artifactRevisionMeta(artifact: DesignProjectedArtifact): {
  revision?: number
  parentArtifactId?: string
  changeSummary?: string
} {
  const output = artifact.output
  if (!output || typeof output !== 'object' || Array.isArray(output)) return {}
  const revision = (output as { revision?: unknown }).revision
  const parentArtifactId = (output as { parentArtifactId?: unknown }).parentArtifactId
  const changeSummary = (output as { changeSummary?: unknown }).changeSummary
  return {
    revision: typeof revision === 'number' ? revision : undefined,
    parentArtifactId: typeof parentArtifactId === 'string' ? parentArtifactId : undefined,
    changeSummary: typeof changeSummary === 'string' ? changeSummary : undefined,
  }
}

function ArtifactPreview({
  artifact,
  viewModel,
  applyState,
  selectedComponent,
  onSelectComponent,
  onPatchOperationsChange,
}: {
  artifact: DesignProjectedArtifact
  viewModel: ReturnType<typeof createDesignArtifactViewModel>
  applyState?: ArtifactApplyState
  selectedComponent?: DesignSelectedComponent | null
  onSelectComponent?: (component: DesignSelectedComponent) => void
  onPatchOperationsChange?: (artifactId: string, operations: DesignPatchFileOperation[]) => void
}): JSX.Element {
  if (viewModel.viewKind === 'html' && viewModel.previewHtml) {
    return (
      <iframe
        title={viewModel.title}
        sandbox=""
        srcDoc={viewModel.previewHtml}
        className="h-full min-h-[520px] w-full rounded-md border border-border bg-white"
      />
    )
  }

  if (viewModel.viewKind === 'patch' && viewModel.patchSummary) {
    const targets = selectableComponentsFromArtifact(artifact)
    const operations = extractDesignPatchOperations(artifact)
    return (
      <div className="space-y-4">
        {operations && (
          <DesignSandpackerPreview
            artifactId={artifact.id}
            title={viewModel.title}
            operations={operations}
            selectedPath={selectedComponent?.path}
            onSelectComponent={onSelectComponent}
            onOperationsChange={(nextOperations) => {
              onPatchOperationsChange?.(artifact.id, nextOperations)
            }}
          />
        )}
        <div className="grid grid-cols-3 gap-3">
          <PatchCount label="Add" value={viewModel.patchSummary.adds} />
          <PatchCount label="Update" value={viewModel.patchSummary.updates} />
          <PatchCount label="Delete" value={viewModel.patchSummary.deletes} />
        </div>
        {applyState?.preview && (
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-xs font-medium text-foreground">Normalized patch preview</div>
            <div className="mt-2 space-y-1">
              {applyState.preview.operations.map(operation => (
                <div key={`${operation.kind}:${operation.path}`} className="flex gap-2 text-xs text-muted-foreground">
                  <span className="w-14 shrink-0 uppercase">{operation.kind}</span>
                  <span className="min-w-0 truncate font-mono">{operation.path}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {applyState?.error && (
          <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            {applyState.error}
          </div>
        )}
        {targets.length > 0 && (
          <div className="rounded-md border border-border bg-card p-3">
            <div className="text-xs font-medium text-foreground">Component targets</div>
            <div className="mt-2 space-y-1">
              {targets.map(target => (
                <button
                  key={target.id}
                  type="button"
                  onClick={() => { onSelectComponent?.(target) }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                    selectedComponent?.id === target.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                  )}
                >
                  <MousePointer2 size={12} />
                  <span className="w-14 shrink-0 uppercase">{target.operationKind}</span>
                  <span className="min-w-0 truncate font-mono">{target.path}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-4 font-mono text-xs leading-relaxed text-muted-foreground">
          {viewModel.code}
        </pre>
      </div>
    )
  }

  return (
    <pre className="max-h-[640px] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-card p-4 font-mono text-xs leading-relaxed text-muted-foreground">
      {viewModel.code}
    </pre>
  )
}

function ComponentInspector({
  artifact,
  selectedComponent,
  onSelectComponent,
  onClearSelectedComponent,
}: {
  artifact: DesignProjectedArtifact
  selectedComponent?: DesignSelectedComponent | null
  onSelectComponent?: (component: DesignSelectedComponent) => void
  onClearSelectedComponent?: () => void
}): JSX.Element {
  const targets = selectableComponentsFromArtifact(artifact)
  const active = selectedComponent?.artifactId === artifact.id ? selectedComponent : null

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="rounded-md border border-border bg-card p-3">
        <div className="text-xs font-medium text-foreground">Selectable targets</div>
        <div className="mt-2 space-y-1">
          {targets.length === 0 ? (
            <div className="text-xs text-muted-foreground">No structured targets</div>
          ) : targets.map(target => (
            <button
              key={target.id}
              type="button"
              onClick={() => { onSelectComponent?.(target) }}
              className={cn(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs transition-colors',
                active?.id === target.id
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              <MousePointer2 size={12} />
              <span className="w-14 shrink-0 uppercase">{target.operationKind}</span>
              <span className="min-w-0 truncate font-mono">{target.path}</span>
            </button>
          ))}
        </div>
      </div>

      <aside className="rounded-md border border-border bg-card p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-medium text-foreground">Inspector</div>
          {active && (
            <button
              type="button"
              aria-label="Clear selected component"
              onClick={onClearSelectedComponent}
              className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X size={13} />
            </button>
          )}
        </div>
        {active ? (
          <div className="mt-3 space-y-2 text-xs">
            <InspectorField label="Artifact" value={active.artifactId} />
            <InspectorField label="Target" value={active.label} />
            <InspectorField label="Source" value={active.source} />
            {active.path && <InspectorField label="Path" value={active.path} />}
            {active.elementTag && <InspectorField label="Element" value={active.elementTag} />}
            {active.className && <InspectorField label="Class" value={active.className} />}
            {active.operationKind && <InspectorField label="Operation" value={active.operationKind} />}
            {active.sourceLocation && (
              <InspectorField
                label="Location"
                value={`${active.sourceLocation.filePath}:${String(active.sourceLocation.line)}:${String(active.sourceLocation.column)}`}
              />
            )}
          </div>
        ) : (
          <div className="mt-3 text-xs text-muted-foreground">No selection</div>
        )}
      </aside>
    </div>
  )
}

function InspectorField({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div>
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate font-mono text-foreground">{value}</div>
    </div>
  )
}

function selectableComponentsFromArtifact(artifact: DesignProjectedArtifact): DesignSelectedComponent[] {
  const operations = extractDesignPatchOperations(artifact)
  if (!operations) return []
  return operations.map((operation, index) => ({
    id: `${artifact.id}:${operation.kind}:${operation.path}:${String(index)}`,
    artifactId: artifact.id,
    label: componentLabelFromPath(operation.path),
    source: 'patch-operation',
    path: operation.path,
    operationKind: operation.kind,
  }))
}

function componentLabelFromPath(path: string): string {
  const filename = path.split('/').at(-1) ?? path
  return filename.replace(/\.[^.]+$/, '') || path
}

function PatchCount({ label, value }: { label: string; value: number }): JSX.Element {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="text-[10px] uppercase text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold text-foreground">{String(value)}</div>
    </div>
  )
}

function applyButtonLabel({
  isPatch,
  isRequested,
  state,
}: {
  isPatch: boolean
  isRequested: boolean
  state?: ArtifactApplyState
}): string {
  if (state?.stage === 'previewing') return '预览中'
  if (state?.stage === 'previewed') return '确认应用'
  if (state?.stage === 'applying') return '应用中'
  if (state?.stage === 'applied') return '已应用'
  if (state?.stage === 'failed') return isPatch ? '重试' : '应用'
  if (isPatch) return '预览 Patch'
  return isRequested ? '已请求' : '应用'
}
