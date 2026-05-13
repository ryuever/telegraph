import { createId, injectable } from '@x-oasis/di';
import { BrowserWindow, ipcMain, Menu, app } from 'electron';
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
      title: 'Telegraph',
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

    this.setupApplicationMenu();

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

  private setupApplicationMenu(): void {
    const isMac = process.platform === 'darwin';

    const template: Electron.MenuItemConstructorOptions[] = [
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about' as const },
                { type: 'separator' as const },
                { role: 'services' as const },
                { type: 'separator' as const },
                { role: 'hide' as const },
                { role: 'hideOthers' as const },
                { role: 'unhide' as const },
                { type: 'separator' as const },
                { role: 'quit' as const },
              ],
            },
          ]
        : []),
      {
        label: 'Develop',
        submenu: [
          {
            label: 'Connection',
            click: () => {
              this.mainWindow?.webContents.send('switch-page', 'connection');
            },
          },
          {
            label: 'Monitor',
            click: () => {
              this.mainWindow?.webContents.send('switch-page', 'monitor');
            },
          },
          {
            label: 'Design',
            click: () => {
              this.mainWindow?.webContents.send('switch-page', 'design');
            },
          },
          { type: 'separator' },
          {
            label: 'Setting',
            click: () => {
              this.openSettingWindow();
            },
          },
        ],
      },
    ];

    if (process.env.NODE_ENV === 'development') {
      template.push({
        label: 'View',
        submenu: [
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
        ],
      });
    }

    const menu = Menu.buildFromTemplate(template);
    Menu.setApplicationMenu(menu);
  }
}
