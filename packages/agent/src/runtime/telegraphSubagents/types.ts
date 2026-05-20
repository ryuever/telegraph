/**
 * Telegraph native subagent harness types.
 *
 * These types describe Telegraph-owned agent definitions using markdown
 * frontmatter plus a system prompt body.
 */

// ---------------------------------------------------------------------------
// Agent definition (parsed from .md frontmatter + body)
// ---------------------------------------------------------------------------

export interface SubagentDefinition {
  /** Agent name used in chain/parallel references. */
  name: string
  /** Optional package namespace (runtime name = `package.name`). */
  package?: string
  description?: string
  /** Builtin tool allowlist (e.g. `['read', 'grep', 'bash']`). */
  tools?: string[]
  /** Model override (e.g. `anthropic/claude-sonnet-4`). */
  model?: string
  /** Ordered fallback models for provider failures. */
  fallbackModels?: string[]
  /** Extended thinking level. */
  thinking?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
  /** How the system prompt is applied relative to the base prompt. */
  systemPromptMode?: 'replace' | 'append'
  /** Whether to inherit project context (AGENTS.md, CLAUDE.md, etc.). */
  inheritProjectContext?: boolean
  /** Whether to inherit Pi's discovered skills catalog. */
  inheritSkills?: boolean
  /** Default context strategy when launched without explicit context. */
  defaultContext?: 'fresh' | 'fork'
  /** Default output file for single-agent runs. */
  output?: string
  /** Files to read before running (for chain handoff). */
  defaultReads?: string[]
  /** Whether to maintain progress.md. */
  defaultProgress?: boolean
  /** Skills to inject into the system prompt. */
  skills?: string[]
  /** The system prompt body (markdown after frontmatter). */
  systemPrompt: string
  /** Source scope. */
  scope: SubagentScope
  /** File path this definition was loaded from (for debugging). */
  sourcePath?: string
}

export type SubagentScope = 'builtin' | 'user' | 'project'

// ---------------------------------------------------------------------------
// Agent overrides (from settings.json)
// ---------------------------------------------------------------------------

export interface SubagentOverrides {
  model?: string
  fallbackModels?: string[]
  thinking?: string
  systemPromptMode?: 'replace' | 'append'
  inheritProjectContext?: boolean
  inheritSkills?: boolean
  defaultContext?: 'fresh' | 'fork'
  disabled?: boolean
  skills?: string[]
  tools?: string
  systemPrompt?: string
}

// ---------------------------------------------------------------------------
// Orchestration input
// ---------------------------------------------------------------------------

export type SubagentExecutionMode = 'single' | 'chain' | 'parallel'

/** Top-level orchestration request selected by the parent model's subagent tool call. */
export interface SubagentOrchestratorInput {
  mode: SubagentExecutionMode
  /** User task / message. */
  task: string
  /** For single mode: which agent to run. */
  agent?: string
  /** For chain mode: ordered steps. */
  chain?: SubagentChainStep[]
  /** For parallel mode: concurrent tasks. */
  tasks?: SubagentParallelTask[]
  /** Context strategy. */
  context?: 'fresh' | 'fork'
  /** Parallel concurrency limit. */
  concurrency?: number
}

export interface SubagentChainStep {
  agent: string
  label?: string
  task?: string
  /** Parallel fan-out within a chain step. */
  parallel?: SubagentParallelTask[]
  output?: string
  reads?: string[]
  model?: string
  skills?: string[]
}

export interface SubagentParallelTask {
  agent: string
  label?: string
  task?: string
  /** Replicate this task N times. */
  count?: number
  output?: string
  reads?: string[]
  model?: string
  skills?: string[]
}

// ---------------------------------------------------------------------------
// Child run result (internal)
// ---------------------------------------------------------------------------

export interface SubagentChildResult {
  agent: string
  childRunId: string
  text: string
  exitCode: number
  durationMs: number
}
