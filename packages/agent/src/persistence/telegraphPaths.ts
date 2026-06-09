import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const WORKSPACE_MARKERS = ['pnpm-workspace.yaml', 'pnpm-workspace.yml'] as const

/**
 * Resolve the Telegraph monorepo / workspace root.
 *
 * Electron Forge runs from `apps/main`, so `process.cwd()` alone points at the
 * app package instead of the repository root. Pi stores sessions under an
 * encoded workspace path; Telegraph keeps workspace-local state under
 * `<workspaceRoot>/.telegraph/`.
 */
export function resolveTelegraphWorkspaceRoot(startDir = process.cwd()): string {
  const envRoot = process.env.TELEGRAPH_WORKSPACE_ROOT?.trim()
  if (envRoot) return resolve(envRoot)

  let current = resolve(startDir)
  while (true) {
    if (WORKSPACE_MARKERS.some(marker => existsSync(join(current, marker)))) {
      return current
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }

  return resolve(startDir)
}

/** Workspace-local Telegraph state directory (`.telegraph/` at repo root). */
export function resolveTelegraphDataDir(startDir = process.cwd()): string {
  const envDataDir = process.env.TELEGRAPH_DATA_DIR?.trim()
  if (envDataDir) return resolve(envDataDir)
  return join(resolveTelegraphWorkspaceRoot(startDir), '.telegraph')
}

/** Encode a workspace path for session-scoped directory names. */
export function encodeTelegraphWorkspaceSegment(workspaceRoot: string): string {
  const encoded = resolve(workspaceRoot).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')
  return `--${encoded}--`
}

export function resolveTelegraphAgentSessionsDir(startDir = process.cwd()): string {
  const envSessionsDir = process.env.TELEGRAPH_AGENT_SESSIONS_DIR?.trim()
  if (envSessionsDir) return resolve(envSessionsDir)

  const envAgentDir = process.env.TELEGRAPH_AGENT_DIR?.trim()
  const agentDir = envAgentDir ? resolve(envAgentDir) : join(homedir(), '.telegraph', 'agent')
  const workspaceRoot = resolveTelegraphWorkspaceRoot(startDir)
  return join(agentDir, 'sessions', encodeTelegraphWorkspaceSegment(workspaceRoot))
}

export function resolveTelegraphRunsDir(
  pagelet: 'chat' | 'design' | 'runs' = 'runs',
  startDir = process.cwd(),
): string {
  const base = resolveTelegraphDataDir(startDir)
  if (pagelet === 'chat') return join(base, 'runs')
  if (pagelet === 'design') return join(base, 'design-runs')
  return join(base, 'runs')
}
