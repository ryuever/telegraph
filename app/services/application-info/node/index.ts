import crypto from 'crypto'
import { Disposable } from '@x-oasis/disposable'
import { injectable } from '@x-oasis/di'
import {
  REDCITY_APP_NAME,
  REDCITY_ROOT_TRACE_ID,
  REDCITY_APP_VERSION,
} from '@app/core/node/process/env'
import type { AppInfo } from '../common/types'

export const ApplicationInfoId = 'application-info-id'

@injectable()
export default class ApplicationInfo extends Disposable {
  private appInfo: AppInfo

  constructor() {
    super()
    this.init()
  }

  private getUUID() {
    const randomId = crypto.randomUUID({ disableEntropyCache: true })
    return `${Date.now()}-${randomId}`
  }

  private getRootTraceId() {
    return process.env[REDCITY_ROOT_TRACE_ID] || this.getUUID()
  }

  private getDefaultAppInfo() {
    return {
      appName: process.env[REDCITY_APP_NAME] ?? '',
      appVersion: process.env[REDCITY_APP_VERSION] ?? '',
      rootTraceId: this.getRootTraceId(),
    }
  }

  private init() {
    this.appInfo = this.getDefaultAppInfo()
    if (process.type === 'browser') {
      /* eslint-disable global-require */
      const { app } = require('electron')
      Object.assign(this.appInfo, {
        appName: app.getName(),
        appVersion: app.getVersion(),
      })
    }
  }

  injectChildProcessEnv(env: { [key: string]: string | undefined }) {
    const { appName, appVersion, rootTraceId } = this.appInfo
    env[REDCITY_APP_NAME] = appName
    env[REDCITY_APP_VERSION] = appVersion
    env[REDCITY_ROOT_TRACE_ID] = rootTraceId
  }

  getAppInfo() {
    return this.appInfo
  }
}
