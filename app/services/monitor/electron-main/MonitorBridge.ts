import { inject, injectable } from '@x-oasis/di'
import { WindowManagerId } from '@app/services/window-manager/electron-main/WindowManager'
import type { WindowManager } from '@app/services/window-manager/electron-main/WindowManager'
import { MONITOR_SNAPSHOT_CHANNEL, MONITOR_TOGGLE_CHANNEL } from '../common/config'
import type { IMonitorBridge, MonitorSnapshot } from '../common/types'

@injectable()
export class MonitorBridge implements IMonitorBridge {
  constructor(@inject(WindowManagerId) private windowManager: WindowManager) {}

  pushSnapshot: IMonitorBridge['pushSnapshot'] = async snapshot => {
    const main = this.windowManager.getMainWindow()
    main?.window?.webContents?.send(MONITOR_SNAPSHOT_CHANNEL, snapshot)
  }

  getMainPid: IMonitorBridge['getMainPid'] = async () => process.pid

  toggleDrawer = () => {
    const main = this.windowManager.getMainWindow()
    main?.window?.webContents?.send(MONITOR_TOGGLE_CHANNEL)
  }
}
