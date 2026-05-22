export type RemoteActorKind =
  | 'desktop'
  | 'cli'
  | 'mobile'
  | 'telegram'
  | 'slack'
  | 'mcp'
  | 'webhook'
  | 'system';

export interface RemoteActor {
  actorId: string;
  kind: RemoteActorKind;
  displayName?: string;
  deviceId?: string;
  channelId?: string;
  workspaceId?: string;
  policyProfileId?: string;
}

export type RemoteActorSnapshot = RemoteActor;
