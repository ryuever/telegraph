#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = join(__dirname, '..')

function run(script) {
  return spawnSync('node', [join(appRoot, 'scripts', script)], {
    stdio: 'inherit',
    env: process.env,
  })
}

const verifyFirst = run('verify-pi-runtime.mjs')
if (verifyFirst.status === 0) {
  process.exit(0)
}

console.log('Pi runtime missing, running prepare step...')
const prepare = run('copy-pi-runtime.mjs')
if (prepare.status !== 0) {
  process.exit(prepare.status ?? 1)
}

const verifySecond = run('verify-pi-runtime.mjs')
process.exit(verifySecond.status ?? 1)
