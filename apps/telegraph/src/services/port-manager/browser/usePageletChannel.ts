/**
 * React hook：获取指定 inline panel 的 PageletClientChannel。
 *
 * 在面板组件中使用，通过 channel.pageletChannelProtocol 进行 RPC 通信。
 * Channel 在面板首次激活时由 ensureChannelReady() 自动初始化。
 */
import { useSyncExternalStore, useCallback } from 'react'
import { getChannel, initChannel } from '@telegraph/services/port-manager/browser/InlinePanelChannelManager'
import type { PageletClientChannel } from '@telegraph/services/port-manager/browser/PageletClientChannel'

/** subscribers 用于通知 React 组件 channel 状态变化 */
const listeners = new Set<() => void>()

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

/** 通知所有订阅者 channel 状态已变化 */
export function notifyChannelChange() {
  listeners.forEach(cb => cb())
}

/**
 * 获取指定面板的 PageletClientChannel。
 * 如果 channel 尚未初始化，返回 undefined。
 *
 * @example
 * ```tsx
 * function ChatPanel() {
 *   const channel = usePageletChannel('chat')
 *   // channel?.pageletChannelProtocol 可用于 RPC 通信
 * }
 * ```
 */
export function usePageletChannel(panelName: string): PageletClientChannel | undefined {
  return useSyncExternalStore(
    subscribe,
    () => getChannel(panelName),
  )
}
