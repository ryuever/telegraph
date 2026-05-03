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
    monitor?.window?.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
  }

  getMainPid: IMonitorBridge['getMainPid'] = async () => process.pid

  toggleMonitorWindow = () => {
    this.windowManager.toggleMonitorWindow()
  }
}
