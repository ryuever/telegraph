import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  resolveMainWindowRendererHtmlPath,
  WindowManager,
} from '@/apps/main/application/electron-main/WindowManager';

const electronMock = vi.hoisted(() => {
  const loadOrder: string[] = [];
  const windows: Array<{
    loadURL: ReturnType<typeof vi.fn>;
    loadFile: ReturnType<typeof vi.fn>;
    on: ReturnType<typeof vi.fn>;
    focus: ReturnType<typeof vi.fn>;
    isDestroyed: ReturnType<typeof vi.fn>;
    isMinimized: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    setBackgroundColor: ReturnType<typeof vi.fn>;
    webContents: Record<string, never>;
  }> = [];
  const BrowserWindow = vi.fn(() => {
    const win = {
      loadURL: vi.fn(() => {
        loadOrder.push('loadURL');
        return Promise.resolve();
      }),
      loadFile: vi.fn(() => {
        loadOrder.push('loadFile');
        return Promise.resolve();
      }),
      on: vi.fn(),
      focus: vi.fn(),
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      close: vi.fn(),
      setBackgroundColor: vi.fn(),
      webContents: {},
    };
    windows.push(win);
    return win;
  });

  return {
    BrowserWindow,
    loadOrder,
    windows,
  };
});

vi.mock('electron', () => ({
  app: {
    getAppPath: () => join('/tmp', 'Telegraph.app', 'Contents', 'Resources', 'app'),
    dock: {
      setIcon: vi.fn(),
    },
  },
  BrowserWindow: electronMock.BrowserWindow,
  Menu: {
    buildFromTemplate: vi.fn(),
    setApplicationMenu: vi.fn(),
  },
  nativeImage: {
    createFromPath: vi.fn(() => ({
      isEmpty: () => true,
    })),
  },
  nativeTheme: {
    themeSource: 'system',
  },
}));

beforeEach(() => {
  vi.stubGlobal('MAIN_WINDOW_VITE_DEV_SERVER_URL', undefined);
  electronMock.BrowserWindow.mockClear();
  electronMock.loadOrder.length = 0;
  electronMock.windows.length = 0;
});

describe('WindowManager renderer file paths', () => {
  it('loads packaged renderer HTML from Forge Vite renderer name folder', () => {
    const mainBundleDir = join('/tmp', 'Telegraph.app', 'Contents', 'Resources', 'app', '.vite', 'build');

    expect(resolveMainWindowRendererHtmlPath('index.html', mainBundleDir)).toContain(
      join('.vite', 'renderer', 'main_window', 'index.html'),
    );
    expect(resolveMainWindowRendererHtmlPath('setting.html', mainBundleDir)).toContain(
      join('.vite', 'renderer', 'main_window', 'setting.html'),
    );
  });
});

describe('WindowManager setting window registration', () => {
  it('registers the setting IPC callback before loading the renderer', () => {
    const manager = new WindowManager();

    manager.onSettingWindowCreated(() => {
      electronMock.loadOrder.push('callback');
    });
    manager.openSettingWindow();

    expect(electronMock.loadOrder).toEqual(['callback', 'loadFile']);
  });

  it('immediately notifies late subscribers when a setting window already exists', () => {
    const manager = new WindowManager();
    const win = manager.openSettingWindow();
    const callback = vi.fn();

    manager.onSettingWindowCreated(callback);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(win);
  });
});
