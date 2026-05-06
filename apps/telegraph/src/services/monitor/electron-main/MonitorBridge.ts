import { inject, injectable } from '@x-oasis/di'
import { WindowManagerId } from '@telegraph/services/window-manager/electron-main/WindowManager'
import type { WindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager'
import { MONITOR_SNAPSHOT_CHANNEL } from '../common/config'
import type { IMonitorBridge } from '../common/types'

@injectable()
export class MonitorBridge implements IMonitorBridge {
  constructor(@inject(WindowManagerId) private windowManager: WindowManager) {}

  pushSnapshot: IMonitorBridge['pushSnapshot'] = async snapshot => {
    const monitor = this.windowManager.getMonitorWindow()
    if (!monitor?.window) return

    // Monitor 通过 Pagelet 机制加载，UI 在 BrowserView 中
    // 需要向所有 BrowserView 的 webContents 推送数据
    const browserViews = monitor.window.getBrowserViews()
    if (browserViews.length > 0) {
      for (const view of browserViews) {
        view.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
      }
    } else {
      // 兼容：如果没有 BrowserView，回退到 window webContents
      monitor.window.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
    }
  }

  getMainPid: IMonitorBridge['getMainPid'] = async () => process.pid

  toggleMonitorWindow = () => {
    this.windowManager.toggleMonitorWindow()
  }
}
