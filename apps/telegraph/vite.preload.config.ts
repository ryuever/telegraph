import { defineConfig } from 'vite'
import { resolve } from 'path'

// https://vitejs.dev/config
export default defineConfig({
  resolve: {
    alias: {
      '@telegraph/application': resolve(__dirname, 'src/application'),
      '@telegraph/core': resolve(__dirname, 'src/core'),
      '@telegraph/services': resolve(__dirname, 'src/services'),
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
