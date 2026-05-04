#!/usr/bin/env node
import { accessSync, statSync } from 'node:fs'
import { constants } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = join(__dirname, '..')
const binName = os.platform() === 'win32' ? 'pi.exe' : 'pi'
const binPath = join(appRoot, 'resources', 'pi-runtime', 'bin', binName)

try {
  accessSync(binPath, constants.F_OK)
  if (os.platform() !== 'win32') {
    accessSync(binPath, constants.X_OK)
  }
  const info = statSync(binPath)
  if (!info.isFile() || info.size <= 0) {
    throw new Error('binary is empty or not a regular file')
  }
} catch (error) {
  const reason = error instanceof Error ? error.message : String(error)
  console.error(
    [
      `Pi runtime verification failed: ${reason}`,
      `Expected bundled binary at: ${binPath}`,
      'Run `pnpm --filter telegraph run prepare:pi-runtime` before packaging.',
    ].join('\n')
  )
  process.exit(1)
}

console.log(`Pi runtime verified: ${binPath}`)
