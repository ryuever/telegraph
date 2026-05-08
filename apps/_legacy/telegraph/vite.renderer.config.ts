import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

// https://vitejs.dev/config
// Tailwind runs via PostCSS (`postcss.config.mjs` + `@tailwindcss/postcss`), not
// `@tailwindcss/vite`, so monorepo `@source` paths behave consistently in Electron Forge.
export default defineConfig(({ command, mode }) => ({
  // Forge merges `base: './'` for all renderer builds. Relative base breaks dev-server
  // absolute URLs for CSS/JS in Electron, so styles never apply while `pnpm start` runs.
  // Production keeps Forge's `./` for file:// loading (we only override in serve).
  ...(command === 'serve' ? { base: '/' } : {}),
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@telegraph/application': resolve(__dirname, 'src/application'),
      '@telegraph/core': resolve(__dirname, 'src/core'),
      '@telegraph/services': resolve(__dirname, 'src/services'),
      '@telegraph/ui': resolve(__dirname, '../../packages/ui/src'),
      '@telegraph/agent': resolve(__dirname, '../../packages/agent/src'),
      '@telegraph/stores': resolve(__dirname, '../../packages/stores/src'),
    },
  },
  optimizeDeps: {
    exclude: ['@telegraph/ui', '@telegraph/agent', '@telegraph/stores'],
  },
  server: {
    host: '127.0.0.1',
    // Keep standalone `pnpm dev` off Forge's renderer port to avoid accidentally
    // attaching Electron to an older plain Vite instance with stale CSS.
    port: mode === 'standalone' ? 5174 : 5173,
    strictPort: true,
    // Electron reuses HTTP cache across runs; stale 304 on /src/*.css can leave a
    // broken Tailwind bundle applied forever after hash-only navigation to #/chat.
    ...(command === 'serve'
      ? {
          headers: {
            'Cache-Control': 'no-store',
            Pragma: 'no-cache',
          },
        }
      : {}),
    watch: {
      ignored: ['**/.vite/**', '**/out/**'],
    },
    fs: {
      allow: [
        resolve(__dirname, '../..'),
        resolve(__dirname, '../../packages/ui'),
        resolve(__dirname, '../../packages/stores'),
        resolve(__dirname, '../../packages/agent'),
      ],
    },
  },
}))
