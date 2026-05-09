// Phase 1 — minimal WindowManager: opens a single main BrowserWindow.
// Phase 4+ will manage multiple windows / pagelets.
import { join } from 'node:path';

import { BrowserWindow, Menu, app } from 'electron';

import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export interface IWindowManager {
  openMainWindow(): BrowserWindow;
  openMonitorWindow(): BrowserWindow;
  setupApplicationMenu(): void;
  setupDockMenu(): void;
}

@injectable()
export class WindowManager implements IWindowManager {
  private monitorWindow?: BrowserWindow;

  constructor(@inject(LogServiceId) private readonly log: ILogService) {}

  openMainWindow(): BrowserWindow {
    this.log.info('WindowManager.openMainWindow() begin');

    const win = new BrowserWindow({
      width: 1200,
      height: 800,
      title: 'Telegraph',
      webPreferences: {
        preload: this.preloadPath(),
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
      },
    });

    if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string') {
      this.log.info(`loadURL(${MAIN_WINDOW_VITE_DEV_SERVER_URL})`);
      void win.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    } else {
      const indexHtml = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
      this.log.info(`loadFile(${indexHtml})`);
      void win.loadFile(indexHtml);
    }

    win.on('ready-to-show', () => {
      this.log.info('main window ready-to-show');
      win.show();
    });

    return win;
  }

  openMonitorWindow(): BrowserWindow {
    if (this.monitorWindow && !this.monitorWindow.isDestroyed()) {
      this.monitorWindow.focus();
      return this.monitorWindow;
    }

    this.log.info('WindowManager.openMonitorWindow()');

    this.monitorWindow = new BrowserWindow({
      width: 720,
      height: 520,
      title: 'Telegraph — Activity Monitor',
      webPreferences: {
        preload: this.preloadPath(),
        contextIsolation: true,
        sandbox: false,
        nodeIntegration: false,
      },
    });

    if (typeof MAIN_WINDOW_VITE_DEV_SERVER_URL === 'string') {
      void this.monitorWindow.loadURL(`${MAIN_WINDOW_VITE_DEV_SERVER_URL}#/monitor`);
    } else {
      const indexHtml = join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`);
      void this.monitorWindow.loadFile(indexHtml, { hash: '/monitor' });
    }

    this.monitorWindow.on('closed', () => {
      this.monitorWindow = undefined;
    });

    return this.monitorWindow;
  }

  setupApplicationMenu(): void {
    const template: Electron.MenuItemConstructorOptions[] = [
      {
        label: 'File',
        submenu: [
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
          { type: 'separator' },
          {
            label: 'Toggle Monitor',
            click: () => { this.openMonitorWindow(); },
          },
        ],
      },
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' },
        ],
      },
    ];

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
    this.log.info('Application menu set up with Toggle Monitor in View');
  }

  setupDockMenu(): void {
    if (process.platform !== 'darwin') return;

    const dockMenu = Menu.buildFromTemplate([
      {
        label: 'Toggle Monitor',
        click: () => { this.openMonitorWindow(); },
      },
    ]);

    if (app.dock) {
      app.dock.setMenu(dockMenu);
    }
    this.log.info('Dock menu set up with Toggle Monitor');
  }

  private preloadPath(): string {
    return join(__dirname, 'preload.js');
  }
}

export const WindowManagerId = createId('WindowManager');
