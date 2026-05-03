import type { PerformanceStage } from './constants/tracker'
import { TrackerEvent } from './constants/tracker'

type TrackerFn = (eventName: string, data?: Record<string, any>) => void

export class PerformanceTracker {
  private map: Map<PerformanceStage, number> = new Map()

  constructor(private tracker: TrackerFn) {}

  start = (stage: PerformanceStage) => {
    this.map.set(stage, Date.now())
  }

  end = (stage: PerformanceStage) => {
    if (this.map.has(stage)) {
      const start = this.map.get(stage)!
      this.map.delete(stage)
      this.tracker(TrackerEvent.TelegraphPerformance, {
        duration: Date.now() - start,
        stage,
      })
    }
  }
}
