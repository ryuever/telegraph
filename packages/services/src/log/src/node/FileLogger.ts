import fs from 'fs';
import path from 'path';
import os from 'os';
import { Logger, DEFAULT_LOG_LEVEL } from '../common/Logger';
import { LogLevel } from '../common/types';
import type { ILogger } from '../common/types';

const MAX_FILE_SIZE = 5 * 1024 * 1024;
const MAX_BACKUP_FILES = 5;
const FLUSH_INTERVAL_MS = 100;

export interface FileLoggerOptions {
  logDir?: string;
  fileName?: string;
  level?: LogLevel;
  label?: string;
}

function getDefaultLogDir(): string {
  return path.join(os.homedir(), '.telegraph', 'logs');
}

function formatTimestamp(): string {
  const d = new Date();
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const pad3 = (n: number) => String(n).padStart(3, '0');
  return `${String(d.getFullYear())}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}.${pad3(d.getMilliseconds())}`;
}

function stringifyLevel(level: LogLevel): string {
  switch (level) {
    case LogLevel.Trace: return 'trace';
    case LogLevel.Debug: return 'debug';
    case LogLevel.Info: return 'info';
    case LogLevel.Warn: return 'warn';
    case LogLevel.Error: return 'error';
    case LogLevel.Fatal: return 'fatal';
    default: return '';
  }
}

function formatArgs(args: unknown[]): string {
  return args.map(a => {
    if (a instanceof Error) {
      return a.stack ?? a.message;
    }
    if (typeof a === 'object' && a !== null) {
      try {
        return JSON.stringify(a);
      } catch {
        return JSON.stringify(a);
      }
    }
    return String(a);
  }).join(' ');
}

export class FileLogger extends Logger implements ILogger {
  private readonly logDir: string;
  private readonly logFilePath: string;
  private readonly label: string;
  private backupIndex = 1;
  private buffer = '';
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: FileLoggerOptions = {}) {
    super();
    this.logDir = options.logDir ?? getDefaultLogDir();
    this.label = options.label ?? 'telegraph';
    const fileName = options.fileName ?? `${this.label}.log`;
    this.logFilePath = path.join(this.logDir, fileName);
    if (options.level !== undefined) {
      this.setLevel(options.level);
    } else {
      this.setLevel(DEFAULT_LOG_LEVEL);
    }
    this.ensureLogDir();
    this.startFlushTimer();
  }

  private ensureLogDir(): void {
    try {
      if (!fs.existsSync(this.logDir)) {
        fs.mkdirSync(this.logDir, { recursive: true });
      }
    } catch {
      // best effort
    }
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => { this.flush(); }, FLUSH_INTERVAL_MS);
    this.flushTimer.unref();
  }

  private enqueue(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.checkLogLevel(level)) return;
    const suffix = args.length > 0 ? ` ${formatArgs(args)}` : '';
    this.buffer += `${formatTimestamp()} [${stringifyLevel(level)}] [${this.label}] ${message}${suffix}\n`;
  }

  trace(eventName: string, data?: Record<string, unknown>): void {
    this.enqueue(LogLevel.Trace, eventName, data);
  }

  debug(message: string, ...args: unknown[]): void {
    this.enqueue(LogLevel.Debug, message, ...args);
  }

  info(message: string, ...args: unknown[]): void {
    this.enqueue(LogLevel.Info, message, ...args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.enqueue(LogLevel.Warn, message, ...args);
  }

  error(message: string | Error, ...args: unknown[]): void {
    const msg = message instanceof Error ? message.stack ?? message.message : message;
    this.enqueue(LogLevel.Error, msg, ...args);
  }

  fatal(message: string | Error, ...args: unknown[]): void {
    const msg = message instanceof Error ? message.stack ?? message.message : message;
    this.enqueue(LogLevel.Fatal, msg, ...args);
  }

  flush(): void {
    if (!this.buffer) return;
    const data = this.buffer;
    this.buffer = '';
    try {
      this.rotateIfNeeded();
      fs.appendFileSync(this.logFilePath, data, 'utf8');
    } catch {
      // best effort
    }
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logFilePath)) return;
      const stat = fs.statSync(this.logFilePath);
      if (stat.size < MAX_FILE_SIZE) return;

      this.backupIndex = this.backupIndex > MAX_BACKUP_FILES ? 1 : this.backupIndex;
      const backupPath = path.join(
        this.logDir,
        `${this.label}_${String(this.backupIndex++)}.log`
      );
      try {
        if (fs.existsSync(backupPath)) {
          fs.unlinkSync(backupPath);
        }
        fs.renameSync(this.logFilePath, backupPath);
      } catch {
        // best effort — if rename fails, just truncate
        try { fs.truncateSync(this.logFilePath, 0); } catch { /* noop */ }
      }
    } catch {
      // stat failed, skip rotation
    }
  }

  dispose(): void {
    this.flush();
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }
}
