import { createId, inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { Event } from '@x-oasis/emitter'
import { TrackerEvent, TrackerScene } from '@app/services/log/common/constants'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId } from '@app/services/log/common/log'
import { MainProcessUtilsClient } from '@app/services/main-process-util/common/config'
import type { AppMetric, IMainProcessUtils } from '@app/services/main-process-util/common/types'
import { MonitorBridgeClient } from '@app/services/monitor/common/config'
import type {
  IMonitorBridge,
  MonitorSnapshot,
  PidTreeJson,
  ProcessRow,
} from '@app/services/monitor/common/types'
import { getUsageInfo } from '@app/core/node/process/process-utils'

export const DiagnosticsId = createId('diagnostics')

const NetworkServiceProcess = 'Network Service'
const GPUProcess = 'GPU'

@injectable()
class Diagnostics extends Disposable {
  private onPerformanceInfoEvent = new Event({ name: 'on-performance-info' })

  onPerformanceInfo = this.onPerformanceInfoEvent.subscribe

  private mainPid: number | null = null

  constructor(
    @inject(LogServiceId) private logService: LogService,
    @inject(MainProcessUtilsClient) private mainProcessUtilsClient: IMainProcessUtils,
    @inject(MonitorBridgeClient) private monitorBridgeClient: IMonitorBridge
  ) {
    super()
    this.diagnosticRoutine()
  }

  private excludeInfo(appMetric: AppMetric) {
    return appMetric.type === GPUProcess || appMetric.name === NetworkServiceProcess
  }

  async getPerformanceInfo() {
    const result = await this.mainProcessUtilsClient.getAppMetrics()
    const formatInfos: ProcessRow[] = []
    let totalMemory = 0 // MB
    let totalCPU = 0 // percent
    for (const item of result) {
      if (this.excludeInfo(item)) {
        continue
      }
      const formatInfo: ProcessRow = {
        memory: +(item.memory.workingSetSize / 1024).toFixed(2),
        cpu: +item.cpu.percentCPUUsage.toFixed(2),
        name: item.name,
        type: item.type,
        pid: item.pid,
      }
      totalMemory += formatInfo.memory
      totalCPU += formatInfo.cpu
      formatInfos.push(formatInfo)
    }
    this.logService.trace(TrackerEvent.RedCityStabilityValues, {
      scene: TrackerScene.AppUsedMemory,
      value: +totalMemory.toFixed(2),
    })
    this.logService.trace(TrackerEvent.RedCityStabilityValues, {
      scene: TrackerScene.AppUsedCPU,
      value: +totalCPU.toFixed(2),
    })
    return {
      processes: formatInfos,
      totals: {
        memory: +totalMemory.toFixed(2),
        cpu: +totalCPU.toFixed(2),
      },
    }
  }

  private async resolveMainPid(): Promise<number | null> {
    if (this.mainPid != null) return this.mainPid
    try {
      this.mainPid = await this.monitorBridgeClient.getMainPid()
      return this.mainPid
    } catch {
      return null
    }
  }

  private async getPidTree(): Promise<PidTreeJson | null> {
    const pid = await this.resolveMainPid()
    if (pid == null) return null
    try {
      const tree = (await getUsageInfo(String(pid))) as PidTreeJson | undefined
      return tree ?? null
    } catch {
      return null
    }
  }

  private async tick() {
    const perf = await this.getPerformanceInfo()
    this.onPerformanceInfoEvent.fire(perf.processes)

    const pidTree = await this.getPidTree()
    const snapshot: MonitorSnapshot = {
      timestamp: Date.now(),
      totals: perf.totals,
      processes: perf.processes,
      pidTree,
    }

    try {
      await this.monitorBridgeClient.pushSnapshot(snapshot)
    } catch (err) {
      // Snapshot delivery failures shouldn't kill the routine.
    }
  }

  diagnosticRoutine() {
    setInterval(() => {
      this.tick()
    }, 5000)
  }
}

export default Diagnostics
