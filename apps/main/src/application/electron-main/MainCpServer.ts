import { createId, inject, injectable } from '@x-oasis/di';
import {
  IPCMainChannel,
  ElectronConnectionOrchestrator,
} from '@x-oasis/async-call-rpc-electron';
import { serviceHost } from '@x-oasis/async-call-rpc';
import { BrowserWindow } from 'electron';

import type {
  IWindowManager,
} from '@telegraph/main/application/electron-main/WindowManager';
import {
  WindowManagerId,
} from '@telegraph/main/application/electron-main/WindowManager';
import { ORCHESTRATOR_CP_CHANNEL_NAME } from '@telegraph/main/application/common/cp-config';
import { RENDERER_PARTICIPANT_ID } from '@telegraph/pagelet-host/common';

export interface IMainCpServer {
  start(): void;
  getOrchestrator(): ElectronConnectionOrchestrator;
  getSettingOrchestrator(): ElectronConnectionOrchestrator;
  getRendererIpcChannel(): IPCMainChannel;
  getSettingIpcChannel(): IPCMainChannel | null;
  registerSettingWindow(win: BrowserWindow): IPCMainChannel;
}

export const MainCpServerId = createId('MainCpServer');

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
