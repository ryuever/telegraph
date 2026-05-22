import { REMOTE_PROTOCOL_SCHEMA_VERSION, type ChannelReply, type DeviceBinding, type ExternalMessage } from '@/packages/remote-protocol';

export const goldenExternalMessage: ExternalMessage = {
  messageId: 'msg-cli-1',
  actor: {
    actorId: 'cli:local',
    kind: 'cli',
    displayName: 'Local CLI',
    deviceId: 'device-dev-mac',
  },
  channel: {
    kind: 'cli',
    channelId: 'local-socket',
  },
  text: 'Build a dashboard',
  receivedAt: 1_779_465_600_000,
  schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
};

export const goldenChannelReply: ChannelReply = {
  replyId: 'reply-1',
  channelId: 'local-socket',
  runId: 'run-1',
  cursor: 4,
  text: 'Run completed.',
  status: 'sent',
  deliveryStatus: 'sent',
  deliveryAttempts: 1,
  deliveredAt: 1_779_465_602_000,
  createdAt: 1_779_465_601_000,
  updatedAt: 1_779_465_602_000,
  schemaVersion: REMOTE_PROTOCOL_SCHEMA_VERSION,
};

export const goldenDeviceBinding: DeviceBinding = {
  bindingId: 'binding-1',
  deviceId: 'device-dev-mac',
  actor: {
    actorId: 'mobile:user',
    kind: 'mobile',
    displayName: 'Mobile User',
    deviceId: 'phone-1',
  },
  label: 'Personal phone',
  status: 'active',
  createdAt: 1_779_465_500_000,
  updatedAt: 1_779_465_500_000,
};
