import nodeLogger from 'electron-log/node'
import path from 'path'
import type { LogFunctions } from 'electron-log'
import type { ILogger, NodeLogParams } from '../common/types'
import { LogLevel } from '../common/types'
import { SentryReport } from './sentry'
import { DataTracker } from './tracker'

/**
 * 超过最大字节日志后，会转移到 old.log，所以最终本地会存储 maxLogFileSize * 2 的日志量
 */
const maxLogFileSize = 500 * 1024 ** 2 // 500MB 日志
const IS_DEV = process.env.NODE_ENV === 'development'

export class CommonNodeLogger implements ILogger {
  private logger: LogFunctions

  private reporter?: SentryReport

  private tracker?: DataTracker

  constructor(options: NodeLogParams) {
    const { bizName, rootTraceId, appVersion } = options
    this.logger = this.initLogInfo(bizName)
    if (!IS_DEV) {
      this.reporter = new SentryReport(bizName, rootTraceId, appVersion)
      this.tracker = new DataTracker({
        rootTraceId,
        appVersion,
      })
    }
  }

  private initLogInfo(bizName: string) {
    const curLoggerInstance = nodeLogger.create({
      logId: bizName,
    })
    const fileTransport = curLoggerInstance.transports.file
    fileTransport.fileName = `${bizName}.log`
    fileTransport.sync = false
    fileTransport.maxSize = maxLogFileSize
    if (IS_DEV) {
      // false 表示不写文件
      fileTransport.level = false
    } else {
      // false 表示不输出 console
      curLoggerInstance.transports.console.level = false
    }
    return curLoggerInstance.scope(bizName)
  }

  private formatMessage(...args: any[]) {
    return args
  }

  getLevel() {
    return LogLevel.Info
  }

  setLevel(level: LogLevel) {}

  setUserInfo(user: { id?: string | number; email?: string; username?: string }) {
    this.reporter?.setUserInfo(user)
    this.tracker?.setConfig({
      userId: `${user.id}` ?? user.email ?? user.username,
    })
  }

  trace(eventName: string, data?: Record<string, any>): void {
    this.tracker?.send(eventName, data ?? {})
    if (IS_DEV) {
      this.info(eventName, data)
    }
  }

  debug(...args: any[]): void {
    this.logger.debug(...this.formatMessage(...args))
    this.reporter?.info(...args)
  }

  info(...args: any[]): void {
    this.logger.info(...this.formatMessage(...args))
    this.reporter?.info(...args)
  }

  warn(...args: any[]): void {
    this.logger.warn(...this.formatMessage(...args))
    this.reporter?.warn(...args)
  }

  error(...args: any[]): void {
    this.logger.error(...this.formatMessage(...args))
    this.reporter?.error(...args)
  }

  fatal(...args: any[]): void {
    this.logger.error(...this.formatMessage(...args))
    this.reporter?.fatal(...args)
  }
}

export function getLogPath() {
  return path.dirname(nodeLogger.transports.file.getFile().path)
}
