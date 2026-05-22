import { describe, expect, it } from 'vitest';
import {
  assertRunContinuationAllowed,
  evaluateRunContinuation,
} from '../../continuation.js';

describe('run continuation boundaries', () => {
  it('allows retry and fork only when explicitly supported', () => {
    expect(evaluateRunContinuation({
      sourceRunId: 'run-1',
      kind: 'retry',
      requestedBy: 'cli',
    }, { retry: true })).toEqual({
      allowed: true,
      kind: 'retry',
      reason: 'Retry creates a new attempt from the same input; it is not a checkpoint resume.',
    });

    expect(evaluateRunContinuation({
      sourceRunId: 'run-1',
      kind: 'fork',
      requestedBy: 'cli',
    }, { fork: false })).toEqual({
      allowed: false,
      kind: 'fork',
      reason: 'Fork is not supported by this run/runtime.',
    });
  });

  it('does not allow resume without checkpointed runtime support', () => {
    const input = {
      sourceRunId: 'run-1',
      kind: 'resume' as const,
      requestedBy: 'mobile',
    };

    expect(evaluateRunContinuation(input, { retry: true, fork: true })).toEqual({
      allowed: false,
      kind: 'resume',
      reason: 'Resume requires checkpointed runtime support; use retry or fork when replaying from input/context.',
    });
    expect(() => assertRunContinuationAllowed(input, { resume: 'unsupported' }))
      .toThrow('Resume requires checkpointed runtime support')
  });

  it('allows resume only for checkpointed runtime support', () => {
    expect(assertRunContinuationAllowed({
      sourceRunId: 'run-1',
      kind: 'resume',
      requestedBy: 'mobile',
    }, { resume: 'checkpointed' })).toEqual({
      allowed: true,
      kind: 'resume',
      reason: 'Resume is allowed because the runtime declares checkpointed resume support.',
    });
  });
});
