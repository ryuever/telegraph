import type { UtilityProcess as ElectronUtilityProcess } from 'electron'
import { utilityProcess } from 'electron'
import deepClone from '@x-oasis/deep-clone'
import {
  TELEGRAPH_ENTRY,
  TELEGRAPH_PPID,
  TELEGRAPH_PROJECT_NAME,
  TELEGRAPH_AMD_ENTRY,
  TELEGRAPH_PROCESS_ID,
} from '@app/core/node/process/env'
import { fromNodeEvent, Emitter } from '@x-oasis/emitter'
import { createId, inject, injectable } from '@x-oasis/di'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId } from '@app/services/log/common/log'
import { Disposable } from '@x-oasis/disposable'

import type ApplicationInfo from '@app/services/application-info/node'
import { ApplicationInfoId } from '@app/services/application-info/node'
import type { IUtilityProcessConfig } from './types/utilityProcess'

export const UtilityProcessFactoryId = createId('utility-process-factory')
export type IUtilityProcessFactory = () => UtilityProcess

@injectable()
export default class UtilityProcess extends Disposable {
  private _name: string

  private _process: ElectronUtilityProcess | undefined = undefined

  private _emitter = new Emitter({
    name: 'utility-process',
  })

  private _pid: number

  private onSpawnEvent = this._emitter.register('onSpawn')

  onSpawn = this.onSpawnEvent.subscribe

  private onExitEvent = this._emitter.register('onExit')

  onExit = this.onExitEvent.subscribe

  private onMessageEvent = this._emitter.register('onMessage')

  onMessage = this.onMessageEvent.subscribe

  private onChannelDidCreatedEvent = this._emitter.register('onChannelDidCreated')

  onChannelDidCreated = this.onChannelDidCreatedEvent.subscribe

  constructor(
    @inject(LogServiceId) private logService: LogService,
    @inject(ApplicationInfoId) private applicationInfo: ApplicationInfo
  ) {
    super()
  }

  get name() {
    return this._name
  }

  get pid() {
    return this._pid
  }

  get process() {
    return this._process
  }

  setupPingService() {}

  postMessage(...args: any[]) {
    this.process?.postMessage(args)
  }

  start(configs: IUtilityProcessConfig) {
    const { entry, serviceName } = configs
    this.logService.info(`start fork '${serviceName}' by utilityProcess`)
    this._name = serviceName
    const modulePath = entry
    const args = [] as string[]

    const env = this.createEnv(configs)

    this._process = utilityProcess.fork(modulePath, args, {
      env,
      serviceName,
      execArgv: ['--inspect=4255'],
    })
    this.registerListener()

    return this._process
  }

  createEnv(configuration: IUtilityProcessConfig) {
    const env = configuration.env ? { ...configuration.env } : { ...deepClone(process.env) }

    // Apply supported environment variables from config
    env[TELEGRAPH_ENTRY] = configuration.entry

    if (typeof configuration.ppid === 'number') {
      env[TELEGRAPH_PPID] = String(configuration.ppid)
    }

    if (typeof configuration.amdEntry === 'string') {
      env[TELEGRAPH_AMD_ENTRY] = String(configuration.amdEntry)
    }

    if (typeof configuration.projectName === 'string') {
      env[TELEGRAPH_PROJECT_NAME] = configuration.projectName
    }

    if (typeof configuration.id === 'string') {
      env[TELEGRAPH_PROCESS_ID] = configuration.id
    }

    // Ensure all values are strings, otherwise the process will not start
    for (const key of Object.keys(env)) {
      env[key] = String(env[key])
    }

    env.FORCE_COLOR = '1'

    // 向子进程注入应用上下文数据
    this.applicationInfo.injectChildProcessEnv(env)

    return env
  }

  registerListener() {
    this.registerDisposable(
      fromNodeEvent(
        this._process!,
        'spawn'
      )((...args: any[]) => {
        this._pid = this._process?.pid ?? 0
        // this.connect()
        this.logService.info(`fork '${this.name}' start pid `, this._pid)
        this.onSpawnEvent.fire(...args)
      })
    )
  }
}
