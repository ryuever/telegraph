/**
 * Agent discovery for Telegraph native subagents.
 *
 * Discovers agent definitions from three scopes (lowest → highest priority):
 * 1. Builtin: Telegraph fallback agents
 * 2. User:    ~/.telegraph/agents/**\/*.md
 * 3. Project: .telegraph/agents/**\/*.md
 *
 * Higher-priority scopes override lower-priority ones by agent name.
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parseAgentFile } from './agentParser'
import type { SubagentDefinition, SubagentScope } from './types'
import { createTelegraphBuiltinAgents } from './builtinAgents'

// ---------------------------------------------------------------------------
// Discovery options
// ---------------------------------------------------------------------------

export interface DiscoveryOptions {
  /** Working directory for project-scoped agents. Defaults to `process.cwd()`. */
  cwd?: string
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
  const scopes = opts.scopes ?? ['builtin', 'user', 'project']
  const agents = new Map<string, SubagentDefinition>()

  // Builtin agents (lowest priority)
  if (scopes.includes('builtin')) {
    for (const agent of createTelegraphBuiltinAgents()) {
      agents.set(runtimeName(agent), agent)
    }
  }

  // User agents
  if (scopes.includes('user')) {
    const userDir = join(homedir(), '.telegraph', 'agents')
    for (const agent of scanDirectory(userDir, 'user')) {
      agents.set(runtimeName(agent), agent)
    }
  }

  // Project agents (highest priority)
  if (scopes.includes('project')) {
    const cwd = opts.cwd ?? process.cwd()
    for (const agent of scanDirectory(join(cwd, '.telegraph', 'agents'), 'project')) {
      agents.set(runtimeName(agent), agent)
    }
  }

  // Extra dirs (testing)
  if (opts.extraDirs) {
    for (const { path, scope } of opts.extraDirs) {
      for (const agent of scanDirectory(path, scope)) {
        agents.set(runtimeName(agent), agent)
      }
    }
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

function scanDirectory(dir: string, scope: SubagentScope): SubagentDefinition[] {
  if (!existsSync(dir)) return []

  const agents: SubagentDefinition[] = []

  try {
    const entries = readdirSync(dir, { withFileTypes: true })
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
