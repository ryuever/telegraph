import { describe, expect, it } from 'vitest';
import { COMPUTER_USE_PROTOCOL_SCHEMA_VERSION } from '@/packages/computer-use-protocol';
import { goldenActionResult, goldenComputerAction, goldenObservation } from '../goldenComputerUse.js';

describe('computer-use protocol fixtures', () => {
  it('keeps observations artifact-backed and actions approval-addressable', () => {
    expect(goldenObservation.schemaVersion).toBe(COMPUTER_USE_PROTOCOL_SCHEMA_VERSION);
    expect(goldenObservation.artifactRef.uri).toContain('telegraph://artifacts');
    expect(goldenComputerAction.approvalId).toBe('approval-1');
    expect(goldenActionResult.failureReason).toBe('permission_denied');
  });
});
