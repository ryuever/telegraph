import { format } from '@x-oasis/format-date'
import { init, setTag, setUser, captureEvent, withScope } from '@sentry/node'

type SentryLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug'

const now = () => format('YYYY/MM/dd HH:mm:ss.sss', new Date())
const tagReg = /^\[tag:(.+)\]$/
// 默认 tag
const DefaultTag = 'pc_telegraph_log_tag'
const DefaultGroup = 'pc_telegraph_log_group'

/**
 * https://new-sentry.devops.xiaohongshu.com/organizations/sentry/discover/results/?field=title&field=event.type&field=project&field=user.display&field=timestamp&name=All+Events&project=177&query=&sort=-timestamp&statsPeriod=24h&yAxis=count%28%29
 */
export class SentryReport {
  constructor(
    private bizName: string,
    rootTraceId: string,
    appVersion: string
  ) {
    init({
      dsn: 'https://6dfd3c8f45104e178fb159956adb94b8@new-sentry-relay.xiaohongshu.com/177',
      tracesSampleRate: 1.0,
    })
    setTag('app_version', appVersion)
    setTag('biz_name', this.bizName)
    // 客户端启动时会生成一个唯一 ID，可以贯穿所有日志，无论是否登录
    setTag('root_trace_id', rootTraceId)
  }

  private parseTag(message: string) {
    const matches = message.match(tagReg)
    if (matches) {
      return matches[1]
    }
    return ''
  }

  private formatMessage(...args: any[]) {
    let message = `[${now()}][${this.bizName}]`
    const data: Record<string, any> = {}
    let tag: string = ''
    args.forEach(v => {
      if (v === undefined || v === null) {
        return
      }
      switch (typeof v) {
        case 'string': {
          // 如果参数为 [tag:xxx]，则认为是 tag 标记
          const messageTag = this.parseTag(v)
          if (messageTag) {
            tag = messageTag
          } else {
            message += ` ${v}`
          }
          break
        }
        case 'object': {
          Object.assign(data, v)
          break
        }
        default: {
          message += ` ${JSON.stringify(v)}`
          break
        }
      }
    })
    return {
      message,
      data,
      tag,
    }
  }

  private send(level: SentryLevel, ...args: any[]) {
    withScope(scope => {
      const { message, data, tag } = this.formatMessage(...args)
      tag && scope.setTag(DefaultTag, tag)
      // 对于 info 类日志，本意不希望是一个 issue，但是 sentry 无法做到，只能将 info 日志聚合为一个 issue
      level === 'info' && scope.setFingerprint([DefaultGroup])
      captureEvent({
        message,
        extra: data,
        level,
      })
    })
  }

  /**
   * 设置用户信息，方便基于用户信息筛选日志
   * @param user
   */
  setUserInfo(user: { id?: string | number; email?: string; username?: string }) {
    setUser(user)
  }

  info(...args: any[]): void {
    this.send('info', ...args)
  }

  warn(...args: any[]): void {
    this.send('warning', ...args)
  }

  error(...args: any[]): void {
    this.send('error', ...args)
  }

  fatal(...args: any[]): void {
    this.send('fatal', ...args)
  }
}
