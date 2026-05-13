// Phase 1 — minimal file-based LogService.
// Writes to /tmp/telegraph-main.log so we can observe the main process when
// `pnpm start` is launched without a TTY (forge swallows stdout in that case).
// Phase 5 may swap this for electron-log.
import { appendFileSync, writeFileSync } from 'node:fs';

import { createId, injectable } from '@x-oasis/di';

export interface ILogService {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

const LOG_PATH = '/tmp/telegraph-main.log';

@injectable()
export class LogService implements ILogService {
  constructor() {
    try {
      writeFileSync(LOG_PATH, '');
    } catch {
      // ignore — /tmp may be unwritable in odd sandboxes
    }
    this.info(`LogService init; pid=${String(process.pid)}`);
  }

  info(msg: string): void {
    this.write('INFO', msg);
  }

  warn(msg: string): void {
    this.write('WARN', msg);
  }

  error(msg: string): void {
    this.write('ERROR', msg);
  }

  private write(level: string, msg: string): void {
    try {
      appendFileSync(LOG_PATH, `[${new Date().toISOString()}] [${level}] ${msg}\n`);
    } catch {
      // ignore
    }
  }
}

export const LogServiceId = createId('LogService');
