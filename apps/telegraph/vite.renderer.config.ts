import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config
export default defineConfig(async () => {
  const tailwindcss = (await import('@tailwindcss/vite')).default
  return {
    plugins: [
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@telegraph/application': resolve(__dirname, 'src/application'),
        '@telegraph/core': resolve(__dirname, 'src/core'),
        '@telegraph/services': resolve(__dirname, 'src/services'),
        '@telegraph/ui': resolve(__dirname, '../../packages/ui/src'),
        '@telegraph/agent': resolve(__dirname, '../../packages/agent/src'),
      },
    },
    optimizeDeps: {
      exclude: ['@telegraph/ui', '@telegraph/agent'],
    },
    server: {
      host: '127.0.0.1',
    },
  }
})
