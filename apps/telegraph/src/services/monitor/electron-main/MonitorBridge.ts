import { inject, injectable } from '@x-oasis/di'
import { WindowManagerId } from '@telegraph/services/window-manager/electron-main/WindowManager'
import type { WindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager'
import { MONITOR_SNAPSHOT_CHANNEL } from '../common/config'
import type { IMonitorBridge } from '../common/types'

@injectable()
export class MonitorBridge implements IMonitorBridge {
  constructor(@inject(WindowManagerId) private windowManager: WindowManager) {}

  pushSnapshot: IMonitorBridge['pushSnapshot'] = async snapshot => {
    // 向主窗口推送，支持 Sidebar 内嵌的 Monitor 面板（#/monitor 路由）
    const mainWindow = this.windowManager.getMainWindow()
    if (mainWindow?.window && !mainWindow.window.isDestroyed()) {
      mainWindow.window.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
    }

    // 向独立 Monitor 窗口推送（Pagelet 机制，UI 在 BrowserView 中）
    const monitor = this.windowManager.getMonitorWindow()
    if (!monitor?.window) return

    const browserViews = monitor.window.getBrowserViews()
    if (browserViews.length > 0) {
      for (const view of browserViews) {
        view.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
      }
    } else {
      monitor.window.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
    }
  }

  getMainPid: IMonitorBridge['getMainPid'] = async () => process.pid

  toggleMonitorWindow = () => {
    this.windowManager.toggleMonitorWindow()
  }
}
