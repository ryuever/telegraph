export type RunContinuationKind = 'retry' | 'fork' | 'resume';

export interface RunContinuationCapabilities {
  retry?: boolean;
  fork?: boolean;
  resume?: 'unsupported' | 'checkpointed';
}

export interface CreateRunContinuationInput {
  sourceRunId: string;
  kind: RunContinuationKind;
  requestedBy: string;
  reason?: string;
}

export interface RunContinuationDecision {
  allowed: boolean;
  kind: RunContinuationKind;
  reason: string;
}

export function evaluateRunContinuation(
  input: CreateRunContinuationInput,
  capabilities: RunContinuationCapabilities = {},
): RunContinuationDecision {
  switch (input.kind) {
    case 'retry':
      return capabilities.retry
        ? allow(input.kind, 'Retry creates a new attempt from the same input; it is not a checkpoint resume.')
        : deny(input.kind, 'Retry is not supported by this run/runtime.')
    case 'fork':
      return capabilities.fork
        ? allow(input.kind, 'Fork creates a child/new run from existing context; it is not a checkpoint resume.')
        : deny(input.kind, 'Fork is not supported by this run/runtime.')
    case 'resume':
      return capabilities.resume === 'checkpointed'
        ? allow(input.kind, 'Resume is allowed because the runtime declares checkpointed resume support.')
        : deny(input.kind, 'Resume requires checkpointed runtime support; use retry or fork when replaying from input/context.')
  }
}

export function assertRunContinuationAllowed(
  input: CreateRunContinuationInput,
  capabilities: RunContinuationCapabilities = {},
): RunContinuationDecision {
  const decision = evaluateRunContinuation(input, capabilities);
  if (!decision.allowed) throw new Error(decision.reason);
  return decision;
}

function allow(kind: RunContinuationKind, reason: string): RunContinuationDecision {
  return { allowed: true, kind, reason };
}

function deny(kind: RunContinuationKind, reason: string): RunContinuationDecision {
  return { allowed: false, kind, reason };
}
