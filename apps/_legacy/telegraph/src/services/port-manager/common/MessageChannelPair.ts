import { Disposable } from '@x-oasis/disposable'
import { ProxyRPCClient } from '@x-oasis/async-call-rpc'
import type { LogService } from '@telegraph/services/log/common/log'
import type { MessagePortMain } from 'electron'
import { PortManagerLog } from '@telegraph/services/log/common/constants'
import type {
  MessageChannelPairPeerEntry,
  MessageChannelPairHostEntry,
  MessageChannelPairProps,
  messageChannelPairChannel,
} from './types'

export class MessageChannelPair extends Disposable {
  private _id: string

  private _logService: LogService

  hostEntry: MessageChannelPairHostEntry

  peerEntry: MessageChannelPairPeerEntry

  constructor(props: MessageChannelPairProps) {
    super()

    const { connectId, channel, peerRequestPath, logService } = props
    this._id = connectId
    this._logService = logService
    this.hostEntry = { channel }
    const client = new ProxyRPCClient(peerRequestPath, {
      channel,
    }).createProxy<MessageChannelPairPeerEntry['client']>()

    this.peerEntry = {
      isConnected: false,
      client,
    }

    this.sayHelloOptionsRequest()
  }

  get channel() {
    return this.hostEntry.channel
  }

  set channel(value: null | messageChannelPairChannel) {
    this.hostEntry.channel = value
  }

  get id() {
    return this._id
  }

  reconnect(port: MessagePortMain) {
    this.channel!.bindPort(port as any)
    this.sayHelloOptionsRequest()
  }

  disconnect() {
    this._logService.info(PortManagerLog.MessageChannelDisconnect, this.id)
    this.hostEntry.channel?.disconnect()
  }

  connect() {
    if (this.hostEntry.channel && !this.hostEntry.channel.isConnected()) {
      this._logService.info(PortManagerLog.MessageChannelConnected, this.id)
      this.hostEntry.channel.activate()
      // 标记下对方也处于 ready 状态，不需要再主动进行 say hello 探测
      this.peerEntry.isConnected = true
    }
  }

  /**
   * 接收到对方发来的消息，则可以认为通道已可用
   * @returns
   */
  handleSayHelloRequest() {
    this.connect()
    return true
  }

  async sayHelloOptionsRequest() {
    if (this.peerEntry.isConnected) return
    this._logService.info(PortManagerLog.MessageChannelSayHello, this.id)
    const isConnected = await this.peerEntry.client.sayHelloOptionsRequest(this.id)
    // 已经和对方完成通信，则认为通道可用
    isConnected && this.connect()
  }
}
