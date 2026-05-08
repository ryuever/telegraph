// Phase 3 — Electron utility-process entry for the design pagelet.
//
// Loaded via `utilityProcess.fork(<bundle>)` from
// `apps/telegraph/src/services/connection-orchestrator/electron-main/DesignPageletProcess.ts`.
//
// Side-channel debug log to /tmp/telegraph-design.log so even import-time
// crashes are observable when the utility process gets killed early or its
// stdout is buffered. Mirrors the pattern in `apps/telegraph/src/application/main.ts`.
import { appendFileSync, writeFileSync } from 'node:fs';

const __DBG = '/tmp/telegraph-design.log';
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
dlog(`design utility entry; pid=${String(process.pid)}`);
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

import registry from './application/node/design-application-module';
import { DesignBootstrapId, type IDesignBootstrap } from './application/node/DesignBootstrap';

dlog('imports ok; building DI container');

const container = new Container();
container.load(registry);

dlog('container loaded; starting DesignBootstrap');

try {
  const bootstrap = container.get(DesignBootstrapId) as IDesignBootstrap;
  bootstrap.start();
  dlog('DesignBootstrap.start() returned');
} catch (err) {
  dlog(`bootstrap error: ${err instanceof Error ? err.stack ?? String(err) : String(err)}`);
  throw err;
}
