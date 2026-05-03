import type { Formatter } from '@x-oasis/ansi-colors'

export enum LogLevel {
  Trace = 10,
  Debug = 20,
  Info = 30,
  Warn = 40,
  Error = 50,
  Fatal = 60,
}

export type ILogger = {
  getLevel(): LogLevel
  setLevel(level: LogLevel): void

  trace(eventName: string, data?: Record<string, any>): void
  debug(message: string, ...args: any[]): void
  info(message: string, ...args: any[]): void
  warn(message: string, ...args: any[]): void
  fatal(message: string, ...args: any[]): void
  error(message: string | Error, ...args: any[]): void
  setUserInfo?(user: { id?: string | number; email?: string; username?: string }): void
}

export type ILogProps = {
  logger: ILogger
}

export interface IColor {
  entire: Formatter
  entry: Formatter
}

export interface NodeLogParams {
  bizName: string
  rootTraceId: string
  appVersion: string
  appName: string
}
