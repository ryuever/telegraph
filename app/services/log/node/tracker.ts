import fetch from 'node-fetch'
import { TrackerUrl } from '../common/constants'
import type { EventEntity, TrackerBaseConfig } from '../common/types/tracker'

const MaxPendingQueueLen = 5
const MaxPendingTime = 2000 // ms
const TrackerAppName = 'pc-redcity'

/**
 * 上报业务指标到 X-Ray平台
 */
export class DataTracker {
  private pendingQueue: EventEntity[] = []

  private cancelDelayReport: null | (() => void) = null

  private baseConfig: TrackerBaseConfig = {}

  constructor(baseConfig: TrackerBaseConfig) {
    this.baseConfig = baseConfig
  }

  setConfig(config: TrackerBaseConfig) {
    Object.assign(this.baseConfig, config)
  }

  send(eventName: string, data: Record<string, any>) {
    const event: EventEntity = {
      eventName,
      data,
      localTime: Date.now(),
    }
    this.pendingQueue.push(event)
    if (this.shouldReport(event)) {
      this.report()
    } else {
      this.delayReport()
    }
  }

  flush() {
    this.report()
  }

  private formatRequestData(event: EventEntity) {
    const { eventName, data, localTime } = event
    const { userId = '', appVersion = '1.0.0', rootTraceId } = this.baseConfig
    return {
      clientTime: localTime,
      context_platform: process.platform,
      context_artifactVersion: appVersion,
      context_userId: userId,
      context_artifactName: TrackerAppName,
      custom_c1: rootTraceId,
      measurement_name: eventName,
      measurement_data: data,
    }
  }

  private delayReport() {
    // this.cancelDelayReport 存在表示已经存在一个延迟上报任务了
    if (!this.cancelDelayReport) {
      const tid = setTimeout(() => {
        this.cancelDelayReport = null
        this.report()
      }, MaxPendingTime)
      this.cancelDelayReport = () => {
        clearTimeout(tid)
        this.cancelDelayReport = null
      }
    }
  }

  private shouldReport(_event: EventEntity) {
    // 后续可以根据 event 来做一些策略
    if (this.pendingQueue.length === MaxPendingQueueLen) {
      return true
    }
    return false
  }

  private report() {
    const curQueue = this.pendingQueue.slice()
    this.pendingQueue.length = 0
    this.cancelDelayReport?.()
    this.request(curQueue)
  }

  private request(queue: EventEntity[]) {
    const data = queue.map(item => this.formatRequestData(item))
    fetch(TrackerUrl, {
      method: 'post',
      headers: {
        'Content-Type': 'application/json',
        'biz-type': 'apm_fe',
        batch: 'true',
      },
      body: JSON.stringify(data),
    })
  }
}
