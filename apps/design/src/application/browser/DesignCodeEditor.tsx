import { useCallback, useMemo, useState } from 'react'
import type { JSX } from 'react'
import Editor from '@monaco-editor/react'
import { ChevronRight, FileCode2, FolderOpen } from 'lucide-react'
import { cn } from '@/packages/ui/lib/utils'
import type { DesignPatchFileOperation } from '@/apps/design/application/common'

interface DesignCodeEditorProps {
  /** Patch file operations (multi-file). Takes priority over code/codePath. */
  operations?: DesignPatchFileOperation[]
  /** Raw code content for single-file artifacts without patch operations. */
  code?: string
  /** Virtual file path for single-file code. Defaults to a generated path. */
  codePath?: string
  selectedPath?: string
  onSelectFile?: (path: string) => void
}

interface FileTreeNode {
  name: string
  path: string
  isDir: boolean
  children: FileTreeNode[]
  operationKind?: DesignPatchFileOperation['kind']
}

/**
 * Build a virtual file tree from flat operation paths.
 * Each path segment becomes a directory node; the last segment is a file leaf.
 */
function buildFileTree(operations: DesignPatchFileOperation[]): FileTreeNode[] {
  const root: FileTreeNode[] = []

  for (const operation of operations) {
    if (operation.kind === 'delete' || !operation.content) continue

    const segments = operation.path.replace(/^\/+/, '').split('/')
    let current = root

    for (let index = 0; index < segments.length; index++) {
      const segment = segments[index]
      const isFile = index === segments.length - 1
      const existing = current.find(node => node.name === segment && node.isDir === !isFile)

      if (existing) {
        if (!isFile) current = existing.children
      } else {
        const newNode: FileTreeNode = {
          name: segment,
          path: segments.slice(0, index + 1).join('/'),
          isDir: !isFile,
          children: [],
          operationKind: isFile ? operation.kind : undefined,
        }
        current.push(newNode)
        if (!isFile) current = newNode.children
      }
    }
  }

  return sortTree(root)
}

function sortTree(nodes: FileTreeNode[]): FileTreeNode[] {
  return nodes
    .map(node => ({
      ...node,
      children: sortTree(node.children),
    }))
    .sort((a, b) => {
      // Directories before files
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
}

function collectFilePaths(nodes: FileTreeNode[]): string[] {
  const paths: string[] = []
  for (const node of nodes) {
    if (node.isDir) {
      paths.push(...collectFilePaths(node.children))
    } else {
      paths.push(node.path)
    }
  }
  return paths
}

function languageFromPath(path: string): string {
  const extension = path.split('.').at(-1)?.toLowerCase() ?? ''
  switch (extension) {
    case 'ts':
    case 'tsx':
      return 'typescript'
    case 'js':
    case 'jsx':
      return 'javascript'
    case 'json':
      return 'json'
    case 'css':
      return 'css'
    case 'html':
      return 'html'
    case 'md':
    case 'mdx':
      return 'markdown'
    case 'yaml':
    case 'yml':
      return 'yaml'
    case 'xml':
    case 'svg':
      return 'xml'
    case 'scss':
    case 'less':
      return 'css'
    case 'sh':
    case 'bash':
      return 'shell'
    case 'sql':
      return 'sql'
    default:
      return 'plaintext'
  }
}

function FileTreeItem({
  node,
  depth,
  activePath,
  expandedDirs,
  onToggleDir,
  onSelectFile,
}: {
  node: FileTreeNode
  depth: number
  activePath: string
  expandedDirs: Set<string>
  onToggleDir: (path: string) => void
  onSelectFile: (path: string) => void
}): JSX.Element {
  const isExpanded = expandedDirs.has(node.path)
  const isActive = node.path === activePath

  if (node.isDir) {
    return (
      <div>
        <button
          type="button"
          onClick={() => { onToggleDir(node.path) }}
          className={cn(
            'flex w-full items-center gap-1 rounded-sm px-2 py-1 text-left text-xs transition-colors hover:bg-accent/50',
            isActive && 'bg-accent/30',
          )}
          style={{ paddingLeft: `${String(depth * 12 + 8)}px` }}
        >
          <ChevronRight
            size={12}
            className={cn(
              'shrink-0 text-muted-foreground transition-transform',
              isExpanded && 'rotate-90',
            )}
          />
          <FolderOpen size={13} className="shrink-0 text-amber-500/80" />
          <span className="min-w-0 truncate text-muted-foreground">{node.name}</span>
        </button>
        {isExpanded && (
          <div>
            {node.children.map(child => (
              <FileTreeItem
                key={child.path}
                node={child}
                depth={depth + 1}
                activePath={activePath}
                expandedDirs={expandedDirs}
                onToggleDir={onToggleDir}
                onSelectFile={onSelectFile}
              />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={() => { onSelectFile(node.path) }}
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs transition-colors',
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
      )}
      style={{ paddingLeft: `${String(depth * 12 + 8)}px` }}
    >
      <FileCode2 size={13} className="shrink-0 opacity-60" />
      <span className="min-w-0 truncate">{node.name}</span>
      {node.operationKind && (
        <span className="ml-auto shrink-0 rounded bg-surface-soft px-1 py-px text-[9px] text-muted-foreground">
          {node.operationKind}
        </span>
      )}
    </button>
  )
}

export function DesignCodeEditor({
  operations,
  code,
  codePath,
  selectedPath,
  onSelectFile,
}: DesignCodeEditorProps): JSX.Element {
  // Normalize inputs: patch operations take priority; fall back to single-file code.
  const effectiveOperations = useMemo<DesignPatchFileOperation[]>(() => {
    const ops = operations?.filter(operation => operation.kind !== 'delete' && operation.content)
    if (ops && ops.length > 0) return ops
    if (code) {
      const virtualPath = codePath?.replace(/^\/+/, '') || 'source.tsx'
      return [{ kind: 'add', path: virtualPath, content: code }]
    }
    return []
  }, [code, codePath, operations])

  const tree = useMemo(() => buildFileTree(effectiveOperations), [effectiveOperations])
  const allPaths = useMemo(() => collectFilePaths(tree), [tree])
  const filesMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const operation of effectiveOperations) {
      map.set(operation.path.replace(/^\/+/, ''), operation.content ?? '')
    }
    return map
  }, [effectiveOperations])

  const isSingleFile = allPaths.length <= 1

  const [activePath, setActivePath] = useState<string>(() => {
    if (selectedPath) return selectedPath.replace(/^\/+/, '')
    return allPaths[0] ?? ''
  })
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => {
    const dirs = new Set<string>()
    for (const path of allPaths) {
      const segments = path.split('/')
      for (let index = 1; index < segments.length; index++) {
        dirs.add(segments.slice(0, index).join('/'))
      }
    }
    return dirs
  })
  const [sidebarCollapsed, setSidebarCollapsed] = useState(isSingleFile)

  const activeContent = filesMap.get(activePath)
  const language = useMemo(() => languageFromPath(activePath), [activePath])

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(dirPath)) {
        next.delete(dirPath)
      } else {
        next.add(dirPath)
      }
      return next
    })
  }, [])

  const handleSelectFile = useCallback((path: string) => {
    setActivePath(path)
    onSelectFile?.(path)
  }, [onSelectFile])

  if (effectiveOperations.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        No files to display
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-md border border-border bg-card shadow-sm">
      {!sidebarCollapsed && (
        <aside className="flex w-56 shrink-0 flex-col border-r border-border bg-surface-soft/40">
          <div className="shrink-0 border-b border-border px-3 py-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-medium text-muted-foreground">
                文件
                <span className="ml-1 text-[10px]">({String(allPaths.length)})</span>
              </div>
              <button
                type="button"
                aria-label="Collapse file tree"
                onClick={() => { setSidebarCollapsed(true) }}
                className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <ChevronRight size={12} className="rotate-90" />
              </button>
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            {tree.map(node => (
              <FileTreeItem
                key={node.path}
                node={node}
                depth={0}
                activePath={activePath}
                expandedDirs={expandedDirs}
                onToggleDir={handleToggleDir}
                onSelectFile={handleSelectFile}
              />
            ))}
          </div>
        </aside>
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-border bg-background/80 px-3">
          {sidebarCollapsed && (
            <button
              type="button"
              aria-label="Expand file tree"
              onClick={() => { setSidebarCollapsed(false) }}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <ChevronRight size={12} />
            </button>
          )}
          <FileCode2 size={13} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 truncate font-mono text-xs text-muted-foreground">
            {activePath || 'No file selected'}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          {activeContent ? (
            <Editor
              height="100%"
              language={language}
              value={activeContent}
              theme="vs-dark"
              options={{
                readOnly: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                fontSize: 13,
                lineNumbers: 'on',
                renderLineHighlight: 'line',
                padding: { top: 8, bottom: 8 },
                overviewRulerBorder: false,
                hideCursorInOverviewRuler: true,
                overviewRulerLanes: 0,
                scrollbar: {
                  verticalScrollbarSize: 8,
                  horizontalScrollbarSize: 8,
                },
                domReadOnly: true,
                wordWrap: 'on',
                automaticLayout: true,
              }}
            />
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
              {activePath ? '此文件无内容' : '选择一个文件以查看代码'}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
