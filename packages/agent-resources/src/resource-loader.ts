import {
  existsSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  loadSkills,
  resolveSkillSearchRoot,
  type LoadSkillsResult,
  type Skill,
  type SkillDiagnostic,
} from './skills'

export type ResourceSourceKind = 'builtin' | 'user' | 'workspace' | 'extension' | 'run' | 'temporary' | 'custom'

export interface ResourcePathMetadata {
  sourceKind: ResourceSourceKind
  extensionId?: string
  contributionId?: string
  baseDir?: string
  origin?: string
}

export interface ResourcePathEntry {
  path: string
  metadata?: ResourcePathMetadata
}

export interface ResourceExtensionPaths {
  skillPaths?: ResourcePathEntry[]
  contextFilePaths?: ResourcePathEntry[]
  systemPromptPaths?: ResourcePathEntry[]
  appendSystemPromptPaths?: ResourcePathEntry[]
}

export interface LoadedContextFile {
  path: string
  content: string
  metadata?: ResourcePathMetadata
}

export interface TextResource {
  path: string
  content: string
  metadata?: ResourcePathMetadata
}

export type AgentResourceDiagnostic = SkillDiagnostic | {
  type: 'warning'
  message: string
  path: string
}

export interface AgentResourceSnapshot {
  skills: Skill[]
  contextFiles: LoadedContextFile[]
  systemPrompt?: TextResource
  appendSystemPrompts: TextResource[]
  diagnostics: AgentResourceDiagnostic[]
}

export interface AgentResourceLoader {
  reload(): Promise<AgentResourceSnapshot>
  snapshot(): AgentResourceSnapshot
  getSkills(): LoadSkillsResult
  getContextFiles(): { contextFiles: LoadedContextFile[]; diagnostics: AgentResourceDiagnostic[] }
  getSystemPrompt(): TextResource | undefined
  getAppendSystemPrompts(): TextResource[]
  extendResources(paths: ResourceExtensionPaths): Promise<AgentResourceSnapshot>
}

export interface DefaultAgentResourceLoaderOptions {
  cwd: string
  globalDir?: string
  skillPaths?: ResourcePathEntry[]
  contextFilePaths?: ResourcePathEntry[]
  systemPromptPath?: string
  appendSystemPromptPaths?: ResourcePathEntry[]
  includeProjectContext?: boolean
  projectTrusted?: boolean
}

const CONTEXT_FILE_NAMES = ['AGENTS.md', 'AGENTS.MD', 'CLAUDE.md', 'CLAUDE.MD']

export class DefaultAgentResourceLoader implements AgentResourceLoader {
  private readonly cwd: string
  private readonly resourceRoot: string
  private readonly globalDir?: string
  private readonly includeProjectContext: boolean
  private readonly projectTrusted: boolean
  private skillPaths: ResourcePathEntry[]
  private contextFilePaths: ResourcePathEntry[]
  private systemPromptPath?: string
  private appendSystemPromptPaths: ResourcePathEntry[]
  private current: AgentResourceSnapshot = emptySnapshot()
  private currentSkillDiagnostics: SkillDiagnostic[] = []
  private currentResourceDiagnostics: AgentResourceDiagnostic[] = []

  constructor(options: DefaultAgentResourceLoaderOptions) {
    this.cwd = resolve(options.cwd)
    this.resourceRoot = resolveSkillSearchRoot(this.cwd)
    this.globalDir = options.globalDir ? resolve(options.globalDir) : undefined
    this.skillPaths = normalizeEntries(this.cwd, options.skillPaths ?? [])
    this.contextFilePaths = normalizeEntries(this.cwd, options.contextFilePaths ?? [])
    this.systemPromptPath = options.systemPromptPath ? resolvePath(this.cwd, options.systemPromptPath) : undefined
    this.appendSystemPromptPaths = normalizeEntries(this.cwd, options.appendSystemPromptPaths ?? [])
    this.includeProjectContext = options.includeProjectContext ?? true
    this.projectTrusted = options.projectTrusted ?? true
  }

  async reload(): Promise<AgentResourceSnapshot> {
    const skillResult = loadSkills({
      cwd: this.resourceRoot,
      globalDir: this.globalDir,
      skillPaths: this.skillPaths.map(entry => entry.path),
    })
    const contextResult = this.loadContextFiles()
    const resourceDiagnostics: AgentResourceDiagnostic[] = [...contextResult.diagnostics]
    const systemPrompt = this.systemPromptPath
      ? this.loadTextResource({ path: this.systemPromptPath })
      : undefined
    if (systemPrompt?.diagnostic) resourceDiagnostics.push(systemPrompt.diagnostic)

    const appendSystemPrompts: TextResource[] = []
    for (const entry of this.appendSystemPromptPaths) {
      const loaded = this.loadTextResource(entry)
      if (loaded.resource) appendSystemPrompts.push(loaded.resource)
      if (loaded.diagnostic) resourceDiagnostics.push(loaded.diagnostic)
    }

    this.currentSkillDiagnostics = [...skillResult.diagnostics]
    this.currentResourceDiagnostics = resourceDiagnostics
    this.current = {
      skills: skillResult.skills,
      contextFiles: contextResult.contextFiles,
      systemPrompt: systemPrompt?.resource,
      appendSystemPrompts,
      diagnostics: [...skillResult.diagnostics, ...resourceDiagnostics],
    }
    return this.snapshot()
  }

  snapshot(): AgentResourceSnapshot {
    return {
      skills: [...this.current.skills],
      contextFiles: this.current.contextFiles.map(file => ({ ...file })),
      systemPrompt: this.current.systemPrompt ? { ...this.current.systemPrompt } : undefined,
      appendSystemPrompts: this.current.appendSystemPrompts.map(prompt => ({ ...prompt })),
      diagnostics: [...this.current.diagnostics],
    }
  }

  getSkills(): LoadSkillsResult {
    return {
      skills: [...this.current.skills],
      diagnostics: [...this.currentSkillDiagnostics],
    }
  }

  getContextFiles(): { contextFiles: LoadedContextFile[]; diagnostics: AgentResourceDiagnostic[] } {
    return {
      contextFiles: this.current.contextFiles.map(file => ({ ...file })),
      diagnostics: [...this.currentResourceDiagnostics],
    }
  }

  getSystemPrompt(): TextResource | undefined {
    return this.current.systemPrompt ? { ...this.current.systemPrompt } : undefined
  }

  getAppendSystemPrompts(): TextResource[] {
    return this.current.appendSystemPrompts.map(prompt => ({ ...prompt }))
  }

  async extendResources(paths: ResourceExtensionPaths): Promise<AgentResourceSnapshot> {
    this.skillPaths = mergeEntries(this.skillPaths, normalizeEntries(this.cwd, paths.skillPaths ?? []))
    this.contextFilePaths = mergeEntries(this.contextFilePaths, normalizeEntries(this.cwd, paths.contextFilePaths ?? []))
    this.appendSystemPromptPaths = mergeEntries(
      this.appendSystemPromptPaths,
      normalizeEntries(this.cwd, paths.appendSystemPromptPaths ?? []),
    )
    const systemPrompt = paths.systemPromptPaths?.at(-1)
    if (systemPrompt) {
      this.systemPromptPath = resolvePath(this.cwd, systemPrompt.path)
    }
    return this.reload()
  }

  private loadContextFiles(): { contextFiles: LoadedContextFile[]; diagnostics: AgentResourceDiagnostic[] } {
    const diagnostics: AgentResourceDiagnostic[] = []
    const files = new Map<string, LoadedContextFile>()

    if (this.includeProjectContext && this.projectTrusted) {
      for (const file of discoverProjectContextFiles(this.cwd)) {
        files.set(file.path, file)
      }
    }

    for (const entry of this.contextFilePaths) {
      const loaded = this.loadTextResource(entry)
      if (loaded.resource) {
        files.set(loaded.resource.path, {
          path: loaded.resource.path,
          content: loaded.resource.content,
          metadata: loaded.resource.metadata,
        })
      }
      if (loaded.diagnostic) diagnostics.push(loaded.diagnostic)
    }

    return {
      contextFiles: [...files.values()],
      diagnostics,
    }
  }

  private loadTextResource(entry: ResourcePathEntry): {
    resource?: TextResource
    diagnostic?: AgentResourceDiagnostic
  } {
    const path = resolvePath(this.cwd, entry.path)
    if (!existsSync(path)) {
      return {
        diagnostic: {
          type: 'warning',
          message: 'resource path does not exist',
          path,
        },
      }
    }

    try {
      const stats = statSync(path)
      if (!stats.isFile()) {
        return {
          diagnostic: {
            type: 'warning',
            message: 'resource path is not a file',
            path,
          },
        }
      }
      return {
        resource: {
          path,
          content: readFileSync(path, 'utf-8'),
          metadata: entry.metadata,
        },
      }
    } catch (error) {
      return {
        diagnostic: {
          type: 'warning',
          message: error instanceof Error ? error.message : 'failed to read resource',
          path,
        },
      }
    }
  }
}

export function discoverProjectContextFiles(cwd: string): LoadedContextFile[] {
  const resolvedCwd = resolve(cwd)
  const files: LoadedContextFile[] = []
  const seen = new Set<string>()
  let current = resolvedCwd

  for (;;) {
    for (const filename of CONTEXT_FILE_NAMES) {
      const path = join(current, filename)
      if (!existsSync(path) || seen.has(path)) continue
      try {
        const stats = statSync(path)
        if (!stats.isFile()) continue
        files.unshift({
          path,
          content: readFileSync(path, 'utf-8'),
        })
        seen.add(path)
        break
      } catch {
        // Ignore unreadable context files; explicit paths report diagnostics.
      }
    }

    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return files
}

function normalizeEntries(cwd: string, entries: ResourcePathEntry[]): ResourcePathEntry[] {
  return entries.map(entry => ({
    ...entry,
    path: resolvePath(cwd, entry.path),
  }))
}

function mergeEntries(current: ResourcePathEntry[], next: ResourcePathEntry[]): ResourcePathEntry[] {
  const merged = new Map<string, ResourcePathEntry>()
  for (const entry of [...current, ...next]) {
    merged.set(entry.path, entry)
  }
  return [...merged.values()]
}

function resolvePath(cwd: string, path: string): string {
  return resolve(cwd, path.trim())
}

function emptySnapshot(): AgentResourceSnapshot {
  return {
    skills: [],
    contextFiles: [],
    appendSystemPrompts: [],
    diagnostics: [],
  }
}
