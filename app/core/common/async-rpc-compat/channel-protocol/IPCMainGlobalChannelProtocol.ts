import { AbstractChannelProtocol } from '@x-oasis/async-call-rpc'
import type RPCServiceHost from '../RPCServiceHost'
import type { LegacyChannelProps } from '../types'
import { bindHostToChannel } from '../registerToServiceHost'

export type IPCMainGlobalChannelProtocolProps = LegacyChannelProps & {
  channelName: string
}

/**
 * Global IPC main listener (broadcast variant): receives messages from any
 * renderer on the named channel, regardless of source webContents. Replies are
 * routed back to the originating webContents via the IpcMainEvent sender.
 */
export default class IPCMainGlobalChannelProtocol extends AbstractChannelProtocol {
  private _channelName: string
  private _host?: RPCServiceHost
  private _lastSender: any

  constructor(props: IPCMainGlobalChannelProtocolProps) {
    const { channelName, serviceHost, masterProcessName, ...rest } = props
    super({ description: masterProcessName, ...rest })
    this._channelName = channelName
    this._host = serviceHost
    bindHostToChannel(this, this._host)
  }

  on(listener: (data: unknown) => void): void | (() => void) {
    let ipcMain: any
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      ipcMain = require('electron').ipcMain
    } catch {
      return
    }

    const handler = (event: any, ...args: unknown[]): void => {
      this._lastSender = event.sender
      const data = args.length === 1 ? args[0] : args
      listener({ data, sender: event.sender } as any)
    }

    ipcMain.on(this._channelName, handler)
    return () => {
      ipcMain.removeListener(this._channelName, handler)
    }
  }

  send(data: unknown): void {
    if (this._lastSender && !this._lastSender.isDestroyed?.()) {
      this._lastSender.send(this._channelName, data)
    }
  }

  setServiceHost(host: RPCServiceHost): void {
    this._host = host
    bindHostToChannel(this, host)
  }
}
