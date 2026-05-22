import type { RemoteActor } from './actor.js';

export type DeviceBindingStatus = 'pending' | 'active' | 'revoked' | 'expired';

export interface DeviceBinding {
  bindingId: string;
  deviceId: string;
  actor: RemoteActor;
  label?: string;
  status: DeviceBindingStatus;
  createdAt: number;
  updatedAt: number;
  expiresAt?: number;
  revokedAt?: number;
}
