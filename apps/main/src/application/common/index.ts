import { createId } from '@x-oasis/di';
import type { BrowserWindow } from 'electron';
import type { MainSwitchPagePayload } from '@/packages/services/pagelet-host/common';

export { ORCHESTRATOR_CP_CHANNEL_NAME, ORCHESTRATOR_PROJECT_NAME, CONNECTION_PAGE, MONITOR_PAGE, DESIGN_PAGE, CHAT_PAGE, ALL_PAGES } from './cp-config';
export type { PageConfig } from './cp-config';

export interface IWindowManager {
  openMainWindow(): BrowserWindow;
  getMainWindow(): BrowserWindow | null;
  openSettingWindow(): BrowserWindow | null;
  getSettingWindow(): BrowserWindow | null;
  onSettingWindowCreated(callback: (win: BrowserWindow) => void): void;
  setSwitchPageCallback(callback: (pageId: string, payload?: MainSwitchPagePayload) => void): void;
  switchPage(pageId: string, payload?: MainSwitchPagePayload): boolean;
}

export const WindowManagerId = createId('WindowManager');
