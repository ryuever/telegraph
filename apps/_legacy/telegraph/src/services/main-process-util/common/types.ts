export interface AppMetric {
  type: string
  name?: string
  pid: number
  cpu: {
    percentCPUUsage: number
    idleWakeupsPerSecond: number
  }
  memory: {
    workingSetSize: number
    peakWorkingSetSize: number
  }
}
export interface IMainProcessUtils {
  showOpenDialog: (options: {
    title?: string
    defaultPath?: string
    filters?: {
      name: string
      extensions: string[]
    }[]
    properties?: ('openFile' | 'openDirectory' | 'multiSelections')[]
  }) => Promise<{
    canceled: boolean
    filePaths: string[]
  }>
  showSaveDialog: (options: {
    title?: string
    defaultPath?: string
    filters?: {
      name: string
      extensions: string[]
    }[]
  }) => Promise<{
    canceled: boolean
    filePath?: string
  }>
  getAppMetrics: () => Promise<AppMetric[]>
}
