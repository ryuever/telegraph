/**
 * Agent discovery for Telegraph native subagents.
 *
 * Discovers agent definitions from three scopes (lowest -> highest priority):
 * 1. Builtin: Telegraph fallback agents
 * 2. User:    ~/.telegraph/agents/**\/*.md
 * 3. Project: .telegraph/agents/**\/*.md
 *
 * Higher-priority scopes override lower-priority ones by agent name.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  ContributionRegistry,
  parseHarnessExtensionManifest,
  type HarnessContributionSnapshot,
  type ResolvedAgentContribution,
} from '@/packages/agent/extensions/harness'
import { parseAgentFile } from './agentParser'
import type { SubagentDefinition, SubagentScope } from './types'

// ---------------------------------------------------------------------------
// Discovery options
// ---------------------------------------------------------------------------

export interface DiscoveryOptions {
  /** Working directory for project-scoped agents. Defaults to `process.cwd()`. */
  cwd?: string
  /** Root directory for the @telegraph/subagents extension package. */
  extensionRoot?: string
  /** Restrict discovery to specific scopes. Defaults to all three. */
  scopes?: SubagentScope[]
  /** Extra directories to scan (useful for testing). */
  extraDirs?: Array<{ path: string; scope: SubagentScope }>
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Discover all available agent definitions across scopes.
 * Returns a map keyed by runtime name (or `package.name` if package is set).
 */
export function discoverAgents(opts: DiscoveryOptions = {}): Map<string, SubagentDefinition> {
  return subagentDefinitionsFromSnapshot(createTelegraphSubagentsSnapshot(opts))
}

export function createTelegraphSubagentsSnapshot(opts: DiscoveryOptions = {}): HarnessContributionSnapshot {
  const scopes = opts.scopes ?? ['builtin', 'user', 'project']
  const registry = new ContributionRegistry()

  if (scopes.includes('builtin')) {
    registry.registerManifest(loadPackageManifest(opts.extensionRoot ?? defaultExtensionRoot()), {
      rootPath: opts.extensionRoot ?? defaultExtensionRoot(),
      sourceKind: 'builtin',
    })
  }

  if (scopes.includes('user')) {
    const userDir = join(homedir(), '.telegraph', 'agents')
    const manifest = createProfileSourceManifest('@telegraph/user-agents', userDir, 'user')
    if (manifest) {
      registry.registerManifest(manifest, { rootPath: userDir, sourceKind: 'user' })
    }
  }

  if (scopes.includes('project')) {
    const cwd = opts.cwd ?? process.cwd()
    const projectDir = join(cwd, '.telegraph', 'agents')
    const manifest = createProfileSourceManifest('@telegraph/workspace-agents', projectDir, 'project')
    if (manifest) {
      registry.registerManifest(manifest, { rootPath: projectDir, sourceKind: 'workspace' })
    }
  }

  if (opts.extraDirs) {
    for (const { path, scope } of opts.extraDirs) {
      const manifest = createProfileSourceManifest(`@telegraph/${scope}-test-agents`, path, scope)
      if (manifest) {
        registry.registerManifest(manifest, {
          rootPath: path,
          sourceKind: sourceKindForScope(scope),
        })
      }
    }
  }

  return registry.createSnapshot()
}

export function subagentDefinitionsFromSnapshot(snapshot: HarnessContributionSnapshot): Map<string, SubagentDefinition> {
  const agents = new Map<string, SubagentDefinition>()
  for (const contribution of snapshot.agents) {
    const definition = contributionToDefinition(contribution)
    agents.set(runtimeName(definition), definition)
  }
  return agents
}

/**
 * Resolve a single agent by runtime name.
 * Returns `undefined` if not found.
 */
export function resolveAgent(
  name: string,
  opts: DiscoveryOptions = {},
): SubagentDefinition | undefined {
  const all = discoverAgents(opts)
  return all.get(name)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function runtimeName(agent: SubagentDefinition): string {
  return agent.package ? `${agent.package}.${agent.name}` : agent.name
}

function createProfileSourceManifest(extensionId: string, dir: string, scope: SubagentScope) {
  if (!existsSync(dir)) return undefined

  const agents = scanDirectory(dir, scope)
  if (agents.length === 0) return undefined

  return {
    id: extensionId,
    displayName: extensionId,
    version: '0.1.0',
    contributes: {
      agents: agents.map(agent => ({
        id: runtimeName(agent),
        title: agent.name,
        description: agent.description ?? `${agent.name} subagent profile`,
        prompt: agent.sourcePath ? relativePromptPath(dir, agent.sourcePath) : `${agent.name}.md`,
        tools: agent.tools,
        runner: 'embedded-kernel',
        metadata: {
          name: agent.name,
          package: agent.package,
          model: agent.model,
          fallbackModels: agent.fallbackModels,
          thinking: agent.thinking,
          systemPromptMode: agent.systemPromptMode,
          inheritProjectContext: agent.inheritProjectContext,
          inheritSkills: agent.inheritSkills,
          defaultContext: agent.defaultContext,
          output: agent.output,
          defaultReads: agent.defaultReads,
          defaultProgress: agent.defaultProgress,
          skills: agent.skills,
          scope,
        },
      })),
    },
  }
}

function scanDirectory(dir: string, scope: SubagentScope): SubagentDefinition[] {
  if (!existsSync(dir)) return []

  const agents: SubagentDefinition[] = []

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        // Recurse into subdirectories
        agents.push(...scanDirectory(fullPath, scope))
      } else if (entry.isFile() && entry.name.endsWith('.md') && !entry.name.endsWith('.chain.md')) {
        try {
          const content = readFileSync(fullPath, 'utf-8')
          const parsed = parseAgentFile(content, scope, fullPath)
          if (parsed) {
            agents.push(parsed)
          }
        } catch {
          // Skip files that can't be read/parsed
        }
      }
    }
  } catch {
    // Directory not readable
  }

  return agents
}

function contributionToDefinition(contribution: ResolvedAgentContribution): SubagentDefinition {
  const metadata = contribution.metadata ?? {}
  const promptPath = contribution.promptPath ?? contribution.origin.sourcePath
  const systemPrompt = promptPath && existsSync(promptPath)
    ? readPromptBody(promptPath)
    : contribution.prompt
  return {
    name: typeof metadata.name === 'string' ? metadata.name : contribution.alias,
    package: typeof metadata.package === 'string' ? metadata.package : undefined,
    description: contribution.description,
    tools: contribution.tools,
    model: typeof metadata.model === 'string' ? metadata.model : undefined,
    fallbackModels: stringArray(metadata.fallbackModels),
    thinking: isThinking(metadata.thinking) ? metadata.thinking : undefined,
    systemPromptMode: metadata.systemPromptMode === 'append' ? 'append' : 'replace',
    inheritProjectContext: metadata.inheritProjectContext === true,
    inheritSkills: metadata.inheritSkills === true,
    defaultContext: metadata.defaultContext === 'fork' ? 'fork' : 'fresh',
    output: typeof metadata.output === 'string' ? metadata.output : undefined,
    defaultReads: stringArray(metadata.defaultReads),
    defaultProgress: metadata.defaultProgress === true,
    skills: stringArray(metadata.skills),
    systemPrompt,
    scope: toSubagentScope(contribution.origin.sourceKind),
    sourcePath: promptPath ?? contribution.origin.sourcePath,
    origin: contribution.origin,
  }
}

function loadPackageManifest(rootPath: string) {
  const raw = readFileSync(join(rootPath, 'telegraph.extension.json'), 'utf8')
  return parseHarnessExtensionManifest(JSON.parse(raw))
}

function readPromptBody(path: string): string {
  const parsed = parseAgentFile(readFileSync(path, 'utf8'), 'builtin', path)
  return parsed?.systemPrompt ?? readFileSync(path, 'utf8').trim()
}

function defaultExtensionRoot(): string {
  const sourceRoot = dirname(dirname(fileURLToPath(import.meta.url)))
  const candidates = [
    sourceRoot,
    join(process.cwd(), 'extensions', 'telegraph-subagents'),
    join(process.cwd(), '..', '..', 'extensions', 'telegraph-subagents'),
  ]
  return candidates.find(path => existsSync(join(path, 'telegraph.extension.json'))) ?? sourceRoot
}

function relativePromptPath(root: string, path: string): string {
  return path.startsWith(root) ? path.slice(root.length).replace(/^[/\\]/, '') : path
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string') ? value : undefined
}

function isThinking(value: unknown): value is SubagentDefinition['thinking'] {
  return value === 'off' ||
    value === 'minimal' ||
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh'
}

function toSubagentScope(kind: 'builtin' | 'user' | 'workspace' | 'run'): SubagentScope {
  if (kind === 'workspace' || kind === 'run') return 'project'
  return kind
}

function sourceKindForScope(scope: SubagentScope): 'builtin' | 'user' | 'workspace' {
  return scope === 'project' ? 'workspace' : scope
}
