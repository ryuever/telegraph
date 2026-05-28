import { injectable } from '@x-oasis/di';
import { BrowserWindow, Menu, app, nativeImage, nativeTheme } from 'electron';
import { join } from 'path';

import type { IWindowManager } from '@/apps/main/application/common';
import { WindowManagerId } from '@/apps/main/application/common';
import type { MainSwitchPagePayload, MainWindowThemePayload } from '@/packages/services/pagelet-host/common';

export type { IWindowManager };
export { WindowManagerId };

const WINDOW_BACKGROUND_COLOR = '#080d17';
const WINDOW_ACCENT_COLOR = '#ff5436';
const APP_ICON_PATH = join(app.getAppPath(), 'assets/icons/icon.png');
const MAIN_WINDOW_RENDERER_NAME = 'main_window';
const DEFAULT_WINDOW_THEME: MainWindowThemePayload = {
  mode: 'dark',
  backgroundColor: WINDOW_BACKGROUND_COLOR,
  accentColor: WINDOW_ACCENT_COLOR,
};

export function resolveMainWindowRendererHtmlPath(
  fileName: 'index.html' | 'setting.html',
  mainBundleDir = __dirname,
): string {
  return join(mainBundleDir, '../renderer', MAIN_WINDOW_RENDERER_NAME, fileName);
}

@injectable()
export class WindowManager implements IWindowManager {
  private mainWindow: BrowserWindow | null = null;
  private settingWindow: BrowserWindow | null = null;
  private settingWindowCallbacks: ((win: BrowserWindow) => void)[] = [];
  private switchPageCallback: ((pageId: string, payload?: MainSwitchPagePayload) => void) | null = null;
  private currentWindowTheme = DEFAULT_WINDOW_THEME;

  openMainWindow(): BrowserWindow {
    this.applyNativeWindowTheme();

    this.mainWindow = new BrowserWindow({
      width: 1100,
      height: 750,
      title: 'Telegraph',
      icon: APP_ICON_PATH,
      backgroundColor: this.currentWindowTheme.backgroundColor,
      accentColor: this.currentWindowTheme.accentColor,
      darkTheme: this.currentWindowTheme.mode === 'dark',
      webPreferences: {
        preload: join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    const devServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      void this.mainWindow.loadURL(devServerUrl);
    } else {
      void this.mainWindow.loadFile(resolveMainWindowRendererHtmlPath('index.html'));
    }

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
    if (this.settingWindow && !this.settingWindow.isDestroyed()) {
      callback(this.settingWindow);
    }
  }

  setSwitchPageCallback(callback: (pageId: string, payload?: MainSwitchPagePayload) => void): void {
    this.switchPageCallback = callback;
  }

  switchPage(pageId: string, payload?: MainSwitchPagePayload): boolean {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      if (this.mainWindow.isMinimized()) this.mainWindow.restore();
      this.mainWindow.focus();
    }
    if (!this.switchPageCallback) return false;
    this.switchPageCallback(pageId, payload);
    return true;
  }

  openSettingWindow(): BrowserWindow | null {
    if (this.settingWindow && !this.settingWindow.isDestroyed()) {
      this.settingWindow.focus();
      return this.settingWindow;
    }

    this.applyNativeWindowTheme();

    this.settingWindow = new BrowserWindow({
      width: 900,
      height: 700,
      parent: this.mainWindow || undefined,
      title: 'Settings',
      icon: APP_ICON_PATH,
      backgroundColor: this.currentWindowTheme.backgroundColor,
      accentColor: this.currentWindowTheme.accentColor,
      darkTheme: this.currentWindowTheme.mode === 'dark',
      webPreferences: {
        preload: join(__dirname, '../preload/setting-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    for (const cb of this.settingWindowCallbacks) {
      cb(this.settingWindow);
    }

    const devServerUrl = MAIN_WINDOW_VITE_DEV_SERVER_URL;
    if (devServerUrl) {
      void this.settingWindow.loadURL(`${devServerUrl}/setting.html`);
    } else {
      void this.settingWindow.loadFile(resolveMainWindowRendererHtmlPath('setting.html'));
    }

    this.settingWindow.on('closed', () => {
      this.settingWindow = null;
    });

    return this.settingWindow;
  }

  applyWindowTheme(theme: MainWindowThemePayload): void {
    this.currentWindowTheme = theme;
    try {
      nativeTheme.themeSource = theme.mode;
      this.applyBrowserWindowTheme(this.mainWindow, theme);
      this.applyBrowserWindowTheme(this.settingWindow, theme);
    } catch {
      // Window chrome theming is best-effort and must never break renderer RPC.
    }
  }

  private applyBrowserWindowTheme(
    win: BrowserWindow | null,
    theme: MainWindowThemePayload,
  ): void {
    if (!win || win.isDestroyed()) return;
    win.setBackgroundColor(theme.backgroundColor);
    const maybeSetAccentColor = (win as { setAccentColor?: (color: string) => void }).setAccentColor;
    if (maybeSetAccentColor) {
      maybeSetAccentColor.call(win, theme.accentColor);
    }
  }

  private applyNativeWindowTheme(): void {
    nativeTheme.themeSource = this.currentWindowTheme.mode;
    if (process.platform === 'darwin') {
      const appIcon = nativeImage.createFromPath(APP_ICON_PATH);
      if (!appIcon.isEmpty()) {
        app.dock?.setIcon(appIcon);
      }
    }
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
        role: 'editMenu' as const,
      },
      {
        label: 'Develop',
        submenu: [
          {
            label: 'Connection',
            click: () => {
              this.switchPage('connection');
            },
          },
          {
            label: 'Monitor',
            click: () => {
              this.switchPage('monitor');
            },
          },
          {
            label: 'Design',
            click: () => {
              this.switchPage('design');
            },
          },
          {
            label: 'Runs',
            click: () => {
              this.switchPage('run-console');
            },
          },
          {
            label: 'Chat',
            click: () => {
              this.switchPage('chat');
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
