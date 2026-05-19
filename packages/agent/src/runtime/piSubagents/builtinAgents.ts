import type { SubagentDefinition } from './types'

const TELEGRAPH_BUILTIN_SOURCE = 'telegraph://pi-subagents/builtin'

export function createTelegraphBuiltinAgents(): SubagentDefinition[] {
  return [
    {
      name: 'scout',
      description: 'Inspect the task and collect the facts needed before planning.',
      tools: ['read', 'grep', 'glob'],
      systemPromptMode: 'replace',
      inheritProjectContext: true,
      inheritSkills: true,
      defaultContext: 'fresh',
      systemPrompt: [
        'You are Scout, a focused research subagent.',
        '',
        'Your job is to inspect the request, identify relevant files or constraints,',
        'and return concise findings that the next agent can act on. Avoid implementation.',
      ].join('\n'),
      scope: 'builtin',
      sourcePath: `${TELEGRAPH_BUILTIN_SOURCE}/scout.md`,
    },
    {
      name: 'planner',
      description: 'Turn findings into a concrete execution plan.',
      tools: ['read', 'grep', 'glob'],
      systemPromptMode: 'replace',
      inheritProjectContext: true,
      inheritSkills: true,
      defaultContext: 'fresh',
      systemPrompt: [
        'You are Planner, a pragmatic implementation planner.',
        '',
        'Turn the provided task and prior findings into a short, ordered plan.',
        'Call out risks, required files, and the smallest useful first milestone.',
      ].join('\n'),
      scope: 'builtin',
      sourcePath: `${TELEGRAPH_BUILTIN_SOURCE}/planner.md`,
    },
    {
      name: 'worker',
      description: 'Execute the planned work and produce the main answer.',
      tools: ['read', 'grep', 'glob', 'edit', 'bash'],
      systemPromptMode: 'replace',
      inheritProjectContext: true,
      inheritSkills: true,
      defaultContext: 'fresh',
      systemPrompt: [
        'You are Worker, an implementation subagent.',
        '',
        'Use the plan and context to produce the concrete result. Be direct,',
        'preserve existing constraints, and state any blocker that prevents completion.',
      ].join('\n'),
      scope: 'builtin',
      sourcePath: `${TELEGRAPH_BUILTIN_SOURCE}/worker.md`,
    },
    {
      name: 'reviewer',
      description: 'Review the produced result for correctness, regressions, and gaps.',
      tools: ['read', 'grep', 'glob'],
      systemPromptMode: 'replace',
      inheritProjectContext: true,
      inheritSkills: true,
      defaultContext: 'fresh',
      systemPrompt: [
        'You are Reviewer, a critical review subagent.',
        '',
        'Review the provided result for correctness, missing tests, regressions,',
        'and unclear assumptions. Return only actionable findings and a concise verdict.',
      ].join('\n'),
      scope: 'builtin',
      sourcePath: `${TELEGRAPH_BUILTIN_SOURCE}/reviewer.md`,
    },
  ]
}
