export interface EventEntity {
  eventName: string
  data: Record<string, any>
  localTime: number
}

export type RequestUtil = (
  url: string,
  config: {
    method: string
    headers: Record<string, any>
    body: string
  }
) => Promise<void>

export interface TrackerBaseConfig {
  userId?: string
  appVersion?: string
  rootTraceId?: string
}
