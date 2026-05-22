import type { RemoteActorSnapshot } from '@/packages/remote-protocol';

export type RunEventSourceKind =
  | 'runtime'
  | 'ledger'
  | 'run_broker'
  | 'approval_broker'
  | 'external_entry'
  | 'computer_use'
  | 'system';

export interface RunEventSource {
  kind: RunEventSourceKind;
  id: string;
  actor?: RemoteActorSnapshot;
}
