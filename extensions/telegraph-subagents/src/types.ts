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
  /** Human-facing display title. */
  title?: string
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
  /** Contribution origin for trace/debug UI. */
  origin?: {
    extensionId: string
    contributionId: string
    fullId: string
    sourceKind: string
    sourcePath?: string
    rootPath?: string
  }
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
// Team Router v0
// ---------------------------------------------------------------------------

export interface TeamSpec {
  id: string
  label: string
  members: TeamMemberSpec[]
  router: TeamRouterSpec
  policies?: TeamPolicySpec
}

export interface TeamMemberSpec {
  id: string
  role: 'scout' | 'planner' | 'worker' | 'reviewer' | 'custom'
  label: string
  description?: string
  agent: string
  defaultRuntime?: string
  allowedTools?: string[]
  handoffContract?: string
}

export interface TeamRouterSpec {
  id: string
  strategy: 'model-router-v0'
  allowedDecisions: TeamRouteDecision['kind'][]
}

export interface TeamPolicySpec {
  maxParallel?: number
  requireReviewFor?: Array<'filesystem' | 'shell' | 'patch' | 'high-risk'>
}

export type TeamRouteDecision =
  | { kind: 'direct'; reason: string }
  | { kind: 'clarify'; question: string; reason: string }
  | { kind: 'single'; memberId: string; task: string; reason: string }
  | { kind: 'parallel'; tasks: TeamRouteTask[]; reason: string }
  | { kind: 'review'; workerTask: string; reviewerTask: string; reason: string }

export interface TeamRouteTask {
  memberId: string
  task: string
  label?: string
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

// ---------------------------------------------------------------------------
// Subagent lifecycle records
// ---------------------------------------------------------------------------

export type SubagentStatus = 'queued' | 'running' | 'completed' | 'stopped' | 'error'

export interface SubagentRecord {
  id: string
  parentRunId: string
  sessionId?: string
  agent: string
  label: string
  description: string
  task: string
  status: SubagentStatus
  result?: string
  error?: string
  toolUses: number
  startedAt: number
  completedAt?: number
  abortController: AbortController
  resultConsumed?: boolean
  sourcePath?: string
  origin?: SubagentDefinition['origin']
}
