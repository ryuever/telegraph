import { createId, inject, injectable } from '@x-oasis/di'
import { Disposable } from '@x-oasis/disposable'
import type UtilityProcess from '@app/core/electron-main/utility-process/utilityProcess'
import type { LogService } from '@app/services/log/common/log'
import { LogServiceId } from '@app/services/log/common/log'
import type { MessagePortMain } from 'electron'
import { RPCServiceHost } from '@app/core/common/async-rpc-compat'
import { AcquirePortId } from '@app/services/port-manager/electron-main/AcquirePortMain'
import type { AcquirePortMain } from '@app/services/port-manager/electron-main/AcquirePortMain'

export const MainProcessId = createId('main-process')

@injectable()
export default class MainProcess extends Disposable {
  private _serviceHost: RPCServiceHost

  private processes = new Map<string, UtilityProcess>()

  constructor(
    @inject(LogServiceId) private logService: LogService,
    @inject(AcquirePortId) private acquirePortMain: AcquirePortMain
  ) {
    super()
    this._serviceHost = new RPCServiceHost('main-process')
  }

  get serviceHost() {
    return this._serviceHost
  }

  getSharedProcessChannel() {
    return this.acquirePortMain.sharedProcessChannel
  }

  registerServiceHandler(path: string, service: any) {
    this._serviceHost.registerServiceHandler(path, service)
  }

  disconnectPassingPort(connectId: string) {
    this.acquirePortMain.disconnectPassingPort(connectId)
  }

  assignPassingPort(connectId: string, port: MessagePortMain, reconnect?: boolean) {
    this.acquirePortMain.assignPassingPort(
      {
        connectId,
        reconnect,
      },
      port
    )
  }

  handlePageletRendererDisposed(id: string) {
    this.acquirePortMain.handlePageletRendererDisposed(id)
  }

  registerProcess(name: string, process: UtilityProcess) {
    this.processes.set(name, process)

    process.onExit(() => {
      this.processes.delete(name)
    })
  }
}
