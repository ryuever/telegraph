import type { HarnessContributionSnapshot } from '@/packages/agent-extensions'
import { agentAliasList } from '@/packages/agent-extensions'
import type {
  SubagentOrchestratorInput,
  TeamMemberSpec,
  TeamRouteDecision,
  TeamSpec,
} from './types'

export function createDefaultTeamSpec(snapshot: HarnessContributionSnapshot): TeamSpec {
  const members = agentAliasList(snapshot).map(alias => teamMemberFromAlias(alias))
  return {
    id: 'telegraph-default-team',
    label: 'Telegraph Default Team',
    members,
    router: {
      id: 'telegraph-default-router',
      strategy: 'model-router-v0',
      allowedDecisions: ['direct', 'clarify', 'single', 'parallel', 'review'],
    },
    policies: {
      maxParallel: 4,
      requireReviewFor: ['filesystem', 'shell', 'patch', 'high-risk'],
    },
  }
}

export function routeDecisionFromOrchestratorInput(
  input: SubagentOrchestratorInput | undefined,
  team: TeamSpec,
  originalTask: string,
  reason = 'Model router selected a team route.',
): TeamRouteDecision {
  if (!input) {
    return {
      kind: 'direct',
      reason: 'Router did not delegate; answer directly in the parent run.',
    }
  }

  if (input.mode === 'single' && input.agent) {
    return {
      kind: 'single',
      memberId: memberIdForAgent(team, input.agent),
      task: input.task || originalTask,
      reason,
    }
  }

  if (input.mode === 'parallel' && input.tasks?.length) {
    return {
      kind: 'parallel',
      tasks: input.tasks.map(task => ({
        memberId: memberIdForAgent(team, task.agent),
        task: task.task || input.task || originalTask,
        label: task.label,
      })),
      reason,
    }
  }

  if (input.mode === 'chain' && input.chain?.length) {
    const worker = input.chain.find(step => roleForAgent(step.agent) === 'worker') ?? input.chain.at(-1)
    const reviewer = input.chain.find(step => roleForAgent(step.agent) === 'reviewer')
    if (worker && reviewer) {
      return {
        kind: 'review',
        workerTask: worker.task || input.task || originalTask,
        reviewerTask: reviewer.task || 'Review the worker output for correctness, regressions, and gaps.',
        reason,
      }
    }
    return {
      kind: 'single',
      memberId: memberIdForAgent(team, input.chain[0].agent),
      task: input.chain[0].task || input.task || originalTask,
      reason: `${reason} Chain route collapsed to the first specialist for Team Router v0 display.`,
    }
  }

  return {
    kind: 'direct',
    reason: 'Router produced no executable team route; answer directly in the parent run.',
  }
}

export function orchestratorInputFromRouteDecision(
  decision: TeamRouteDecision,
  team: TeamSpec,
  originalTask: string,
): SubagentOrchestratorInput | undefined {
  switch (decision.kind) {
    case 'direct':
      return undefined
    case 'clarify':
      return undefined
    case 'single':
      return {
        mode: 'single',
        task: decision.task || originalTask,
        agent: agentForMember(team, decision.memberId),
      }
    case 'parallel':
      return {
        mode: 'parallel',
        task: originalTask,
        tasks: decision.tasks.map(task => ({
          agent: agentForMember(team, task.memberId),
          task: task.task,
          label: task.label,
        })),
        concurrency: team.policies?.maxParallel,
      }
    case 'review': {
      const worker = findMemberByRole(team, 'worker') ?? team.members[0]
      const reviewer = findMemberByRole(team, 'reviewer') ?? worker
      return {
        mode: 'chain',
        task: originalTask,
        chain: [
          {
            agent: worker.agent,
            task: decision.workerTask,
          },
          {
            agent: reviewer.agent,
            task: `${decision.reviewerTask}\n\nWorker output:\n{previous}`,
          },
        ],
      }
    }
    default:
      return assertNeverDecision(decision)
  }
}

export function teamRouteTaskCount(decision: TeamRouteDecision): number {
  switch (decision.kind) {
    case 'direct':
    case 'clarify':
      return 0
    case 'single':
      return 1
    case 'parallel':
      return decision.tasks.length
    case 'review':
      return 2
    default:
      return assertNeverDecision(decision)
  }
}

export function teamRouteSummary(decision: TeamRouteDecision): string {
  switch (decision.kind) {
    case 'direct':
      return `direct: ${decision.reason}`
    case 'clarify':
      return `clarify: ${decision.question}`
    case 'single':
      return `single:${decision.memberId} - ${decision.reason}`
    case 'parallel':
      return `parallel:${decision.tasks.length} - ${decision.reason}`
    case 'review':
      return `review - ${decision.reason}`
    default:
      return assertNeverDecision(decision)
  }
}

function teamMemberFromAlias(alias: string): TeamMemberSpec {
  const role = roleForAgent(alias)
  return {
    id: role === 'custom' ? alias : role,
    role,
    label: labelForRole(role, alias),
    agent: alias,
    description: `${labelForRole(role, alias)} member backed by the "${alias}" agent profile.`,
    handoffContract: handoffContractForRole(role),
  }
}

function roleForAgent(agent: string): TeamMemberSpec['role'] {
  const normalized = agent.toLowerCase()
  if (normalized.includes('scout')) return 'scout'
  if (normalized.includes('planner')) return 'planner'
  if (normalized.includes('worker')) return 'worker'
  if (normalized.includes('reviewer') || normalized.includes('review')) return 'reviewer'
  return 'custom'
}

function labelForRole(role: TeamMemberSpec['role'], fallback: string): string {
  if (role === 'scout') return 'Scout'
  if (role === 'planner') return 'Planner'
  if (role === 'worker') return 'Worker'
  if (role === 'reviewer') return 'Reviewer'
  return fallback
}

function handoffContractForRole(role: TeamMemberSpec['role']): string {
  if (role === 'scout') return 'Facts, relevant files, risks, and unknowns.'
  if (role === 'planner') return 'Concrete execution plan with ordered steps and acceptance checks.'
  if (role === 'worker') return 'Primary result, changed artifacts, and commands/tests run.'
  if (role === 'reviewer') return 'Findings, severity, residual risks, and approval recommendation.'
  return 'Task result and relevant evidence.'
}

function memberIdForAgent(team: TeamSpec, agent: string): string {
  return team.members.find(member => member.agent === agent)?.id ?? agent
}

function agentForMember(team: TeamSpec, memberId: string): string {
  return team.members.find(member => member.id === memberId)?.agent ?? memberId
}

function findMemberByRole(team: TeamSpec, role: TeamMemberSpec['role']): TeamMemberSpec | undefined {
  return team.members.find(member => member.role === role)
}

function assertNeverDecision(value: never): never {
  throw new Error(`Unsupported team route decision: ${JSON.stringify(value)}`)
}
