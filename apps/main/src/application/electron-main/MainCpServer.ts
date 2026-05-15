import { inject, injectable } from '@x-oasis/di';
import {
  IPCMainChannel,
  ElectronConnectionOrchestrator,
} from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { BrowserWindow } from 'electron';

import type {
  IWindowManager,
} from '@/apps/main/application/electron-main/WindowManager';
import {
  WindowManagerId,
} from '@/apps/main/application/electron-main/WindowManager';
import { ORCHESTRATOR_CP_CHANNEL_NAME } from '@/apps/main/application/common/cp-config';
import { RENDERER_PARTICIPANT_ID } from '@/packages/services/pagelet-host/common';
// IMainCpServer interface + MainCpServerId DI token now live in
// packages/services/pagelet-host/electron-main/IMainCpServer (H4, D-008)
// so the framework owns its own contract. Apps that need the token
// import it directly from there alongside this concrete implementation.
import type { IMainCpServer } from '@/packages/services/pagelet-host/electron-main/IMainCpServer';

@injectable()
export class MainCpServer implements IMainCpServer {
  private orchestrator!: ElectronConnectionOrchestrator;
  private rendererIpcChannel!: IPCMainChannel;
  private settingOrchestrator!: ElectronConnectionOrchestrator;
  private settingIpcChannel: IPCMainChannel | null = null;

  constructor(
    @inject(WindowManagerId) private readonly windowManager: IWindowManager
  ) {}

  start(): void {
    const win = this.windowManager.getMainWindow();
    if (!win)
      throw new Error(
        'WindowManager must openMainWindow before MainCpServer.start()'
      );

    this.rendererIpcChannel = new IPCMainChannel({
      channelName: ORCHESTRATOR_CP_CHANNEL_NAME,
      webContents: win.webContents,
      description: 'main→renderer IPC channel',
    });

    this.orchestrator = new ElectronConnectionOrchestrator({
      logger: (level, msg) => console.log(`[orchestrator:${level}] ${msg}`),
      enableStats: true,
      heartbeat: {
        enabled: true,
        intervalMs: 10_000,
        timeoutMs: 5_000,
      },
    });

    this.orchestrator.registerParticipant(
      RENDERER_PARTICIPANT_ID,
      this.rendererIpcChannel,
      'renderer'
    );

    this.orchestrator.registerProxyService(serviceHost);

    this.settingOrchestrator = new ElectronConnectionOrchestrator({
      logger: (level, msg) =>
        console.log(`[setting-orchestrator:${level}] ${msg}`),
      enableStats: true,
    });

    console.log('[MainCpServer] started');
  }

  getOrchestrator(): ElectronConnectionOrchestrator {
    return this.orchestrator;
  }

  getRendererIpcChannel(): IPCMainChannel {
    return this.rendererIpcChannel;
  }

  getSettingIpcChannel(): IPCMainChannel | null {
    return this.settingIpcChannel;
  }

  getSettingOrchestrator(): ElectronConnectionOrchestrator {
    return this.settingOrchestrator;
  }

  getAdditionalOrchestratorsFor(
    pageletId: string
  ): ElectronConnectionOrchestrator[] {
    // The setting pagelet is the sole renderer for the setting window's
    // orchestrator, so it must be registered on both the main orchestrator
    // (for cross-pagelet RPC) and the setting orchestrator (for its own
    // renderer→pagelet RPC).
    if (pageletId === 'setting') {
      return [this.settingOrchestrator];
    }
    return [];
  }

  registerSettingWindow(win: BrowserWindow): IPCMainChannel {
    this.settingIpcChannel = new IPCMainChannel({
      channelName: 'setting-rpc',
      webContents: win.webContents,
      description: 'main→setting-renderer IPC channel',
    });

    this.settingOrchestrator.registerParticipant(
      RENDERER_PARTICIPANT_ID,
      this.settingIpcChannel,
      'renderer'
    );

    this.settingOrchestrator.registerProxyService(serviceHost);

    console.log('[MainCpServer] setting window registered');

    return this.settingIpcChannel;
  }
}
