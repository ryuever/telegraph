import { app } from 'electron'

/**
 * 初始化 redcity 关于面板
 */
export function initAboutInfo() {
  app.setAboutPanelOptions({
    applicationName: app.getName(),
    applicationVersion: app.getVersion(),
    version: app.getVersion(),
  })
}
