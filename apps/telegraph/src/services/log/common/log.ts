import { Disposable } from '@x-oasis/disposable'
import { injectable } from '@x-oasis/di'
import type { ILogger, ILogProps } from './types'
import { LogLevel } from './types'

export const DEFAULT_LOG_LEVEL = LogLevel.Info

export const LogServiceId = 'log-service'
export const LogServicePath = '/services/log'
export const LogClient = 'node-log-client'

@injectable()
export class LogService extends Disposable implements ILogger {
  protected readonly logger: ILogger

  constructor(props: ILogProps) {
    super()
    this.logger = props?.logger
  }

  setLevel(level: LogLevel): void {
    this.logger.setLevel(level)
  }

  getLevel(): LogLevel {
    return this.logger.getLevel()
  }

  trace(eventName: string, data?: Record<string, any>) {
    this.logger.trace(eventName, data)
  }

  debug(message: string, ...args: any[]) {
    this.logger.debug(message, ...args)
  }

  info(message: string, ...args: any[]) {
    this.logger.info(message, ...args)
  }

  error(message: string, ...args: any[]) {
    this.logger.error(message, ...args)
  }

  fatal(message: string, ...args: any[]) {
    this.logger.fatal(message, ...args)
  }

  warn(message: string, ...args: any[]) {
    this.logger.warn(message, ...args)
  }

  setUserInfo(user: { id?: string | number; email?: string; username?: string }): void {
    this.logger.setUserInfo?.(user)
  }
}
