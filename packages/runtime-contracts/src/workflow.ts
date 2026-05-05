export type WorkflowPattern =
  | 'single_llm'
  | 'prompt_chain'
  | 'routing'
  | 'parallelization'
  | 'orchestrator_workers'
  | 'evaluator_optimizer'
  | 'autonomous_agent'

export type StepKind = 'model' | 'tool' | 'router' | 'worker' | 'evaluator' | 'aggregator' | 'custom'
