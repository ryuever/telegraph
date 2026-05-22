import { describe, expect, it } from 'vitest';
import { RUN_PROTOCOL_SCHEMA_VERSION } from '@/packages/run-protocol';
import { goldenApproval, goldenEventCursor, goldenRunEventRecord, goldenRunIntent, goldenRuntimeEnvelope } from '../goldenRunRecords.js';

describe('run protocol fixtures', () => {
  it('keeps every persisted event envelope cursor-addressable and versioned', () => {
    expect(goldenRunIntent.status).toBe('queued');
    expect(goldenEventCursor.schemaVersion).toBe(RUN_PROTOCOL_SCHEMA_VERSION);
    expect(goldenRuntimeEnvelope).toMatchObject({
      runId: 'run-1',
      cursor: 1,
      schemaVersion: RUN_PROTOCOL_SCHEMA_VERSION,
    });
    expect(goldenRunEventRecord.rawRef).toBeUndefined();
    expect(goldenRunEventRecord.artifactRef).toBeUndefined();
    expect(goldenApproval.status).toBe('pending');
  });
});
