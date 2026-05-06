export type BrowserViewConfig = {
  projectName: string
  loadURL: string
  webPreferences: {
    preload: string
  }
  amdEntry?: string
  /** dev 模式下是否自动打开 DevTools，默认 true */
  openDevTools?: boolean
}
