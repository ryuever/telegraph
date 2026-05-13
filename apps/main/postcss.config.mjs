import tailwindcss from '@tailwindcss/postcss'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(__dirname, '../..')

/** @type {import('postcss-load-config').Config} */
export default {
  plugins: [
    tailwindcss({
      base: repoRoot,
    }),
  ],
}
