import { inject, injectable } from '@x-oasis/di'
import { WindowManagerId } from '@telegraph/services/window-manager/electron-main/WindowManager'
import type { WindowManager } from '@telegraph/services/window-manager/electron-main/WindowManager'
import { MONITOR_SNAPSHOT_CHANNEL } from '../common/config'
import type { IMonitorBridge } from '../common/types'

@injectable()
export class MonitorBridge implements IMonitorBridge {
  constructor(@inject(WindowManagerId) private windowManager: WindowManager) {}

  pushSnapshot: IMonitorBridge['pushSnapshot'] = async _snapshot => {
    // 数据收集已移至 PageletProcess (apps/monitor)
    // 不再通过 IPC 推送给 renderer（现在通过 MessagePort 获取）
  }

  getMainPid: IMonitorBridge['getMainPid'] = async () => process.pid

  toggleMonitorWindow = () => {
    this.windowManager.toggleMonitorWindow()
  }
}
