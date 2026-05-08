// Phase 2 — RPC service exposing the orchestrator's topology to the renderer.
//
// Lives in the main process. Registered onto the main↔renderer cp channel by
// MainCpServer at boot time. The renderer talks to it via a
// `ProxyRPCClient<IOrchestratorInspectorService>` over the same cp channel.
//
// Phase 2 only `getTopology()` does anything real. `requestConnect()` is
// declared so the contract is stable for Phase 3+.
import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';

import type {
  IOrchestratorInspectorService,
  RequestConnectResult,
  TopologySnapshot,
} from '@telegraph/services/connection-orchestrator/common/types';

import type { IAppOrchestrator } from './AppOrchestrator';
import { AppOrchestratorId } from './AppOrchestrator';

@injectable()
export class OrchestratorInspectorService implements IOrchestratorInspectorService {
  constructor(
    @inject(AppOrchestratorId) private readonly orchestrator: IAppOrchestrator,
    @inject(LogServiceId) private readonly log: ILogService,
  ) {}

  getTopology(): Promise<TopologySnapshot> {
    const snapshot: TopologySnapshot = {
      participants: this.orchestrator.listParticipants(),
      connections: this.orchestrator.listConnections(),
      capturedAt: Date.now(),
    };
    this.log.info(
      `inspector.getTopology() participants=${String(snapshot.participants.length)} connections=${String(snapshot.connections.length)}`,
    );
    return Promise.resolve(snapshot);
  }

  async requestConnect(fromId: string, toId: string): Promise<RequestConnectResult> {
    this.log.info(`inspector.requestConnect(${fromId} -> ${toId})`);
    const result = await this.orchestrator.requestConnect(fromId, toId);
    return result;
  }
}

export const OrchestratorInspectorServiceId = createId('OrchestratorInspectorService');
