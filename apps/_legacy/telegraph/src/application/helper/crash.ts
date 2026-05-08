import { CrashLog } from '@telegraph/services/log/common/constants'
import type { LogService } from '@telegraph/services/log/common/log'
import { app, crashReporter } from 'electron'
import path from 'path'

export function initCrashListener(logService: LogService) {
  app.setPath('crashDumps', path.join(app.getPath('logs'), 'crashes'))
  // 暂时不上传服务器，只写到本地
  crashReporter.start({
    uploadToServer: false,
  })
  app.on('render-process-gone', (_event, webContents, details) => {
    logService.fatal(CrashLog.RenderProcessGone, {
      ...details,
      url: webContents.getURL(),
    })
  })
  app.on('child-process-gone', (_event, details) => {
    logService.fatal(CrashLog.ChildProcessGone, details)
  })
}
