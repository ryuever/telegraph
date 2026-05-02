import { AbstractChannelProtocol } from '@x-oasis/async-call-rpc'
import type RPCServiceHost from '../RPCServiceHost'
import type { LegacyChannelProps } from '../types'
import { bindHostToChannel } from '../registerToServiceHost'

export type IPCRendererMessageChannelProtocolProps = LegacyChannelProps

/**
 * Renderer-side wrapper for a deferred MessagePort. The port is bound later via
 * `bindPort()` once the main process transfers it through `postMessage`.
 */
export default class IPCRendererMessageChannelProtocol extends AbstractChannelProtocol {
  private _port: MessagePort | null = null
  private _host?: RPCServiceHost
  private _listener: ((data: unknown) => void) | null = null

  constructor(props: IPCRendererMessageChannelProtocolProps = {}) {
    const { serviceHost, masterProcessName, ...rest } = props
    super({ description: masterProcessName, ...rest })
    this._host = serviceHost
    bindHostToChannel(this, this._host)
  }

  bindPort(port: MessagePort): void {
    this._port = port
    if (typeof port.start === 'function') port.start()
    if (this._listener) this._attachListener(this._listener)
  }

  on(listener: (data: unknown) => void): void | (() => void) {
    this._listener = listener
    if (this._port) this._attachListener(listener)
  }

  send(data: unknown): void {
    if (this._port) {
      this._port.postMessage(data)
    }
  }

  disconnect(): void {
    if (this._port) {
      try {
        this._port.close()
      } catch {
        /* noop */
      }
      this._port = null
    }
    super.disconnect()
  }

  setServiceHost(host: RPCServiceHost): void {
    this._host = host
    bindHostToChannel(this, host)
  }

  private _attachListener(listener: (data: unknown) => void) {
    if (!this._port) return
    this._port.addEventListener('message', (ev: MessageEvent) => {
      listener({ data: ev.data } as any)
    })
  }
}
