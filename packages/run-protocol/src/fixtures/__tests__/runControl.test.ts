import { describe, expect, it } from 'vitest';

import { evaluateRunControlCommand } from '@/packages/run-protocol';

describe('run control protocol', () => {
  it('allows pause and stop only for running projections', () => {
    expect(evaluateRunControlCommand({ status: 'running' }, 'pause')).toEqual({ allowed: true });
    expect(evaluateRunControlCommand({ status: 'queued' }, 'pause')).toEqual({
      allowed: false,
      reason: 'pause requires running status, got queued',
    });
    expect(evaluateRunControlCommand({ status: 'running' }, 'stop')).toEqual({ allowed: true });
  });

  it('allows cancel for queued or running projections', () => {
    expect(evaluateRunControlCommand({ status: 'queued' }, 'cancel')).toEqual({ allowed: true });
    expect(evaluateRunControlCommand({ status: 'running' }, 'cancel')).toEqual({ allowed: true });
  });

  it('rejects terminal and missing projections', () => {
    expect(evaluateRunControlCommand({ status: 'completed' }, 'cancel')).toEqual({
      allowed: false,
      reason: 'run is already completed',
    });
    expect(evaluateRunControlCommand(null, 'pause')).toEqual({
      allowed: false,
      reason: 'run not found',
    });
  });
});
