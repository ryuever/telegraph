import { ElectronMessagePortMainChannel } from '@x-oasis/async-call-rpc-electron'
import type { MainPort } from '@x-oasis/async-call-rpc-electron'
import { AbstractChannelProtocol } from '@x-oasis/async-call-rpc'
import type RPCServiceHost from '../RPCServiceHost'
import type { LegacyChannelProps } from '../types'
import { bindHostToChannel } from '../registerToServiceHost'

export type DeferredMessageChannelProtocolProps = LegacyChannelProps & {
  port?: MainPort
}

/**
 * Wraps an ElectronMessagePortMainChannel where the underlying MessagePortMain
 * is bound after construction (the typical flow in this app's port broker:
 * create channel first, then receive a port from the renderer/main).
 *
 * The shim defers all send/listen operations until `bindPort()` is called.
 */
export default class DeferredMessageChannelProtocol extends AbstractChannelProtocol {
  private _inner: ElectronMessagePortMainChannel | null = null
  private _host?: RPCServiceHost
  private _description?: string
  private _pendingListener: ((data: unknown) => void) | null = null
  private _pendingSends: Array<{ data: unknown; transfer?: MainPort[] }> = []

  constructor(props: DeferredMessageChannelProtocolProps = {}) {
    const { port, serviceHost, masterProcessName, ...rest } = props
    super({ description: masterProcessName, ...rest })
    this._host = serviceHost
    this._description = masterProcessName
    if (port) this.bindPort(port)
    bindHostToChannel(this, this._host)
  }

  bindPort(port: MainPort): void {
    if (this._inner) {
      try {
        this._inner.disconnect()
      } catch {
        /* noop */
      }
    }
    this._inner = new ElectronMessagePortMainChannel({
      port,
      description: this._description,
    })
    bindHostToChannel(this._inner, this._host)
    if (this._pendingListener) this._inner.on(this._pendingListener)
    for (const entry of this._pendingSends) this._inner.send(entry.data, entry.transfer)
    this._pendingSends = []
  }

  on(listener: (data: unknown) => void): void | (() => void) {
    this._pendingListener = listener
    if (this._inner) return this._inner.on(listener) as void | (() => void)
  }

  send(data: unknown, transfer?: MainPort[]): void {
    if (this._inner) {
      this._inner.send(data, transfer)
    } else {
      this._pendingSends.push({ data, transfer })
    }
  }

  disconnect(): void {
    if (this._inner) {
      this._inner.disconnect()
      this._inner = null
    }
    super.disconnect()
  }

  setServiceHost(host: RPCServiceHost): void {
    this._host = host
    if (this._inner) bindHostToChannel(this._inner, host)
    bindHostToChannel(this, host)
  }
}
