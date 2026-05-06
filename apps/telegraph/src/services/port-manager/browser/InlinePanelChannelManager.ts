/**
 * Inline Panel Channel Manager
 *
 * 管理主 renderer 中 inline panel（chat/design）的 PageletClientChannel 实例。
 * 每个 inline panel 拥有独立的 PageletClientChannel，通过 MessagePort
 * 与对应的 PageletProcess（UtilityProcess）通信。
 *
 * 使用方式：
 *   1. 应用启动后调用 initChannel(panelName) 创建 channel 并建立 MessagePort
 *   2. React 组件通过 getChannel(panelName) 获取已初始化的 channel
 *   3. 通过 channel.pageletChannelProtocol 进行 RPC 通信
 */
import { PageletClientChannel } from './PageletClientChannel'
import { LogService } from '@telegraph/services/log/common/log'
import { LogLevel } from '@telegraph/services/log/common/types'
import { ProxyRPCClient } from '@x-oasis/async-call-rpc'
import { pageletProcessServicePath } from '@telegraph/services/process/pagelet-process/common/config'

/** 简易 console logger，用于 renderer 侧的 PageletClientChannel */
const consoleLogger = {
  setLevel(_level: LogLevel) {},
  getLevel() { return LogLevel.Info },
  trace(msg: string, ...args: any[]) { console.log(`[PageletChannel] ${msg}`, ...args) },
  debug(msg: string, ...args: any[]) { console.log(`[PageletChannel] ${msg}`, ...args) },
  info(msg: string, ...args: any[]) { console.info(`[PageletChannel] ${msg}`, ...args) },
  warn(msg: string, ...args: any[]) { console.warn(`[PageletChannel] ${msg}`, ...args) },
  error(msg: string, ...args: any[]) { console.error(`[PageletChannel] ${msg}`, ...args) },
  fatal(msg: string, ...args: any[]) { console.error(`[PageletChannel] ${msg}`, ...args) },
}

const logService = new LogService({ logger: consoleLogger as any })

/** 已创建的 inline panel channel 实例 */
const channels = new Map<string, PageletClientChannel>()

/**
 * 为指定的 inline panel 创建 PageletClientChannel 并建立 MessagePort 连接。
 *
 * 虚拟 pageletId 格式：`inline-panel.{panelName}`，
 * 与主进程 BrowserWindow.ensurePageletProcess 中注册的 ID 一致。
 *
 * @param panelName - 面板名称，如 'chat' 或 'design'
 * @returns 已初始化的 PageletClientChannel
 */
export function initChannel(panelName: string): PageletClientChannel {
  const existing = channels.get(panelName)
  if (existing) return existing

  const virtualPageletId = `inline-panel.${panelName}`
  const channel = new PageletClientChannel(logService, virtualPageletId)

  channel.initPortChannel({
    projectName: panelName,
    masterProcessName: `inline-panel-${panelName}`,
  })

  channels.set(panelName, channel)
  return channel
}

/**
 * 获取已初始化的 inline panel channel。
 * 如果尚未初始化，返回 undefined。
 */
export function getChannel(panelName: string): PageletClientChannel | undefined {
  return channels.get(panelName)
}

/**
 * 销毁指定 inline panel 的 channel，释放 MessagePort 连接。
 */
export function disposeChannel(panelName: string): void {
  const channel = channels.get(panelName)
  if (channel) {
    channel.dispose()
    channels.delete(panelName)
  }
}

/**
 * 获取所有已初始化的 channel。
 */
export function getAllChannels(): ReadonlyMap<string, PageletClientChannel> {
  return channels
}

/**
 * 向指定 inline panel 的 PageletProcess 发送 ping，验证 MessagePort 通信是否正常。
 *
 * 默认调用 pageletProcessServicePath（PageletProcessNode.ping），
 * 也可指定自定义 servicePath（如 '/services/chat'）调用 app 层的 ping。
 */
export async function pingPageletProcess(panelName: string, servicePath?: string): Promise<{
  pong: boolean
  processId: string
  projectName: string
  ts: number
  receivedTs?: number
}> {
  const channel = channels.get(panelName)
  if (!channel) {
    throw new Error(`Channel for "${panelName}" not initialized. Call initChannel() first.`)
  }

  const proto = channel.pageletChannelProtocol
  console.log(`[ping] pageletChannelProtocol connected:`, (proto as any).isConnected?.())
  console.log(`[ping] pageletChannelProtocol port:`, (proto as any).port)

  const path = servicePath ?? pageletProcessServicePath
  console.log(`[ping] calling ping on servicePath="${path}"`)
  const proxy = new ProxyRPCClient(path, {
    channel: proto,
  }).createProxy<{ ping(payload?: { ts: number }): Promise<any> }>()

  return proxy.ping({ ts: Date.now() })
}

/**
 * 创建指定 inline panel 的 RPC 代理客户端。
 * 通用方法，可调用 PageletProcess 中注册的任意 RPC 服务。
 *
 * @example
 * ```ts
 * const chatProxy = createServiceProxy<ChatService>('chat', '/services/chat')
 * const result = await chatProxy.sendMessage('hello')
 * ```
 */
export function createServiceProxy<T extends Record<string, (...args: any[]) => any>>(panelName: string, servicePath: string): T {
  const channel = channels.get(panelName)
  if (!channel) {
    throw new Error(`Channel for "${panelName}" not initialized. Call initChannel() first.`)
  }

  return new ProxyRPCClient(servicePath, {
    channel: channel.pageletChannelProtocol,
  }).createProxy<T>() as T
}
