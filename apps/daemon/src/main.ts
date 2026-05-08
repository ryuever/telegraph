// Daemon utility-process entry for the daemon process.
//
// Loaded via `utilityProcess.fork(<bundle>)` from the main process.

import { appendFileSync, writeFileSync } from 'node:fs';

const __DBG = '/tmp/telegraph-daemon.log';
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
dlog(`daemon utility entry; pid=${String(process.pid)}`);

process.on('uncaughtException', (e: Error) => {
  dlog(`UNCAUGHT: ${e.stack ?? String(e)}`);
});
process.on('unhandledRejection', (e) => {
  dlog(`UNHANDLED: ${e instanceof Error ? e.stack ?? String(e) : String(e)}`);
});
process.on('exit', (code) => {
  dlog(`EXIT code=${String(code)}`);
});

import { Container } from '@x-oasis/di';

import registry from './application/node/daemon-application-module';
import { DaemonBootstrapId, type IDaemonBootstrap } from './application/node/DaemonBootstrap';

dlog('imports ok; building DI container');

const container = new Container();
container.load(registry);

dlog('container loaded; starting DaemonBootstrap');

try {
  const bootstrap = container.get(DaemonBootstrapId) as IDaemonBootstrap;
  bootstrap.start();
  dlog('DaemonBootstrap.start() returned');
} catch (err) {
  dlog(`bootstrap error: ${err instanceof Error ? err.stack ?? String(err) : String(err)}`);
  throw err;
}