import { defineConfig } from 'vite'
import { resolve } from 'path'

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@app': resolve(__dirname, 'app'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        entryFileNames: 'preload.js',
      },
    },
  },
})
