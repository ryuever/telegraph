export interface ProcessRow {
  pid: number
  name?: string
  type: string
  cpu: number
  memory: number
}

export interface PidTreeJson {
  pid: string
  ppid: string
  cpu: string
  mem: string
  command: string
  children: PidTreeJson[]
}

export interface MonitorSnapshot {
  timestamp: number
  totals: { cpu: number; memory: number }
  processes: ProcessRow[]
  pidTree: PidTreeJson | null
}

export interface IMonitorBridge {
  pushSnapshot(snapshot: MonitorSnapshot): Promise<void>
  getMainPid(): Promise<number>
}
