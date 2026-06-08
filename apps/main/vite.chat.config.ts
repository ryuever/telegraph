import { defineConfig } from 'vite';
import type { Plugin } from 'vite';
import { resolve } from 'node:path';

const nodeBuiltins = [
  'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns',
  'domain', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'process',
  'querystring', 'repl', 'stream', 'string_decoder', 'sys', 'timers', 'tls',
  'tty', 'url', 'util', 'v8', 'vm', 'zlib', 'async_hooks', 'module',
];

// jiti must stay external; it lazy-requires its own `../dist/babel.cjs`
// transformer at runtime via `require()` (jiti.cjs:13). Rollup cannot see
// that dynamic edge, so bundling jiti produces a worker that resolves the
// jiti entry but explodes on first `.import(...)` with
// "Cannot find module '../dist/babel.cjs'" because the relative path then
// resolves from the bundle's location instead of the original jiti folder.
//
// IMPORTANT — `rollupOptions.external` declared here is silently dropped by
// `@electron-forge/plugin-vite` during its own config merge: the plugin
// installs its own `external` (string[]) and vite/rollup's mergeConfig
// cannot safely concat a user-supplied function with a string[], so the
// function we declare below is effectively never invoked by rollup. We
// verified this empirically: adding `console.log` inside `isExternal` for
// id === 'jiti' produced zero hits during forge build, while a `console.log`
// at the top of the file ran. So the user-config field is loaded, but its
// `external` entry is dropped before rollup sees it.
//
// To work around that, we also install a small rollup plugin
// (`externalJitiPlugin`) that flags jiti as external via the `resolveId`
// hook. Plugins survive forge's config merge intact (`plugins` is a list
// that is concatenated, not overridden), so the resolve-time `external: true`
// always wins regardless of what forge does with `rollupOptions.external`.
//
// `isExternal` is kept for symmetry with the other vite configs and as a
// safety net in case forge later fixes its merge behaviour. Both guards
// must remain — they protect against different failure modes.
//
// This MUST be kept in sync with vite.design.config.ts — both pagelets emit
// their own per-config chunks, but the underlying issue is identical.
// Runtime resolution falls back to the hoisted node_modules/jiti (root)
// where dist/ sits next to it; `jiti` is declared as a runtime dependency
// of @telegraph/main so electron-forge packaging includes it.
const externalJitiPlugin: Plugin = {
  name: 'telegraph-external-jiti',
  enforce: 'pre',
  resolveId(source) {
    if (source === 'jiti' || source.startsWith('jiti/')) {
      return { id: source, external: true };
    }
    return null;
  },
};

const isExternal = (id: string) =>
  id === 'electron' ||
  id === 'jiti' ||
  id.startsWith('jiti/') ||
  id.startsWith('node:') ||
  nodeBuiltins.some(builtin => id === builtin || id.startsWith(`${builtin}/`));

export default defineConfig({
  plugins: [externalJitiPlugin],
  resolve: {
    mainFields: ['module', 'jsnext:main', 'jsnext'],
    alias: {
      '@/apps/chat': resolve(__dirname, '../chat/src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/apps/daemon': resolve(__dirname, '../daemon/src'),
      '@/apps/main': resolve(__dirname, 'src'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src/index.ts'),
      '@/packages/run-protocol': resolve(__dirname, '../../packages/run-protocol/src/index.ts'),
      '@/packages/remote-protocol': resolve(__dirname, '../../packages/remote-protocol/src/index.ts'),
      '@/packages/computer-use': resolve(__dirname, '../../packages/computer-use/src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../../packages/computer-use-protocol/src/index.ts'),
      '@/packages/orchestrator-core': resolve(__dirname, '../../packages/orchestrator-core/src'),
      '@/packages/agent': resolve(__dirname, '../../packages/agent/src'),
      '@/packages/agent-capabilities': resolve(__dirname, '../../packages/agent-capabilities/src'),
      '@/packages/agent-extensions': resolve(__dirname, '../../packages/agent-extensions/src'),
      '@/packages/agent-resources': resolve(__dirname, '../../packages/agent-resources/src'),
      '@/extensions/telegraph-subagents': resolve(__dirname, '../../extensions/telegraph-subagents'),
    },
  },
  build: {
    outDir: '.vite/preload',
    lib: {
      entry: resolve(__dirname, '../chat/src/application/node/main.ts'),
      formats: ['cjs'],
    },
    rollupOptions: {
      external: isExternal,
      output: {
        entryFileNames: 'chat-worker.js',
      },
    },
  },
});
