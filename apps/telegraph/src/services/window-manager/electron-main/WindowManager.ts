// Phase 1 — minimal WindowManager: opens a single main BrowserWindow.
// Phase 4+ will manage multiple windows / pagelets.
import { join } from 'node:path';

import { BrowserWindow } from 'electron';

import { createId, inject, injectable } from '@x-oasis/di';

import type { ILogService } from '@telegraph/core/log/LogService';
import { LogServiceId } from '@telegraph/core/log/LogService';

// Forge's Vite plugin injects these globals at build time.
declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string | undefined;
declare const MAIN_WINDOW_VITE_NAME: string;

export interface IWindowManager {
  openMainWindow(): BrowserWindow;
}

@injectable()
export class WindowManager implements IWindowManager {
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
      // forge-vite emits to .vite/build/ (this file) and
      // .vite/renderer/<name>/index.html.
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

  private preloadPath(): string {
    // Forge's vite plugin emits preload.js next to index.js under .vite/build/.
    return join(__dirname, 'preload.js');
  }
}

export const WindowManagerId = createId('WindowManager');
