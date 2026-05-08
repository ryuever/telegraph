import { injectable, createId } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export const MonitorApplicationId = createId('monitor-application')

export interface ProcessRow {
  pid: number
  ppid: number
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

export interface MonitorService {
  getSnapshot(): Promise<MonitorSnapshot>
  getMainPid(): Promise<number>
  start(): void
  stop(): void
}

@injectable()
export default class MonitorApplication extends Disposable implements MonitorService {
  private intervalId: NodeJS.Timeout | null = null
  private snapshotCallback: ((snapshot: MonitorSnapshot) => void) | null = null

  start() {
    console.log('[MonitorApplication] starting...')
    
    this.intervalId = setInterval(async () => {
      try {
        const snapshot = await this.collectSnapshot()
        if (this.snapshotCallback) {
          this.snapshotCallback(snapshot)
        }
      } catch (error) {
        console.error('[MonitorApplication] Error collecting snapshot:', error)
      }
    }, 1000)
    
    console.log('[MonitorApplication] started successfully')
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId)
      this.intervalId = null
    }
    console.log('[MonitorApplication] stopped')
  }

  onSnapshot(callback: (snapshot: MonitorSnapshot) => void) {
    this.snapshotCallback = callback
  }

  async getMainPid(): Promise<number> {
    return process.pid
  }

  async getSnapshot(): Promise<MonitorSnapshot> {
    return this.collectSnapshot()
  }

  private async collectSnapshot(): Promise<MonitorSnapshot> {
    const timestamp = Date.now()
    const platform = process.platform
    
    let processes: ProcessRow[] = []
    let pidTree: PidTreeJson | null = null
    let totals = { cpu: 0, memory: 0 }

    if (platform === 'darwin') {
      const result = await this.collectMacProcesses()
      processes = result.processes
      pidTree = result.pidTree
      totals = result.totals
    } else if (platform === 'linux') {
      const result = await this.collectLinuxProcesses()
      processes = result.processes
      pidTree = result.pidTree
      totals = result.totals
    } else if (platform === 'win32') {
      const result = await this.collectWindowsProcesses()
      processes = result.processes
      pidTree = result.pidTree
      totals = result.totals
    }

    return {
      timestamp,
      totals,
      processes,
      pidTree,
    }
  }

  private async collectMacProcesses(): Promise<{ processes: ProcessRow[]; pidTree: PidTreeJson | null; totals: { cpu: number; memory: number } }> {
    try {
      const { stdout } = await execAsync('ps -ax -o pid,ppid,%cpu,%mem,comm | head -50')
      const lines = stdout.trim().split('\n').slice(1)
      const processes: ProcessRow[] = lines.map(line => {
        const parts = line.trim().split(/\s+/)
        return {
          pid: parseInt(parts[0], 10),
          ppid: parseInt(parts[1], 10),
          cpu: parseFloat(parts[2]) || 0,
          memory: parseFloat(parts[3]) || 0,
          name: parts[4] || '',
          type: 'process',
        }
      }).filter(p => !isNaN(p.pid))

      let totals = { cpu: 0, memory: 0 }
      processes.forEach(p => {
        totals.cpu += p.cpu
        totals.memory += p.memory
      })

      const pidTree = this.buildPidTree(processes)

      return { processes, pidTree, totals }
    } catch (error) {
      console.error('[MonitorApplication] Error collecting Mac processes:', error)
      return { processes: [], pidTree: null, totals: { cpu: 0, memory: 0 } }
    }
  }

  private async collectLinuxProcesses(): Promise<{ processes: ProcessRow[]; pidTree: PidTreeJson | null; totals: { cpu: number; memory: number } }> {
    try {
      const { stdout } = await execAsync('ps -eo pid,ppid,%cpu,%mem,comm --no-headers | head -50')
      const lines = stdout.trim().split('\n')
      const processes: ProcessRow[] = lines.map(line => {
        const parts = line.trim().split(/\s+/)
        return {
          pid: parseInt(parts[0], 10),
          ppid: parseInt(parts[1], 10),
          cpu: parseFloat(parts[2]) || 0,
          memory: parseFloat(parts[3]) || 0,
          name: parts[4] || '',
          type: 'process',
        }
      }).filter(p => !isNaN(p.pid))

      let totals = { cpu: 0, memory: 0 }
      processes.forEach(p => {
        totals.cpu += p.cpu
        totals.memory += p.memory
      })

      const pidTree = this.buildPidTree(processes)

      return { processes, pidTree, totals }
    } catch (error) {
      console.error('[MonitorApplication] Error collecting Linux processes:', error)
      return { processes: [], pidTree: null, totals: { cpu: 0, memory: 0 } }
    }
  }

  private async collectWindowsProcesses(): Promise<{ processes: ProcessRow[]; pidTree: PidTreeJson | null; totals: { cpu: number; memory: number } }> {
    try {
      const { stdout } = await execAsync('wmic process get ProcessId,ParentProcessId,WorkingSetSize /format:csv')
      const lines = stdout.trim().split('\n').slice(1)
      const processes: ProcessRow[] = []
      
      for (const line of lines) {
        const parts = line.split(',')
        if (parts.length >= 4) {
          const pid = parseInt(parts[1], 10)
          const ppid = parseInt(parts[2], 10)
          const mem = parseInt(parts[3], 10) / (1024 * 1024)
          
          if (!isNaN(pid)) {
            processes.push({
              pid,
              ppid: isNaN(ppid) ? 0 : ppid,
              cpu: 0,
              memory: mem,
              name: '',
              type: 'process',
            })
          }
        }
      }

      let totals = { cpu: 0, memory: 0 }
      processes.forEach(p => {
        totals.memory += p.memory
      })

      const pidTree = this.buildPidTree(processes)

      return { processes, pidTree, totals }
    } catch (error) {
      console.error('[MonitorApplication] Error collecting Windows processes:', error)
      return { processes: [], pidTree: null, totals: { cpu: 0, memory: 0 } }
    }
  }

  private buildPidTree(processes: ProcessRow[]): PidTreeJson | null {
    const map = new Map<number, PidTreeJson>()
    
    processes.forEach(p => {
      map.set(p.pid, {
        pid: p.pid.toString(),
        ppid: p.ppid.toString(),
        cpu: p.cpu.toString(),
        mem: p.memory.toString(),
        command: p.name || '',
        children: [],
      })
    })

    let root: PidTreeJson | null = null

    map.forEach(node => {
      const ppid = parseInt(node.ppid, 10)
      if (ppid === 0 || !map.has(ppid)) {
        if (!root) root = node
        else if (node.children.length > 0 || map.size < 10) {
          root.children.push(node)
        }
      } else {
        const parent = map.get(ppid)
        if (parent) {
          parent.children.push(node)
        }
      }
    })

    return root
  }

  dispose() {
    this.stop()
    super.dispose()
  }
}