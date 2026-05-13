// Phase 1 — Electron main entry. Forge invokes this via .vite/build/index.js.
//
// Design context: codebase-wiki/roadmap/20260508-from-zero-design-only-electron-app-plan.md
//
// Side-channel debug log to /tmp/telegraph-debug.log before any imports run,
// so even import-time crashes are observable when running under electron-forge
// (which may swallow stdout when there is no TTY).
import { appendFileSync, writeFileSync } from 'node:fs';

const __DBG = '/tmp/telegraph-debug.log';
function dlog(msg: string): void {
  try {
    appendFileSync(__DBG, `[${new Date().toISOString()}] ${msg}\n`);
  } catch {
    // ignore
  }
}

try {
  writeFileSync(__DBG, '');
} catch {
  /* ignore */
}
dlog(`main.ts entry; pid=${String(process.pid)}`);
process.on('uncaughtException', (e: Error) => {
  dlog(`UNCAUGHT: ${e.stack ?? String(e)}`);
});
process.on('unhandledRejection', (e) => {
  dlog(`UNHANDLED: ${e instanceof Error ? e.stack ?? String(e) : String(e)}`);
});
process.on('exit', (code) => {
  dlog(`EXIT code=${String(code)}`);
});

import { app } from 'electron';

import { Container } from '@x-oasis/di';

import registry from './telegraph-application-module';
import { TelegraphApplicationId, type ITelegraphApplication } from './telegraph-application';

dlog('imports ok; building DI container');

const container = new Container();
container.load(registry);

dlog('container loaded; awaiting app.whenReady');

app
  .whenReady()
  .then(async () => {
    dlog('app.whenReady fired');
    const application = container.get(TelegraphApplicationId) as ITelegraphApplication;
    await application.start();
    dlog('application.start() resolved');
  })
  .catch((err: unknown) => {
    dlog(`startup error: ${err instanceof Error ? err.stack ?? String(err) : String(err)}`);
    throw err;
  });

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
