import type { ILogger } from './types';
import { LogLevel, DEFAULT_LOG_LEVEL } from './types';

export abstract class Logger implements ILogger {
  private level: LogLevel = DEFAULT_LOG_LEVEL;

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  getLevel(): LogLevel {
    return this.level;
  }

  protected checkLogLevel(level: LogLevel): boolean {
    return this.level <= level;
  }

  abstract trace(eventName: string, data?: Record<string, unknown>): void;
  abstract debug(message: string, ...args: unknown[]): void;
  abstract info(message: string, ...args: unknown[]): void;
  abstract warn(message: string, ...args: unknown[]): void;
  abstract error(message: string | Error, ...args: unknown[]): void;
  abstract fatal(message: string | Error, ...args: unknown[]): void;
  abstract flush(): void;
}

export { DEFAULT_LOG_LEVEL };
