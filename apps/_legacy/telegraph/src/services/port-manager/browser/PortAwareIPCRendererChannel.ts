/**
 * PortAwareIPCRendererChannel
 *
 * 解决 contextIsolation: true 下 preload bridge 无法将 MessagePort 传递给
 * IPCRendererChannel 的问题。
 *
 * 背景：
 *   - Electron 的 contextIsolation 隔离了 preload 和 main world
 *   - 当主进程通过 webContents.postMessage(channel, data, [port]) 发送 MessagePort 时，
 *     preload 的 ipcRenderer.on 收到的 event.ports 无法直接传递到 main world
 *   - preload bridge (px.ts) 使用 window.postMessage(data, '*', ports) 将 ports
 *     转移到 main world，但同时跳过了 listener 调用
 *   - 导致 IPCRendererChannel 收不到 PortSuccess 类型的 RPC 响应
 *
 * 解决方案：
 *   本 channel 同时监听两个来源：
 *   1. ipcRenderer.on（通过 preload bridge）—— 处理普通 RPC 消息
 *   2. window.addEventListener('message') —— 捕获 preload 转发的 port 消息
 *
 *   对于 port 消息，构造包含 data + ports 的合成事件，让 RPC 中间件
 *   (normalizeMessageChannelRawMessage → handleResponse) 正确处理
 *   PortSuccess 响应并 resolve(port)。
 */

import { IPCRendererChannel } from '@x-oasis/async-call-rpc-electron'

type IPCRendererChannelProps = ConstructorParameters<typeof IPCRendererChannel>[0]

export interface PortAwareIPCRendererChannelProps extends IPCRendererChannelProps {}

export class PortAwareIPCRendererChannel extends IPCRendererChannel {
  private _portChannelName: string
  private _windowMessageHandler: ((event: MessageEvent) => void) | null = null

  constructor(props: PortAwareIPCRendererChannelProps) {
    super(props)
    this._portChannelName = props.channelName
  }

  on(listener: (data: unknown) => void): void | (() => void) {
    // 1. 监听 window.postMessage —— 接收 preload 转发的 port 消息
    this._windowMessageHandler = (event: MessageEvent) => {
      // 过滤：只处理 preload bridge 转发的 port 消息
      if (event.source !== window) return
      if (!event.data?.channel) return

      // DEBUG: 记录所有来自 preload 的 window.postMessage
      if (event.ports?.length) {
        console.log(`[PortAwareChannel] window.message received: channel="${event.data.channel}" ports=${event.ports.length} myChannel="${this._portChannelName}"`)
      }

      if (event.data.channel !== this._portChannelName || !event.ports?.length) {
        return
      }

      console.log(`[PortAwareChannel] ✓ matched port message for "${this._portChannelName}", forwarding to RPC pipeline`)

      // 构造合成事件对象，包含 RPC data 和 ports
      // normalizeMessageChannelRawMessage 会提取 event.data 和 event.ports
      const syntheticEvent = {
        data: event.data.data, // preload 中 args[1] = 序列化的 RPC 数据
        ports: [...event.ports],
      }

      listener(syntheticEvent)
    }
    window.addEventListener('message', this._windowMessageHandler)
    console.log(`[PortAwareChannel] window.message listener registered for "${this._portChannelName}"`)

    // 2. 监听 ipcRenderer.on —— 处理普通（无 port）RPC 消息
    //    preload bridge 会跳过 port 消息的 listener 调用，所以不会重复
    const cleanup = super.on(listener)

    return () => {
      if (this._windowMessageHandler) {
        window.removeEventListener('message', this._windowMessageHandler)
        this._windowMessageHandler = null
      }
      cleanup?.()
    }
  }

  disconnect(): void {
    if (this._windowMessageHandler) {
      window.removeEventListener('message', this._windowMessageHandler)
      this._windowMessageHandler = null
    }
    super.disconnect()
  }
}
