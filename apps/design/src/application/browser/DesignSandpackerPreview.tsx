import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, LegacyRef } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { SandpackerProvider, useSandpacker } from '@sandpacker/core'
import { BrowserWorkerBackendFactory } from '@sandpacker/worker/browser-worker-backend'
import { editorService } from '@sandpacker/editor-service'
import { StyleEditorPanel } from '@sandpacker/style-editor'
import type { ElementSelectionShape, FileTree, SerializedDOMNode } from '@sandpacker/shared'
import workerUrl from '@sandpacker/worker/worker-entry?worker&url'
import productionServiceWorkerUrl from '@sandpacker/worker/service-worker-entry?worker&url'
import { Button } from '@/packages/ui/components/ui/button'
import type {
  DesignPatchFileOperation,
  DesignSelectedComponentSnapshot,
} from '@/apps/design/application/common'
import {
  inferSandboxProjectRoot,
  sandboxVirtualPathForOperation,
} from '@/apps/design/application/common/design-project-contract'

const backendFactory = new BrowserWorkerBackendFactory({ workerUrl })
const serviceWorkerUrl = import.meta.env.DEV ? '/sandpacker-worker.js' : productionServiceWorkerUrl
let serviceWorkerPromise: Promise<void> | null = null
const SANDPACKER_REACT_VERSION = 'latest'

export interface DesignSandpackerPreviewProps {
  artifactId: string
  title: string
  operations: DesignPatchFileOperation[]
  isActive?: boolean
  selectedPath?: string
  onOperationsChange?: (operations: DesignPatchFileOperation[]) => void
  onSelectComponent?: (component: DesignSelectedComponentSnapshot) => void
}

export function DesignSandpackerPreview(props: DesignSandpackerPreviewProps): JSX.Element {
  const [serviceWorkerState, setServiceWorkerState] = useState<
    { status: 'pending' | 'ready' } | { status: 'failed'; error: string }
  >({ status: 'pending' })

  useEffect(() => {
    let disposed = false
    ensureSandpackerServiceWorker()
      .then(() => {
        if (!disposed) setServiceWorkerState({ status: 'ready' })
      })
      .catch((error: unknown) => {
        if (!disposed) {
          setServiceWorkerState({
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      })
    return () => {
      disposed = true
    }
  }, [])

  if (serviceWorkerState.status === 'failed') {
    return (
      <SandpackerMessage
        title="Sandpacker service worker failed"
        detail={`${serviceWorkerState.error} Preview is unavailable, but code and inspect tabs remain usable.`}
      />
    )
  }

  if (serviceWorkerState.status !== 'ready') {
    return <SandpackerMessage title="Preparing Sandpacker preview" />
  }

  return (
    <SandpackerProvider
      key={props.artifactId}
      busId={`telegraph-design-${safeRouteSegment(props.artifactId)}`}
      backendFactory={backendFactory}
      compileDebounceMs={150}
    >
      <SandpackerPreviewSurface {...props} />
    </SandpackerProvider>
  )
}

function SandpackerPreviewSurface({
  artifactId,
  title,
  operations,
  isActive = true,
  onOperationsChange,
  onSelectComponent,
}: DesignSandpackerPreviewProps): JSX.Element {
  const workspaceId = useMemo(() => safeRouteSegment(artifactId), [artifactId])
  const operationsSignature = useMemo(() => JSON.stringify(operations), [operations])
  const projected = useMemo(() => createSandpackerFileTree(operations), [operations])
  const [files, setFiles] = useState<FileTree>(projected.files)
  const [status, setStatus] = useState('Preparing preview')
  const lastImportedOperations = useRef(operationsSignature)
  const lastEmittedOperations = useRef(operationsSignature)
  const lastEmittedSelectionId = useRef<string | null>(null)
  const previousArtifactId = useRef(artifactId)
  const previousActive = useRef(isActive)
  const { client, iframeRef, error, errorDetails, selectedElement, hmrMessage } = useSandpacker({
    workspaceId,
  })

  useEffect(() => {
    const artifactChanged = previousArtifactId.current !== artifactId
    const operationsChanged = lastImportedOperations.current !== operationsSignature
    if (!artifactChanged && !operationsChanged) return
    previousArtifactId.current = artifactId
    lastImportedOperations.current = operationsSignature
    const nextFiles = cloneFileTree(projected.files)
    setFiles(nextFiles)
    if (artifactChanged) editorService.reset()
    editorService.getCurrentFileService().setFilesFromRemote(nextFiles)
    lastEmittedOperations.current = operationsSignature
    lastEmittedSelectionId.current = null
  }, [artifactId, operationsSignature, projected.files])

  useEffect(() => {
    const activated = isActive && !previousActive.current
    previousActive.current = isActive
    if (!activated) return
    const nextFiles = cloneFileTree(projected.files)
    setFiles(nextFiles)
    editorService.getCurrentFileService().setFilesFromRemote(nextFiles)
    lastImportedOperations.current = operationsSignature
    lastEmittedOperations.current = operationsSignature
    lastEmittedSelectionId.current = null
  }, [isActive, operationsSignature, projected.files])

  useEffect(() => {
    editorService.setEditingMode(true)
    editorService.setTechStack('web')
    editorService.getCurrentFileService().setFilesFromRemote(files)
    editorService.getCurrentFileService().setFileTreeSetter((updater) => {
      setFiles(current => updater(current))
    })
    return () => {
      editorService.setEditingMode(false)
      editorService.reset()
    }
  }, [])

  useEffect(() => {
    if (!client) return
    editorService.setSandboxClient(client)
  }, [client])

  useEffect(() => {
    if (!iframeRef.current) return
    editorService.setIframeRef(iframeRef.current)
  }, [iframeRef, client])

  useEffect(() => {
    editorService.getCurrentFileService().setFiles(files)
  }, [files])

  useEffect(() => {
    editorService.receiveElementSelection(selectedElement)
    if (!selectedElement || !onSelectComponent) return
    const snapshot = selectedComponentFromSandpackerSelection({
      artifactId,
      selection: selectedElement,
      virtualPathToOperationPath: projected.virtualPathToOperationPath,
    })
    if (!snapshot || snapshot.id === lastEmittedSelectionId.current) return
    lastEmittedSelectionId.current = snapshot.id
    onSelectComponent(snapshot)
  }, [artifactId, projected.virtualPathToOperationPath, onSelectComponent, selectedElement])

  useEffect(() => {
    if (!client) return
    let cancelled = false
    setStatus('Syncing files')

    console.log('update files ', files)

    client
      .updateTree(files)
      .then(() => {
        if (cancelled) return
        if (iframeRef.current && !iframeRef.current.getAttribute('src')) {
          iframeRef.current.src = client.iframeSrc
        }
        setStatus('Running')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setStatus(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [client, files, iframeRef])

  useEffect(() => {
    if (!onOperationsChange) return
    const next = updateOperationsFromFiles(operations, files, projected.previewOnlyContent)
    const serialized = JSON.stringify(next)
    if (serialized === lastEmittedOperations.current) return
    lastEmittedOperations.current = serialized
    onOperationsChange(next)
  }, [files, onOperationsChange, operations, projected.previewOnlyContent])

  const restartPreview = async (): Promise<void> => {
    if (!client) return
    setStatus('Restarting')
    await client.reload()
    if (iframeRef.current) iframeRef.current.src = `${client.iframeSrc}?v=${String(Date.now())}`
    setStatus('Running')
  }

  return (
    <div className="grid h-full min-h-[560px] overflow-hidden rounded-md border border-border bg-card shadow-sm xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="flex min-h-0 min-w-0 flex-col bg-background">
        <div className="flex h-10 shrink-0 items-center justify-between gap-3 border-b border-border bg-background px-3">
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            {error ? error.message : status}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className="text-[10px] text-muted-foreground">{formatHmr(hmrMessage)}</span>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Restart preview"
              className="h-7 w-7"
              onClick={() => { void restartPreview() }}
            >
              <RefreshCcw size={14} />
            </Button>
          </div>
        </div>
        {error ? (
          <div className="m-3 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive">
            <div className="font-medium">{error.message}</div>
            {errorDetails?.filename && (
              <div className="mt-1 font-mono">
                {errorDetails.filename}:{errorDetails.line ?? 0}:{errorDetails.column ?? 0}
              </div>
            )}
            {errorDetails?.frame && <pre className="mt-2 overflow-auto whitespace-pre-wrap">{errorDetails.frame}</pre>}
          </div>
        ) : null}
        <div className="min-h-0 flex-1 bg-white">
          <iframe
            ref={iframeRef as unknown as LegacyRef<HTMLIFrameElement>}
            title={`${title} preview`}
            className="h-full w-full bg-white"
          />
        </div>
      </section>

      <aside className="min-h-0 min-w-0 overflow-y-auto border-t border-border bg-card p-2 xl:border-l xl:border-t-0">
        <StyleEditorPanel />
      </aside>
    </div>
  )
}

function ensureSandpackerServiceWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return Promise.reject(new Error('Service worker is not available.'))
  serviceWorkerPromise ??= navigator.serviceWorker
    .register(serviceWorkerUrl, { scope: '/', type: 'module' })
    .then(async () => {
      await navigator.serviceWorker.ready
      if (navigator.serviceWorker.controller) return
      await new Promise<void>((resolve) => {
        const timeoutId = window.setTimeout(resolve, 2000)
        navigator.serviceWorker.addEventListener('controllerchange', () => {
          window.clearTimeout(timeoutId)
          resolve()
        }, { once: true })
      })
    })
    .catch((error: unknown) => {
      serviceWorkerPromise = null
      throw error
    })
  return serviceWorkerPromise
}

export function createSandpackerFileTree(
  operations: DesignPatchFileOperation[],
): {
  files: FileTree
  previewOnlyContent: Map<string, string>
  virtualPathToOperationPath: Map<string, string>
} {
  const projectRoot = inferSandboxProjectRoot(operations)
  const projectedOperations = operations
    .filter(operation => operation.kind !== 'delete' && operation.content !== undefined)
    .map(operation => ({
      operation,
      path: sandboxVirtualPathForOperation(operation.path, projectRoot),
    }))
  const virtualPathToOperationPath = new Map<string, string>()
  const previewOnlyContent = new Map<string, string>()
  const files: FileTree = {}

  for (const item of projectedOperations) {
    const source = item.operation.content ?? ''
    const previewSource = normalizePreviewFileSource(item.path, source)
    files[item.path] = previewSource
    if (previewSource !== source) previewOnlyContent.set(item.path, previewSource)
    virtualPathToOperationPath.set(item.path, item.operation.path)
  }

  return { files, previewOnlyContent, virtualPathToOperationPath }
}

function updateOperationsFromFiles(
  operations: DesignPatchFileOperation[],
  files: FileTree,
  previewOnlyContent: Map<string, string>,
): DesignPatchFileOperation[] {
  const projectRoot = inferSandboxProjectRoot(operations)
  return operations.map(operation => {
    if (operation.kind === 'delete') return operation
    const path = sandboxVirtualPathForOperation(operation.path, projectRoot)
    const content = fileContent(files, path)
    if (content === undefined) return operation
    if (content === previewOnlyContent.get(path)) return operation
    return content === operation.content ? operation : { ...operation, content }
  })
}

function normalizePreviewFileSource(path: string, source: string): string {
  return path === '/package.json' ? normalizePreviewPackageJsonContent(source) : source
}

function normalizePreviewPackageJsonContent(source: string): string {
  try {
    const parsed = JSON.parse(source) as unknown
    if (!isRecord(parsed)) return source
    const dependencies = isRecord(parsed.dependencies) ? parsed.dependencies : undefined
    if (!dependencies) return source
    const normalizedDependencies = normalizePreviewDependencies(dependencies)
    if (normalizedDependencies === dependencies) return source
    return JSON.stringify({
      ...parsed,
      dependencies: normalizedDependencies,
    }, null, 2)
  } catch {
    return source
  }
}

function normalizePreviewDependencies(
  dependencies: Record<string, unknown>,
): Record<string, unknown> {
  let normalized: Record<string, unknown> | undefined
  const ensureNormalized = (): Record<string, unknown> => {
    normalized ??= { ...dependencies }
    return normalized
  }

  if (hasOwn(dependencies, 'react') || hasOwn(dependencies, 'react-dom')) {
    const next = ensureNormalized()
    next.react = SANDPACKER_REACT_VERSION
    next['react-dom'] = SANDPACKER_REACT_VERSION
  }

  for (const name of Object.keys(dependencies)) {
    if (name.startsWith('@radix-ui/react-') && dependencies[name] !== 'latest') {
      ensureNormalized()[name] = 'latest'
    }
  }

  return normalized ?? dependencies
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasOwn(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function fileContent(files: FileTree, path: string): string | undefined {
  if (!Object.prototype.hasOwnProperty.call(files, path)) return undefined
  return (files as Partial<Record<string, string>>)[path]
}

function cloneFileTree(files: FileTree): FileTree {
  return { ...files }
}

function toLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function selectedComponentFromSandpackerSelection({
  artifactId,
  selection,
  virtualPathToOperationPath,
}: {
  artifactId: string
  selection: ElementSelectionShape
  virtualPathToOperationPath: Map<string, string>
}): DesignSelectedComponentSnapshot | null {
  const virtualPath = toLeadingSlash(selection.filePath)
  const path = virtualPathToOperationPath.get(virtualPath) ?? selection.filePath
  const selectedNode = selectedDomNode(selection.domTree)
  const attributes = selection.attributes ?? selectedNode?.attributes
  const elementTag = selectedNode?.tag ?? tagFromSelectionName(selection.name)
  const className = attributes?.class ?? attributes?.className
  const label = [
    selection.name,
    elementTag,
    className ? `.${className.split(/\s+/).filter(Boolean).slice(0, 2).join('.')}` : undefined,
  ].filter(Boolean).join(' ') || 'Selected element'

  return {
    id: [
      artifactId,
      'preview-dom',
      path,
      String(selection.line),
      String(selection.column),
      selection.id,
    ].map(safeRouteSegment).join(':'),
    artifactId,
    label,
    source: 'preview-dom',
    path,
    elementTag,
    className,
    attributes,
    sourceLocation: {
      filePath: path,
      line: selection.line,
      column: selection.column,
    },
  }
}

function selectedDomNode(node: SerializedDOMNode | undefined): SerializedDOMNode | undefined {
  if (!node) return undefined
  if (node.selected) return node
  return node.children?.map(selectedDomNode).find((child): child is SerializedDOMNode => Boolean(child))
}

function tagFromSelectionName(name: string): string | undefined {
  const trimmed = name.trim()
  return /^[a-z][a-z0-9-]*$/i.test(trimmed) ? trimmed.toLowerCase() : undefined
}

function safeRouteSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function formatHmr(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'No HMR event'
  const type = 'type' in payload ? String(payload.type) : 'update'
  return `HMR ${type}`
}

function SandpackerMessage({ title, detail }: { title: string; detail?: string }): JSX.Element {
  return (
    <div className="flex min-h-[420px] items-center justify-center rounded-md border border-border bg-card p-6">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto h-5 w-5 text-muted-foreground" />
        <div className="mt-3 text-sm font-medium text-foreground">{title}</div>
        {detail && <div className="mt-2 text-xs text-muted-foreground">{detail}</div>}
      </div>
    </div>
  )
}
