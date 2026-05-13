import { createId, injectable } from '@x-oasis/di';
import { BrowserWindow, ipcMain } from 'electron';
import { join } from 'path';

export interface IWindowManager {
  openMainWindow(): BrowserWindow;
  getMainWindow(): BrowserWindow | null;
  openSettingWindow(): BrowserWindow | null;
  getSettingWindow(): BrowserWindow | null;
  onSettingWindowCreated(callback: (win: BrowserWindow) => void): void;
}

export const WindowManagerId = createId('WindowManager');

@injectable()
export class WindowManager implements IWindowManager {
  private mainWindow: BrowserWindow | null = null;
  private settingWindow: BrowserWindow | null = null;
  private settingWindowCallbacks: ((win: BrowserWindow) => void)[] = [];

  openMainWindow(): BrowserWindow {
    this.mainWindow = new BrowserWindow({
      width: 1100,
      height: 750,
      title: 'Multi-Page Router (DI)',
      webPreferences: {
        preload: join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (process.env.NODE_ENV === 'development') {
      this.mainWindow.loadURL('http://localhost:5173');
    } else {
      this.mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
    }

    ipcMain.handle('open-setting-window', () => {
      this.openSettingWindow();
    });

    this.mainWindow.on('closed', () => {
      this.mainWindow = null;
      if (this.settingWindow && !this.settingWindow.isDestroyed()) {
        this.settingWindow.close();
      }
    });

    return this.mainWindow;
  }

  getMainWindow(): BrowserWindow | null {
    return this.mainWindow;
  }

  getSettingWindow(): BrowserWindow | null {
    return this.settingWindow;
  }

  onSettingWindowCreated(callback: (win: BrowserWindow) => void): void {
    this.settingWindowCallbacks.push(callback);
  }

  openSettingWindow(): BrowserWindow | null {
    if (this.settingWindow && !this.settingWindow.isDestroyed()) {
      this.settingWindow.focus();
      return this.settingWindow;
    }

    this.settingWindow = new BrowserWindow({
      width: 900,
      height: 700,
      parent: this.mainWindow || undefined,
      title: 'Settings',
      webPreferences: {
        preload: join(__dirname, '../preload/setting-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (process.env.NODE_ENV === 'development') {
      this.settingWindow.loadURL('http://localhost:5173/setting.html');
    } else {
      this.settingWindow.loadFile(join(__dirname, '../renderer/setting.html'));
    }

    for (const cb of this.settingWindowCallbacks) {
      cb(this.settingWindow);
    }

    this.settingWindow.on('closed', () => {
      this.settingWindow = null;
    });

    return this.settingWindow;
  }
}
