import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { resolveMainWindowRendererHtmlPath } from '@/apps/main/application/electron-main/WindowManager';

vi.mock('electron', () => ({
  app: {
    getAppPath: () => join('/tmp', 'Telegraph.app', 'Contents', 'Resources', 'app'),
    dock: {
      setIcon: vi.fn(),
    },
  },
  BrowserWindow: vi.fn(),
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
