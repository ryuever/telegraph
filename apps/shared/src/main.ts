// Shared utility-process entry for the shared process.
//
// Loaded via `utilityProcess.fork(<bundle>)` from the main process.

import { appendFileSync, writeFileSync } from 'node:fs';

const __DBG = '/tmp/telegraph-shared.log';
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
dlog(`shared utility entry; pid=${String(process.pid)}`);

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

import registry from './application/node/shared-application-module';
import { SharedBootstrapId, type ISharedBootstrap } from './application/node/SharedBootstrap';

dlog('imports ok; building DI container');

const container = new Container();
container.load(registry);

dlog('container loaded; starting SharedBootstrap');

try {
  const bootstrap = container.get(SharedBootstrapId) as ISharedBootstrap;
  bootstrap.start();
  dlog('SharedBootstrap.start() returned');
} catch (err) {
  dlog(`bootstrap error: ${err instanceof Error ? err.stack ?? String(err) : String(err)}`);
  throw err;
}