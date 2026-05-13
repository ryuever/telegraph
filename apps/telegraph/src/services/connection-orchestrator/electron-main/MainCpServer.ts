// Phase 2 — main-side control-plane server.
//
// Responsibilities:
//   1. Stand up an `IPCMainChannel` in `acceptAllSenders` mode (so multiple
//      windows can talk to the same orchestrator over one channel name).
//   2. Mount an `RPCServiceHost` on it, registering the
//      `OrchestratorInspectorService` under `ORCHESTRATOR_INSPECTOR_PATH`.
//   3. Register the renderer-cp channel as a participant
//      (`renderer:main`) on the AppOrchestrator. Phase 3 the design utility
//      adds a second participant; main itself is *not* a participant, per D1.
//
// Phase 2 the main↔renderer cp channel doubles as the renderer-side
// participant channel so the orchestrator can later push activated ports to
// the renderer via the same transport.
import { IPCMainChannel } from '@x-oasis/async-call-rpc-electron/electron-main';
import { RPCServiceHost } from '@x-oasis/async-call-rpc';

import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';

import {
  ORCHESTRATOR_CP_CHANNEL_NAME,
  ORCHESTRATOR_INSPECTOR_PATH,
} from '@telegraph/services/connection-orchestrator/common/cp-config';

import type { IAppOrchestrator } from './AppOrchestrator';
import { AppOrchestratorId } from './AppOrchestrator';
import type { OrchestratorInspectorService } from './OrchestratorInspectorService';
import { OrchestratorInspectorServiceId } from './OrchestratorInspectorService';

export const RENDERER_MAIN_PARTICIPANT_ID = 'renderer:main';

export interface IMainCpServer {
  start(): void;
}

@injectable()
export class MainCpServer implements IMainCpServer {
  private channel?: IPCMainChannel;
  private host?: RPCServiceHost;
  private started = false;

  constructor(
    @inject(LogServiceId) private readonly log: ILogService,
    @inject(AppOrchestratorId) private readonly orchestrator: IAppOrchestrator,
    @inject(OrchestratorInspectorServiceId)
    private readonly inspector: OrchestratorInspectorService,
  ) {}

  start(): void {
    if (this.started) {
      this.log.warn('MainCpServer.start() called twice — ignoring');
      return;
    }
    this.started = true;

    this.log.info(`MainCpServer.start() channel=${ORCHESTRATOR_CP_CHANNEL_NAME}`);

    // 1. Stand up the IPC channel in broadcast mode so we don't have to bind
    //    to a specific webContents at construction time. The first message
    //    from any renderer becomes the reply target — fine for Phase 2 where
    //    there's exactly one main BrowserWindow.
    this.channel = new IPCMainChannel({
      channelName: ORCHESTRATOR_CP_CHANNEL_NAME,
      acceptAllSenders: true,
      description: 'main-cp',
    });

    // 2. Mount the inspector service on a multi-service-per-channel host.
    //    Phase 3+ may register more cp services (e.g. process-control); they
    //    all share this host.
    this.host = new RPCServiceHost();
    this.host.registerServiceHandler(ORCHESTRATOR_INSPECTOR_PATH, this.inspector);
    this.channel.setServiceHost(this.host);

    // 3. Register the renderer as a participant. The same cp channel doubles
    //    as the participant's control channel so the orchestrator can push
    //    ports to it later via `activateConnection`.
    this.orchestrator.registerParticipant(RENDERER_MAIN_PARTICIPANT_ID, this.channel, 'renderer');
    this.orchestrator.setRendererCpChannel(this.channel);

    this.log.info(
      `MainCpServer ready — inspector @ ${ORCHESTRATOR_INSPECTOR_PATH}, participant=${RENDERER_MAIN_PARTICIPANT_ID}`,
    );
  }
}

export const MainCpServerId = createId('MainCpServer');
