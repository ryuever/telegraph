import { describe, expect, it } from 'vitest'
import type { TeamSpec } from '../types'
import {
  orchestratorInputFromRouteDecision,
  routeDecisionFromOrchestratorInput,
  teamRouteTaskCount,
} from '../teamRouter'

const team: TeamSpec = {
  id: 'test-team',
  label: 'Test Team',
  members: [
    { id: 'scout', role: 'scout', label: 'Scout', agent: 'scout' },
    { id: 'worker', role: 'worker', label: 'Worker', agent: 'worker' },
    { id: 'reviewer', role: 'reviewer', label: 'Reviewer', agent: 'reviewer' },
  ],
  router: {
    id: 'test-router',
    strategy: 'model-router-v0',
    allowedDecisions: ['direct', 'clarify', 'single', 'parallel', 'review'],
  },
  policies: {
    maxParallel: 2,
  },
}

describe('teamRouter', () => {
  it('preserves parallel labels when adapting between orchestrator and team route decisions', () => {
    const decision = routeDecisionFromOrchestratorInput({
      mode: 'parallel',
      task: 'Check runtime and UI',
      tasks: [
        { agent: 'scout', label: 'Runtime Scout', task: 'Read runtime files.' },
        { agent: 'reviewer', label: 'UI Reviewer', task: 'Read UI files.' },
      ],
    }, team, 'Check runtime and UI')

    expect(decision).toMatchObject({
      kind: 'parallel',
      tasks: [
        { memberId: 'scout', label: 'Runtime Scout', task: 'Read runtime files.' },
        { memberId: 'reviewer', label: 'UI Reviewer', task: 'Read UI files.' },
      ],
    })

    expect(orchestratorInputFromRouteDecision(decision, team, 'Check runtime and UI')).toMatchObject({
      mode: 'parallel',
      concurrency: 2,
      tasks: [
        { agent: 'scout', label: 'Runtime Scout', task: 'Read runtime files.' },
        { agent: 'reviewer', label: 'UI Reviewer', task: 'Read UI files.' },
      ],
    })
  })

  it('maps worker plus reviewer chains to the review decision', () => {
    const decision = routeDecisionFromOrchestratorInput({
      mode: 'chain',
      task: 'Implement a change',
      chain: [
        { agent: 'worker', task: 'Make the change.' },
        { agent: 'reviewer', task: 'Review the change.' },
      ],
    }, team, 'Implement a change')

    expect(decision).toEqual({
      kind: 'review',
      workerTask: 'Make the change.',
      reviewerTask: 'Review the change.',
      reason: 'Model router selected a team route.',
    })
    expect(teamRouteTaskCount(decision)).toBe(2)
  })
})
