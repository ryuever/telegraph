import { dialog, app } from 'electron'
import { injectable } from '@x-oasis/di'
import type { IMainProcessUtils } from '../common/types'

/**
 * 将只能用于主进程的工具方法作为一个服务提供给其他进程使用
 */
@injectable()
export class MainProcessUtils implements IMainProcessUtils {
  showOpenDialog: IMainProcessUtils['showOpenDialog'] = options => {
    return dialog.showOpenDialog(options)
  }

  showSaveDialog: IMainProcessUtils['showSaveDialog'] = options => {
    return dialog.showSaveDialog(options)
  }

  getAppMetrics: IMainProcessUtils['getAppMetrics'] = async () => {
    return app.getAppMetrics()
  }
}
