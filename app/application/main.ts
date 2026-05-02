import * as path from 'path'
import * as fs from 'fs'

const __LOG = '/tmp/speedy-main.log'
function dlog(msg: string) {
  try {
    fs.appendFileSync(__LOG, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {}
}
fs.writeFileSync(__LOG, '')
dlog(`main.ts entry; pid=${process.pid}`)
process.on('uncaughtException', (e) => dlog(`UNCAUGHT: ${(e as Error)?.stack || e}`))
process.on('unhandledRejection', (e) => dlog(`UNHANDLED: ${(e as Error)?.stack || e}`))
process.on('exit', (code) => dlog(`EXIT code=${code}`))

const { app } = require('electron')

import { Container } from '@x-oasis/di'
import registry from './redcity-application-module'
import { RedcityApplicationId } from './redcity-application'
import type RedcityApplication from './redcity-application'

dlog('imports ok; building DI container')

const container = new Container()
container.load(registry)

dlog('container loaded; waiting for app.whenReady')

app.whenReady().then(() => {
  dlog('app.whenReady fired; resolving RedcityApplication')
  try {
    const application = container.get(RedcityApplicationId) as RedcityApplication
    dlog('RedcityApplication resolved; calling start()')
    application.start()
    dlog('start() returned')
  } catch (err) {
    dlog(`startup error: ${(err as Error)?.stack || err}`)
    throw err
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
