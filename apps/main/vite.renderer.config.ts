import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import type { Plugin } from 'vite';

function emptyNodeBuiltinPlugin(): Plugin {
  const emptyModules = new Set(['child_process', 'module', 'perf_hooks', 'worker_threads']);

  return {
    name: 'telegraph:sandpacker-empty-node-builtins',
    resolveId(id) {
      if (emptyModules.has(id)) return `\0empty-node-builtin:${id}`;
      return null;
    },
    load(id) {
      if (!id.startsWith('\0empty-node-builtin:')) return null;
      return 'export default {}; export const performance = globalThis.performance;';
    },
  };
}

function devSandpackerServiceWorkerPlugin(): Plugin {
  return {
    name: 'telegraph:sandpacker-dev-service-worker',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/sandpacker-worker.js', (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Service-Worker-Allowed', '/');
        res.end(createDevSandpackerServiceWorkerSource());
      });
    },
  };
}

function createDevSandpackerServiceWorkerSource(): string {
  return `
const DEFAULT_CACHE_NAME = 'sandpacker';
const buses = new Map();

class BroadcastChannelTransport {
  constructor(channelName) {
    this.channel = new BroadcastChannel(channelName);
    this.listeners = new Set();
    this.handleMessage = (event) => this.listeners.forEach((listener) => listener(event.data));
    this.channel.addEventListener('message', this.handleMessage);
  }
  post(message) {
    this.channel.postMessage(message);
  }
  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close() {
    this.channel.removeEventListener('message', this.handleMessage);
    this.channel.close();
    this.listeners.clear();
  }
}

class ProtocolBus {
  constructor(transport, options = {}) {
    this.transport = transport;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30000;
    this.commandSeq = 0;
    this.pending = new Map();
    this.unsubscribe = transport.subscribe((message) => this.handleEnvelope(message));
  }
  command(name, payload) {
    const id = Date.now().toString(36) + '-' + (++this.commandSeq).toString(36);
    this.transport.post({ kind: 'command', id, name, payload });
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Command timed out: ' + name));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer });
    });
  }
  handleEnvelope(message) {
    if (!message || message.kind !== 'command-result') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.payload);
    else pending.reject(new Error(message.error?.message || 'Remote command failed'));
  }
  close() {
    this.unsubscribe();
    this.transport.close();
    this.pending.clear();
  }
}

function parseSandboxUrl(url) {
  const match = /^\\/([^/]+)\\/vite\\/([^/]+)(\\/.*)?$/.exec(url.pathname);
  if (!match) return null;
  return {
    busId: match[1],
    workspaceId: match[2],
    pathname: match[3] || '/index.html'
  };
}

function getBus(busId) {
  const existing = buses.get(busId);
  if (existing) return existing;
  const bus = new ProtocolBus(new BroadcastChannelTransport(busId));
  buses.set(busId, bus);
  return bus;
}

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  const parsed = parseSandboxUrl(url);
  if (!parsed) return;
  event.respondWith(serveSandboxRequest(event.request, url, parsed));
});

async function serveSandboxRequest(request, url, parsed) {
  const result = await getBus(parsed.busId).command('asset.serve', {
    ref: {
      busId: parsed.busId,
      workspaceId: parsed.workspaceId
    },
    pathname: parsed.pathname,
    rawUrl: url.href,
    accept: request.headers.get('accept') || undefined
  });

  if (result.cacheKey) {
    const cache = await caches.open(DEFAULT_CACHE_NAME);
    const cached = await waitForCache(cache, result.cacheKey);
    if (cached) return cached.clone();
  }

  if (result.error) {
    return new Response(JSON.stringify({ error: result.error }), {
      status: 502,
      statusText: 'BAD GATEWAY',
      headers: { 'Content-Type': 'application/json' }
    });
  }

  return new Response('Unexpected worker response', {
    status: 500,
    statusText: 'SERVER ERROR'
  });
}

async function waitForCache(cache, cacheKey) {
  let cached = await cache.match(cacheKey);
  let retry = 0;
  while (!cached && retry < 10) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    cached = await cache.match(cacheKey);
    retry += 1;
  }
  return cached;
}

`;
}

export default defineConfig(({ command }) => ({
  ...(command === 'serve' ? { base: '/' } : {}),
  plugins: [react(), emptyNodeBuiltinPlugin(), devSandpackerServiceWorkerPlugin()],
  resolve: {
    alias: {
      assert: 'assert',
      buffer: 'buffer',
      constants: 'constants-browserify',
      crypto: 'crypto-browserify',
      events: 'events',
      child_process: resolve(__dirname, 'src/application/browser/sandpacker-node-stubs/empty.ts'),
      fs: 'memfs',
      module: resolve(__dirname, 'src/application/browser/sandpacker-node-stubs/module.ts'),
      os: 'os-browserify/browser',
      path: 'path-browserify',
      'node:path': 'path-browserify',
      perf_hooks: resolve(__dirname, 'src/application/browser/sandpacker-node-stubs/perf-hooks.ts'),
      process: 'process/browser',
      stream: 'stream-browserify',
      tty: 'tty-browserify',
      url: 'url',
      util: 'util',
      vm: 'vm-browserify',
      worker_threads: resolve(__dirname, 'src/application/browser/sandpacker-node-stubs/empty.ts'),
      // The package's browser export points at a UMD build without ESM default export.
      // Sandpacker/Vite preview imports it as ESM through @jridgewell/trace-mapping.
      '@jridgewell/resolve-uri': resolve(__dirname, '../../node_modules/@jridgewell/resolve-uri/dist/resolve-uri.mjs'),
      '@/apps/main': resolve(__dirname, 'src'),
      '@/packages/services/pagelet-host': resolve(__dirname, '../../packages/services/src/pagelet-host/src'),
      '@/packages/services/main-metrics': resolve(__dirname, '../../packages/services/src/main-metrics/src'),
      '@/packages/services/log': resolve(__dirname, '../../packages/services/src/log/src'),
      '@/apps/connection': resolve(__dirname, '../connection/src'),
      '@/apps/daemon': resolve(__dirname, '../daemon/src'),
      '@/apps/shared': resolve(__dirname, '../shared/src'),
      '@/apps/monitor': resolve(__dirname, '../monitor/src'),
      '@/apps/setting': resolve(__dirname, '../setting/src'),
      '@/apps/design': resolve(__dirname, '../design/src'),
      '@/apps/chat': resolve(__dirname, '../chat/src'),
      '@/packages/stores': resolve(__dirname, '../../packages/stores/src/index.ts'),
      '@/packages/agent': resolve(__dirname, '../../packages/agent/src'),
      '@/packages/agent-protocol': resolve(__dirname, '../../packages/agent-protocol/src/index.ts'),
      '@/packages/computer-use': resolve(__dirname, '../../packages/computer-use/src'),
      '@/packages/computer-use-protocol': resolve(__dirname, '../../packages/computer-use-protocol/src/index.ts'),
      '@/packages/ui/useOrchestratorDashboard': resolve(__dirname, '../../packages/ui/src/hooks/useOrchestratorDashboard.ts'),
      '@/packages/ui': resolve(__dirname, '../../packages/ui/src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    headers: {
      'Service-Worker-Allowed': '/',
    },
    fs: {
      allow: ['..', '../..'],
    },
  },
  optimizeDeps: {
    include: [
      // Sandpacker pulls a few CommonJS-only parser helpers through its browser worker graph.
      // Pre-bundling them makes Vite expose stable ESM default exports in the renderer.
      'acorn-class-fields',
      'acorn-private-class-elements',
      'acorn-static-class-features',
      'convert-source-map',
      'esbuild',
      'esbuild-wasm/lib/browser',
      'etag',
      'fast-glob',
      'is-reference',
      'micromatch',
      'picomatch',
      'resolve',
    ],
  },
  define: {
    global: 'globalThis',
    __dirname: '"/"',
    __filename: '"/sandpacker-worker.js"',
    'process.env': {},
  },
  worker: {
    format: 'es',
    rollupOptions: {
      output: {
        entryFileNames: '[name]-[hash].js',
      },
    },
  },
  build: {
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
        setting: resolve(__dirname, 'setting.html'),
      },
    },
  },
}));
