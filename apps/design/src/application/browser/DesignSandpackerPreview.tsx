import { useEffect, useMemo, useRef, useState } from 'react'
import type { JSX, LegacyRef } from 'react'
import { AlertTriangle, RefreshCcw } from 'lucide-react'
import { SandpackerProvider, useSandpacker } from '@sandpacker/core'
import { BrowserWorkerBackendFactory } from '@sandpacker/worker/browser-worker-backend'
import { editorService } from '@sandpacker/editor-service'
import { StyleEditorPanel } from '@sandpacker/style-editor'
import type { FileTree } from '@sandpacker/shared'
import workerUrl from '@sandpacker/worker/worker-entry?worker&url'
import serviceWorkerUrl from '@sandpacker/worker/service-worker-entry?worker&url'
import { Button } from '@/packages/ui/components/ui/button'
import { cn } from '@/packages/ui/lib/utils'
import type { DesignPatchFileOperation } from '@/apps/design/application/common'

const backendFactory = new BrowserWorkerBackendFactory({ workerUrl })
let serviceWorkerPromise: Promise<void> | null = null

export interface DesignSandpackerPreviewProps {
  artifactId: string
  title: string
  operations: DesignPatchFileOperation[]
  selectedPath?: string
  onOperationsChange?: (operations: DesignPatchFileOperation[]) => void
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
        detail={serviceWorkerState.error}
      />
    )
  }

  if (serviceWorkerState.status !== 'ready') {
    return <SandpackerMessage title="Preparing Sandpacker preview" />
  }

  return (
    <SandpackerProvider
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
  selectedPath,
  onOperationsChange,
}: DesignSandpackerPreviewProps): JSX.Element {
  const workspaceId = useMemo(() => safeRouteSegment(artifactId), [artifactId])
  const initial = useMemo(() => createSandpackerFiles(operations, title), [artifactId])
  const [files, setFiles] = useState<FileTree>(initial.files)
  const [activePath, setActivePath] = useState(initial.entryPath)
  const [status, setStatus] = useState('Preparing preview')
  const lastEmittedOperations = useRef(JSON.stringify(operations))
  const previousArtifactId = useRef(artifactId)
  const { client, iframeRef, error, errorDetails, selectedElement, hmrMessage } = useSandpacker({
    workspaceId,
  })

  useEffect(() => {
    if (previousArtifactId.current === artifactId) return
    previousArtifactId.current = artifactId
    const next = createSandpackerFiles(operations, title)
    setFiles(next.files)
    setActivePath(next.entryPath)
    editorService.reset()
    editorService.getCurrentFileService().setFilesFromRemote(next.files)
    lastEmittedOperations.current = JSON.stringify(operations)
  }, [artifactId, operations, title])

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
  }, [selectedElement])

  useEffect(() => {
    if (!client) return
    let cancelled = false
    setStatus('Syncing files')
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
    const next = updateOperationsFromFiles(operations, files, initial.importRestorers)
    const serialized = JSON.stringify(next)
    if (serialized === lastEmittedOperations.current) return
    lastEmittedOperations.current = serialized
    onOperationsChange(next)
  }, [files, initial.importRestorers, onOperationsChange, operations])

  const filePaths = useMemo(() => Object.keys(files).sort(sortFilePaths), [files])
  const selectedFile = selectedPath ? toVirtualPath(selectedPath) : activePath
  const selectedSource = files[selectedFile] ?? files[activePath] ?? ''

  const restartPreview = async (): Promise<void> => {
    if (!client) return
    setStatus('Restarting')
    await client.reload()
    if (iframeRef.current) iframeRef.current.src = `${client.iframeSrc}?v=${String(Date.now())}`
    setStatus('Running')
  }

  return (
    <div className="grid h-full min-h-[560px] grid-cols-[220px_minmax(0,1fr)_300px] overflow-hidden rounded-md border border-border bg-background">
      <aside className="flex min-w-0 flex-col border-r border-border bg-muted/20">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
          <span className="truncate text-xs font-medium text-foreground">Files</span>
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" onClick={() => { void restartPreview() }}>
            <RefreshCcw size={14} />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {filePaths.map(path => (
            <button
              key={path}
              type="button"
              onClick={() => { setActivePath(path) }}
              className={cn(
                'block w-full truncate rounded px-2 py-1.5 text-left font-mono text-[11px]',
                activePath === path
                  ? 'bg-accent text-accent-foreground'
                  : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
              )}
            >
              {path}
            </button>
          ))}
        </div>
        <pre className="max-h-56 overflow-auto border-t border-border bg-zinc-950 p-3 text-[10px] leading-relaxed text-zinc-100">
          {selectedSource}
        </pre>
      </aside>

      <section className="flex min-w-0 flex-col">
        <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
          <div className="min-w-0 truncate text-xs text-muted-foreground">
            {error ? error.message : status}
          </div>
          <div className="shrink-0 text-[10px] text-muted-foreground">{formatHmr(hmrMessage)}</div>
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

      <aside className="min-w-0 overflow-y-auto border-l border-border bg-background p-2">
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
  return serviceWorkerPromise
}

function createSandpackerFiles(
  operations: DesignPatchFileOperation[],
  title: string,
): {
  files: FileTree
  entryPath: string
  importRestorers: Map<string, (source: string) => string>
} {
  const firstSourceOperation = operations.find(operation => operation.kind !== 'delete' && operation.content)
  const entryPath = firstSourceOperation ? toVirtualPath(firstSourceOperation.path) : '/src/Generated.tsx'
  const importRestorers = new Map<string, (source: string) => string>()
  const files: FileTree = {
    '/package.json': JSON.stringify({
      dependencies: {
        '@vitejs/plugin-react': 'latest',
        react: '18.2.0',
        'react-dom': '18.2.0',
      },
      devDependencies: {
        typescript: '5.3.3',
      },
    }, null, 2),
    '/index.html': renderIndexHtml(title),
    '/src/index.tsx': renderEntrySource(entryPath),
    '/src/telegraph-ui.tsx': telegraphUiStubSource,
  }

  for (const operation of operations) {
    if (operation.kind === 'delete' || !operation.content) continue
    const path = toVirtualPath(operation.path)
    const normalized = normalizeTelegraphImports(operation.content)
    files[path] = normalized.source
    importRestorers.set(path, normalized.restore)
  }

  if (!files[entryPath]) {
    files[entryPath] = 'export default function GeneratedDesignPreview() { return <main>No preview source</main> }'
  }

  return { files, entryPath, importRestorers }
}

function updateOperationsFromFiles(
  operations: DesignPatchFileOperation[],
  files: FileTree,
  importRestorers: Map<string, (source: string) => string>,
): DesignPatchFileOperation[] {
  return operations.map(operation => {
    if (operation.kind === 'delete') return operation
    const path = toVirtualPath(operation.path)
    const content = files[path]
    if (content === undefined) return operation
    const restore = importRestorers.get(path)
    const restored = restore ? restore(content) : content
    return restored === operation.content ? operation : { ...operation, content: restored }
  })
}

function normalizeTelegraphImports(source: string): {
  source: string
  restore: (updatedSource: string) => string
} {
  const importPattern = /import\s+[\s\S]*?from ['"]@\/packages\/ui\/components\/ui\/(?:badge|button|card|input|tabs)['"];?\n?/g
  const matches = source.match(importPattern) ?? []
  if (matches.length === 0) return { source, restore: updatedSource => updatedSource }

  const originalImportBlock = matches.join('').trimEnd()
  let inserted = false
  const normalized = source.replace(importPattern, () => {
    if (inserted) return ''
    inserted = true
    return `import { Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Tabs, TabsContent, TabsList, TabsTrigger } from '/src/telegraph-ui.tsx'\n`
  })

  return {
    source: normalized,
    restore: updatedSource => updatedSource.replace(
      /import \{ Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Input, Tabs, TabsContent, TabsList, TabsTrigger \} from ['"]\/src\/telegraph-ui\.tsx['"];?\n?/,
      `${originalImportBlock}\n`,
    ),
  }
}

function renderIndexHtml(title: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
      :root {
        --background: 0 0% 100%;
        --foreground: 222.2 84% 4.9%;
        --card: 0 0% 100%;
        --card-foreground: 222.2 84% 4.9%;
        --muted: 210 40% 96.1%;
        --muted-foreground: 215.4 16.3% 46.9%;
        --primary: 222.2 47.4% 11.2%;
        --primary-foreground: 210 40% 98%;
        --secondary: 210 40% 96.1%;
        --secondary-foreground: 222.2 47.4% 11.2%;
        --border: 214.3 31.8% 91.4%;
      }
      body { margin: 0; min-height: 100vh; background: hsl(var(--background)); color: hsl(var(--foreground)); }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/index.tsx?entry"></script>
  </body>
</html>`
}

function renderEntrySource(entryPath: string): string {
  return `import React from 'react'
import { createRoot } from 'react-dom/client'
import GeneratedDesignPreview from '${entryPath}'

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GeneratedDesignPreview />
  </React.StrictMode>,
)
`
}

const telegraphUiStubSource = `import React from 'react'

type ElementProps<T extends keyof JSX.IntrinsicElements> = JSX.IntrinsicElements[T] & { variant?: string }

function cx(...items: Array<string | undefined | false>) {
  return items.filter(Boolean).join(' ')
}

export function Badge({ className, variant, ...props }: ElementProps<'span'>) {
  return <span className={cx('inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium', variant === 'secondary' ? 'bg-slate-100 text-slate-700' : variant === 'outline' ? 'bg-white' : 'bg-slate-900 text-white', className)} {...props} />
}

export function Button({ className, variant, ...props }: ElementProps<'button'>) {
  return <button className={cx('inline-flex min-h-9 items-center justify-center rounded-md border px-3 text-sm font-medium', variant === 'outline' ? 'bg-white text-slate-900' : 'bg-slate-900 text-white', className)} {...props} />
}

export function Card({ className, ...props }: ElementProps<'div'>) {
  return <div className={cx('rounded-lg border bg-white text-slate-950 shadow-sm', className)} {...props} />
}

export function CardHeader({ className, ...props }: ElementProps<'div'>) {
  return <div className={cx('flex flex-col gap-1.5 p-6', className)} {...props} />
}

export function CardContent({ className, ...props }: ElementProps<'div'>) {
  return <div className={cx('p-6 pt-0', className)} {...props} />
}

export function CardTitle({ className, ...props }: ElementProps<'h3'>) {
  return <h3 className={cx('text-xl font-semibold leading-none', className)} {...props} />
}

export function CardDescription({ className, ...props }: ElementProps<'p'>) {
  return <p className={cx('text-sm text-slate-500', className)} {...props} />
}

export function Input({ className, ...props }: ElementProps<'input'>) {
  return <input className={cx('flex h-10 w-full rounded-md border px-3 text-sm', className)} {...props} />
}

export function Tabs({ className, ...props }: ElementProps<'div'>) {
  return <div className={cx('space-y-3', className)} {...props} />
}

export function TabsList({ className, ...props }: ElementProps<'div'>) {
  return <div className={cx('inline-flex rounded-md bg-slate-100 p-1', className)} {...props} />
}

export function TabsTrigger({ className, ...props }: ElementProps<'button'>) {
  return <button className={cx('rounded px-3 py-1.5 text-sm font-medium', className)} {...props} />
}

export function TabsContent({ className, ...props }: ElementProps<'div'>) {
  return <div className={className} {...props} />
}
`

function toVirtualPath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function safeRouteSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function sortFilePaths(left: string, right: string): number {
  if (left === '/index.html') return -1
  if (right === '/index.html') return 1
  if (left === '/package.json') return 1
  if (right === '/package.json') return -1
  return left.localeCompare(right)
}

function formatHmr(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return 'No HMR event'
  const type = 'type' in payload ? String(payload.type) : 'update'
  return `HMR ${type}`
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
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
