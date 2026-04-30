import { createId, inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import { Event } from '@x-oasis/emitter'
import { TrackerEvent, TrackerScene } from '@app/services/log/common/constants'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId } from '@app/services/log/common/log'
import { MainProcessUtilsClient } from '@app/services/main-process-util/common/config'
import type { AppMetric, IMainProcessUtils } from '@app/services/main-process-util/common/types'

export const DiagnosticsId = createId('diagnostics')

const NetworkServiceProcess = 'Network Service'
const GPUProcess = 'GPU'

@injectable()
class Diagnostics extends Disposable {
  private onPerformanceInfoEvent = new Event({ name: 'on-performance-info' })

  onPerformanceInfo = this.onPerformanceInfoEvent.subscribe

  constructor(
    @inject(LogServiceId) private logService: LogService,
    @inject(MainProcessUtilsClient) private mainProcessUtilsClient: IMainProcessUtils
  ) {
    super()
    this.diagnosticRoutine()
  }

  private excludeInfo(appMetric: AppMetric) {
    return appMetric.type === GPUProcess || appMetric.name === NetworkServiceProcess
  }

  async getPerformanceInfo() {
    const result = await this.mainProcessUtilsClient.getAppMetrics()
    const formatInfos: { memory: number; cpu: number; name?: string }[] = []
    let totalMemory: number = 0 // MB
    let totalCPU: number = 0 // percent
    for (const item of result) {
      if (this.excludeInfo(item)) {
        continue
      }
      const formatInfo = {
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
    return formatInfos
  }

  diagnosticRoutine() {
    setInterval(() => {
      this.getPerformanceInfo().then(value => {
        this.onPerformanceInfoEvent.fire(value)
      })
    }, 5000)
  }
}

export default Diagnostics
