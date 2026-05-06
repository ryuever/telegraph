import './renderer.css'
import React from 'react'
import ReactDOM from 'react-dom/client'

import { MonitorPanel } from '@telegraph/ui/components/monitor/MonitorPanel'
import { ChatPanel } from '@telegraph/ui/components/chat/ChatPanel'
import { DesignPanel } from '@telegraph/ui/components/design/DesignPanel'
import { initChannel, getChannel, pingPageletProcess, createServiceProxy } from '@telegraph/services/port-manager/browser/InlinePanelChannelManager'
import { notifyChannelChange } from '@telegraph/services/port-manager/browser/usePageletChannel'

// 挂到 window 上方便在 DevTools 中调试通信
// 同时也供 UI 组件通过 __telegraphDebug.createServiceProxy 调用
;(window as any).__telegraphDebug = { initChannel, getChannel, pingPageletProcess, createServiceProxy }

declare global {
  interface Window {
    telegraph?: any
  }
}

const HomeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    <polyline points="9 22 9 12 15 12 15 22" />
  </svg>
)

const DesignIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M3 9h18" />
    <path d="M9 21V9" />
  </svg>
)

const ChatIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
  </svg>
)

function useHashRoute() {
  const get = () => (typeof window !== 'undefined' ? window.location.hash : '')
  const [hash, setHash] = React.useState(get)
  React.useEffect(() => {
    const onChange = () => setHash(get())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

/**
 * Pagelet BrowserView 中的页面内容，通过 hash 路由渲染对应组件。
 * 仅用于独立窗口的 BrowserView（如 Monitor）。
 * Chat/Design 已迁移到主 renderer 内渲染，不再使用 BrowserView。
 */
function PageletContent() {
  const hash = useHashRoute()

  // 为独立 BrowserView（如 monitor）初始化 MessagePort 连接
  if (RENDERER_PROCESS_ID && RENDERER_PROCESS_ID.includes('pagelet.')) {
    const projectName = RENDERER_PROCESS_ID.split('_').pop()?.replace('pagelet.', '') || ''
    if (projectName && !getChannel(projectName)) {
      try {
        const channel = initChannel(projectName)
        console.info(`[PageletContent] Channel initialized for "${projectName}" (BrowserView)`, channel.id)
      } catch (err) {
        console.error(`[PageletContent] Failed to init channel for "${projectName}"`, err)
      }
    }
  }

  if (hash.includes('/monitor')) return <MonitorPanel />
  return <HomePage />
}

/**
 * 内嵌面板区域：chat 和 design 面板直接在主 renderer 中渲染。
 * 不再创建独立 BrowserView，但每个面板仍有独立的 PageletProcess（UtilityProcess）
 * 负责数据处理，通过 MessagePort 与 renderer 通信。
 */
function PanelContent({ panel }: { panel: string }) {
  switch (panel) {
    case 'chat':
      return <ChatPanel />
    case 'design':
      return <DesignPanel />
    default:
      return <HomePage />
  }
}

function Sidebar({ current, onSwitch }: { current: string; onSwitch: (key: string) => void }) {
  const links = [
    { key: 'home', label: 'Home', icon: HomeIcon },
    { key: 'design', label: 'Design', icon: DesignIcon },
    { key: 'chat', label: 'Chat', icon: ChatIcon },
  ]

  return (
    <div
      className="flex w-16 shrink-0 flex-col items-center border-r border-border bg-zinc-950/60 pt-10 gap-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {links.map((link) => (
        <button
          key={link.key}
          onClick={() => onSwitch(link.key)}
          title={link.label}
          className={`group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            current === link.key
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <link.icon />
          <span className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-1.5 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100">
            {link.label}
          </span>
        </button>
      ))}
    </div>
  )
}

function HomePage() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-6">
      <div className="flex flex-col items-center gap-6">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 shadow-lg shadow-indigo-500/20">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 2L11 13" />
            <path d="M22 2L15 22L11 13L2 9L22 2Z" />
          </svg>
        </div>
        <div className="text-center">
          <h1 className="text-xl font-medium text-foreground tracking-tight">Telegraph</h1>
          <p className="mt-2 text-sm text-muted-foreground">AI-powered design & development</p>
        </div>
      </div>
    </div>
  )
}

function getRendererProcessId(): string | null {
  // production: 参数在 window.location.search 中
  const searchParams = new URLSearchParams(window.location.search)
  const fromSearch = searchParams.get('TELEGRAPH_PAGELET_RENDERER_PROCESS_ID')
  if (fromSearch) return fromSearch

  // dev: URL 形如 http://localhost:5173/#/index.monitor.html?KEY=value
  // 参数在 hash 的 ? 后面，不在 location.search 中
  const hash = window.location.hash
  const hashQueryIndex = hash.indexOf('?')
  if (hashQueryIndex !== -1) {
    const hashParams = new URLSearchParams(hash.slice(hashQueryIndex + 1))
    return hashParams.get('TELEGRAPH_PAGELET_RENDERER_PROCESS_ID')
  }

  return null
}

// 在模块加载时立即计算，避免 React 渲染过程中的延迟
const RENDERER_PROCESS_ID = getRendererProcessId()

/** inline panel 名称集合，与主进程 INLINE_PANELS 保持一致 */
const INLINE_PANELS = new Set(['chat', 'design'])

/**
 * 为 inline panel 初始化 PageletClientChannel（延迟到首次使用时）。
 * 主进程在启动 2s 后预创建 PageletProcess，
 * renderer 侧在用户首次切到面板时建立 MessagePort 连接。
 */
function ensureChannelReady(panelName: string): void {
  if (!INLINE_PANELS.has(panelName)) return
  if (getChannel(panelName)) return // 已初始化

  try {
    const channel = initChannel(panelName)
    console.info(`[InlinePanel] Channel initialized for "${panelName}"`, channel.id)
    notifyChannelChange()
  } catch (err) {
    console.error(`[InlinePanel] Failed to init channel for "${panelName}"`, err)
  }
}

function Root() {
  const appId = RENDERER_PROCESS_ID
  const [currentPanel, setCurrentPanel] = React.useState('home')

  // Pagelet BrowserView 的 ID 包含 'pagelet.' 模式（如 window.2_panel.monitor_pagelet.monitor）
  // 仅 Monitor 等独立窗口仍使用此分支
  const isPageletView = appId && appId.includes('pagelet.')

  if (isPageletView) {
    return (
      <div className="h-screen bg-background">
        <PageletContent />
      </div>
    )
  }

  const handleSwitch = (key: string) => {
    setCurrentPanel(key)
    // 通知主进程面板切换（用于 PageletProcess 生命周期管理）
    window.telegraph?.ipcRenderer?.invoke('telegraph:switch-panel', key).then(() => {
      // 主进程已确保 PageletProcess 存在，现在安全地初始化 MessagePort 通道
      ensureChannelReady(key)
    })
  }

  // 主窗口：Sidebar + 面板内容
  // Chat/Design 直接在主 renderer 内渲染，不再使用 BrowserView
  return (
    <div className="flex h-screen bg-background">
      <Sidebar current={currentPanel} onSwitch={handleSwitch} />
      <div className="flex-1 overflow-hidden">
        <PanelContent panel={currentPanel} />
      </div>
    </div>
  )
}

document.documentElement.classList.add('dark')

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<Root />)
