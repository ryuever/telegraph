import { FileLogger } from './FileLogger';
import type { ILogger } from '../common/types';
import { LogLevel } from '../common/types';

export function createLogger(label: string, options?: { logDir?: string; level?: LogLevel }): ILogger {
  return new FileLogger({ label, ...options });
}
