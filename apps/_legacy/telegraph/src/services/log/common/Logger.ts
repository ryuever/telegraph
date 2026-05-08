import { Disposable } from '@x-oasis/disposable'
import type { ILogger } from './types'
import { LogLevel } from './types'

export const DEFAULT_LOG_LEVEL = LogLevel.Info

export default abstract class Logger extends Disposable implements ILogger {
  private level: LogLevel = DEFAULT_LOG_LEVEL
  // private readonly _onDidChangeLogLevel: Emitter<LogLevel> = this._register(new Emitter<LogLevel>());
  // readonly onDidChangeLogLevel: Event<LogLevel> = this._onDidChangeLogLevel.event;

  setLevel(level: LogLevel): void {
    if (this.level !== level) {
      this.level = level
      // this._onDidChangeLogLevel.fire(this.level);
    }
  }

  getLevel(): LogLevel {
    return this.level
  }

  protected checkLogLevel(level: LogLevel): boolean {
    return this.level <= level
  }

  abstract trace(eventName: string, data?: Record<string, any>): void

  abstract debug(message: string, ...args: any[]): void

  abstract info(message: string, ...args: any[]): void

  abstract warn(message: string, ...args: any[]): void

  abstract error(message: string | Error, ...args: any[]): void

  abstract fatal(message: string | Error, ...args: any[]): void
}
