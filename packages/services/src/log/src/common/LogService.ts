import { createId } from '@x-oasis/di';
import type { ILogger, ILogProps } from './types';
import { LogLevel } from './types';

export const LogServiceId = createId('LogService');

export class LogService implements ILogger {
  protected readonly logger: ILogger;

  constructor(props: ILogProps) {
    this.logger = props.logger;
  }

  setLevel(level: LogLevel): void {
    this.logger.setLevel(level);
  }

  getLevel(): LogLevel {
    return this.logger.getLevel();
  }

  trace(eventName: string, data?: Record<string, unknown>): void {
    this.logger.trace(eventName, data);
  }

  debug(message: string, ...args: unknown[]): void {
    this.logger.debug(message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.logger.info(message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.logger.warn(message, ...args);
  }

  error(message: string | Error, ...args: unknown[]): void {
    this.logger.error(message, ...args);
  }

  fatal(message: string | Error, ...args: unknown[]): void {
    this.logger.fatal(message, ...args);
  }

  flush(): void {
    this.logger.flush();
  }
}
