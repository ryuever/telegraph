import { createId, inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { getLogPath } from '@app/services/log/node/nodeLogger'
import type { Workbench } from '@app/services/workbench/electron-main/Workbench'
import { WorkbenchId } from '@app/services/workbench/electron-main/Workbench'
import type { MonitorBridge } from '@app/services/monitor/electron-main/MonitorBridge'
import { MonitorBridgeId } from '@app/services/monitor/common/config'
import { app, Menu, shell } from 'electron'

export const RedcityMenuId = createId('redcity-menu')

@injectable()
export class RedcityMenu extends Disposable {
  constructor(
    @inject(WorkbenchId) private workbench: Workbench,
    @inject(MonitorBridgeId) private monitorBridge: MonitorBridge
  ) {
    super()
  }

  init() {
    const isMac = process.platform === 'darwin'

    const template = [
      ...(isMac
        ? [
            {
              label: app.name,
              submenu: [
                { role: 'about' },
                { type: 'separator' },
                { role: 'services' },
                { type: 'separator' },
                { role: 'hide' },
                { role: 'hideOthers' },
                { role: 'unhide' },
                { type: 'separator' },
                { role: 'quit' },
              ],
            },
          ]
        : []),
      // { role: 'fileMenu' }
      {
        label: 'File',
        submenu: [isMac ? { role: 'close' } : { role: 'quit' }],
      },
      // { role: 'editMenu' }
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' },
          { role: 'redo' },
          { type: 'separator' },
          { role: 'cut' },
          { role: 'copy' },
          { role: 'paste' },
          ...(isMac
            ? [
                { role: 'pasteAndMatchStyle' },
                { role: 'delete' },
                { role: 'selectAll' },
                { type: 'separator' },
                {
                  label: 'Speech',
                  submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }],
                },
              ]
            : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }]),
        ],
      },
      // { role: 'viewMenu' }
      {
        label: 'View',
        submenu: [
          {
            label: 'Toggle Monitor',
            accelerator: 'CmdOrCtrl+Shift+M',
            click: () => this.monitorBridge.toggleMonitorWindow(),
          },
          { type: 'separator' },
          { role: 'reload' },
          { role: 'forceReload' },
          { role: 'toggleDevTools' },
          { type: 'separator' },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { type: 'separator' },
          { role: 'togglefullscreen' },
        ],
      },
      // { role: 'windowMenu' }
      {
        label: 'Window',
        submenu: [
          { role: 'minimize' },
          { role: 'zoom' },
          ...(isMac
            ? [{ type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
            : [{ role: 'close' }]),
        ],
      },
      {
        role: 'help',
        submenu: [
          {
            label: 'Learn More',
            click: async () => {
              await shell.openExternal('https://electronjs.org')
            },
          },
          {
            label: 'Explorer',
            click: () => {
              this.workbench.createAuxiliaryWindow()
            },
          },
          {
            label: 'Open Log',
            click: async () => {
              await shell.openPath(getLogPath())
            },
          },
        ],
      },
    ]

    const menu = Menu.buildFromTemplate(template as any)
    Menu.setApplicationMenu(menu)
  }
}
