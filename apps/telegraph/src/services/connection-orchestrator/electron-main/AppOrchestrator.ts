// Phase 2 — main-process orchestrator. Thin wrapper on
// `ElectronConnectionOrchestrator` that:
//   1. registers itself in the DI container, and
//   2. exposes read-only `listParticipants()` / `listConnections()` so the
//      OrchestratorInspectorService can build a wire-friendly snapshot
//      without poking at protected fields.
//
// Design context: codebase-wiki/roadmap/20260508-from-zero-design-only-electron-app-plan.md (§5 process topology).
// Capability gaps: codebase-wiki/discussion/20260508-x-oasis-orchestrator-capability-gaps.md (D-006).
//
// Phase 3 added `DesignPageletProcess` which calls `registerParticipant()`
// from outside; Phase 4 layers heartbeat/reconnect config on top via the
// `ConnectionOrchestratorConfig`.
import {
  ElectronConnectionOrchestrator,
  type IPCMainChannel,
} from '@x-oasis/async-call-rpc-electron';
import type {
  AbstractChannelProtocol,
  ConnectionOrchestratorConfig,
  ParticipantInfo,
  ParticipantType,
} from '@x-oasis/async-call-rpc';

import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';

import type {
  ConnectionSnapshot,
  ConnectionStateWire,
  ParticipantSnapshot,
} from '@telegraph/services/connection-orchestrator/common/types';

export interface IAppOrchestrator {
  registerParticipant(id: string, channel: AbstractChannelProtocol, type?: ParticipantType): void;
  /** Wrapper over base.connect() that returns a wire-friendly summary. */
  requestConnect(fromId: string, toId: string): Promise<{ connectionId: string; state: ConnectionStateWire }>;
  listParticipants(): ParticipantSnapshot[];
  listConnections(): ConnectionSnapshot[];
  /** main↔renderer cp channel — kept here so MainCpServer can stash it for inspector lookup. */
  setRendererCpChannel(channel: IPCMainChannel): void;
  getRendererCpChannel(): IPCMainChannel | undefined;
}

@injectable()
export class AppOrchestrator extends ElectronConnectionOrchestrator implements IAppOrchestrator {
  private rendererCpChannel?: IPCMainChannel;

  constructor(@inject(LogServiceId) private readonly log: ILogService) {
    const config: ConnectionOrchestratorConfig = {
      logger: (level, message, meta?: unknown): void => {
        // Funnel x-oasis logs through our LogService so they end up in the
        // same /tmp/telegraph-main.log file. `meta` may be anything; we
        // best-effort stringify it for the file log.
        const metaStr =
          meta === undefined
            ? ''
            : ` ${typeof meta === 'string' ? meta : JSON.stringify(meta)}`;
        const line = `[orchestrator] ${message}${metaStr}`;
        if (level === 'error') log.error(line);
        else if (level === 'warn') log.warn(line);
        else log.info(line);
      },
    };
    super(config);
    this.log.info('AppOrchestrator constructed');
  }

  setRendererCpChannel(channel: IPCMainChannel): void {
    this.rendererCpChannel = channel;
  }

  getRendererCpChannel(): IPCMainChannel | undefined {
    return this.rendererCpChannel;
  }

  /**
   * Phase 2: thin wrapper over base `connect()` that returns wire-friendly
   * data so the OrchestratorInspectorService can hand it straight back to
   * the renderer over RPC. Real reconnect / heartbeat tuning lands in Phase 4.
   *
   * Named `requestConnect` rather than overriding `connect()` because TS
   * forbids narrowing the return type of an overridden method.
   */
  async requestConnect(
    fromId: string,
    toId: string,
  ): Promise<{ connectionId: string; state: ConnectionStateWire }> {
    const info = await this.connect(fromId, toId);
    return { connectionId: info.connectionId, state: info.state as ConnectionStateWire };
  }

  /**
   * Snapshot of the protected `participants` Map. Cast is narrow and local
   * — preferable to widening the upstream surface for a read-only inspector
   * use-case.
   */
  listParticipants(): ParticipantSnapshot[] {
    const map = (this as unknown as { participants: Map<string, ParticipantInfo> }).participants;
    const out: ParticipantSnapshot[] = [];
    for (const info of map.values()) {
      // `ParticipantType` and `ParticipantTypeWire` are the same string-literal
      // union by construction (see common/types.ts) — assign directly.
      out.push({
        id: info.id,
        type: info.type,
        registeredAt: info.registeredAt,
      });
    }
    return out;
  }

  /**
   * Snapshot of the protected `connections` Map. The `ManagedConnection` shape
   * isn't exported, so we structurally pick what we need.
   */
  listConnections(): ConnectionSnapshot[] {
    type ManagedConn = {
      readonly connectionId: string;
      readonly fromId: string;
      readonly toId: string;
      readonly state: string;
      readonly lastStateChangedAt?: number;
      readonly error?: Error;
    };
    const map = (this as unknown as { connections: Map<string, ManagedConn> }).connections;
    const out: ConnectionSnapshot[] = [];
    for (const c of map.values()) {
      out.push({
        connectionId: c.connectionId,
        fromId: c.fromId,
        toId: c.toId,
        state: c.state as ConnectionStateWire,
        lastStateChangedAt: c.lastStateChangedAt ?? 0,
        errorMessage: c.error?.message,
      });
    }
    return out;
  }
}

export const AppOrchestratorId = createId('AppOrchestrator');
