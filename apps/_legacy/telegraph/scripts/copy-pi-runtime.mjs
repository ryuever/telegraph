#!/usr/bin/env node
import { mkdirSync, copyFileSync, chmodSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = join(__dirname, '..')
const targetDir = join(appRoot, 'resources', 'pi-runtime', 'bin')
const targetName = os.platform() === 'win32' ? 'pi.exe' : 'pi'
const targetPath = join(targetDir, targetName)
const explicitBin = process.env.PI_BIN?.trim()

let sourcePath = explicitBin
if (!sourcePath) {
  const whichCmd = os.platform() === 'win32' ? 'where' : 'which'
  const found = spawnSync(whichCmd, ['pi'], { encoding: 'utf-8' })
  if (found.status !== 0) {
    console.error('Unable to locate `pi` on PATH. Install Pi CLI or set PI_BIN manually.')
    process.exit(1)
  }

  sourcePath = found.stdout.split(/\r?\n/).map(l => l.trim()).find(Boolean)
}
if (!sourcePath) {
  console.error('Unable to resolve source pi binary path.')
  process.exit(1)
}

mkdirSync(targetDir, { recursive: true })
copyFileSync(sourcePath, targetPath)
if (os.platform() !== 'win32') {
  chmodSync(targetPath, 0o755)
}

console.log(`Copied Pi runtime:\n  from: ${sourcePath}\n  to:   ${targetPath}`)
