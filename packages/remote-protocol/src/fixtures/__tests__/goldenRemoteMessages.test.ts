import { describe, expect, it } from 'vitest';
import { REMOTE_PROTOCOL_SCHEMA_VERSION } from '@/packages/remote-protocol';
import { goldenChannelReply, goldenDeviceBinding, goldenExternalMessage } from '../goldenRemoteMessages.js';

describe('remote protocol fixtures', () => {
  it('keeps external entry payloads versioned and raw payloads referenced', () => {
    expect(goldenExternalMessage.schemaVersion).toBe(REMOTE_PROTOCOL_SCHEMA_VERSION);
    expect(goldenExternalMessage.rawRef).toBeUndefined();
    expect(goldenChannelReply.schemaVersion).toBe(REMOTE_PROTOCOL_SCHEMA_VERSION);
    expect(goldenDeviceBinding.status).toBe('active');
  });
});
