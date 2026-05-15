export enum LogLevel {
  Trace = 10,
  Debug = 20,
  Info = 30,
  Warn = 40,
  Error = 50,
  Fatal = 60,
}

export const DEFAULT_LOG_LEVEL = LogLevel.Info;

export interface ILogger {
  getLevel(): LogLevel;
  setLevel(level: LogLevel): void;
  trace(eventName: string, data?: Record<string, unknown>): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
  fatal(message: string | Error, ...args: unknown[]): void;
  flush(): void;
}

export interface ILogProps {
  logger: ILogger;
}
