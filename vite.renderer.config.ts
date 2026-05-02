import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// https://vitejs.dev/config
export default defineConfig(async () => {
  const tailwindcss = (await import('@tailwindcss/vite')).default
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@app': resolve(__dirname, 'app'),
        '@ui': resolve(__dirname, 'ui'),
      },
    },
    server: {
      host: '127.0.0.1',
    },
  }
})
