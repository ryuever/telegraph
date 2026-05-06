import './renderer.css'
import React from 'react'
import ReactDOM from 'react-dom/client'

import { MonitorPanel } from '@telegraph/ui/components/monitor/MonitorPanel'
import { ChatPanel } from '@telegraph/ui/components/chat/ChatPanel'
import { DesignPanel } from '@telegraph/ui/components/design/DesignPanel'

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
 * 主窗口 renderer 不使用此组件（直接渲染 HomePage）。
 */
function PageletContent() {
  const hash = useHashRoute()
  if (hash.includes('/monitor')) return <MonitorPanel />
  if (hash.includes('/chat')) return <ChatPanel />
  if (hash.includes('/design')) return <DesignPanel />
  return <HomePage />
}

function Sidebar() {
  const [current, setCurrent] = React.useState('home')

  const links = [
    { key: 'home', label: 'Home', icon: HomeIcon },
    { key: 'design', label: 'Design', icon: DesignIcon },
    { key: 'chat', label: 'Chat', icon: ChatIcon },
  ]

  const handleSwitch = (key: string) => {
    setCurrent(key)
    window.telegraph?.ipcRenderer?.invoke('telegraph:switch-panel', key)
  }

  return (
    <div
      className="flex w-16 shrink-0 flex-col items-center border-r border-border bg-zinc-950/60 pt-10 gap-2"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {links.map((link) => (
        <button
          key={link.key}
          onClick={() => handleSwitch(link.key)}
          title={link.label}
          className={`group relative flex h-9 w-9 items-center justify-center rounded-lg transition-colors ${
            current === link.key
              ? 'bg-accent text-accent-foreground'
              : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground'
          }`}
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <link.icon />
          <span className="pointer-events-none absolute left-full ml-2 whitespace-nowrap rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-md opacity-0 transition-opacity group-hover:opacity-100">
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
        <div className="mt-4 flex gap-3">
          <button
            onClick={() => window.telegraph?.ipcRenderer?.invoke('telegraph:switch-panel', 'design')}
            className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground shadow-sm transition-colors hover:bg-accent"
          >
            开始设计
          </button>
          <button
            onClick={() => window.telegraph?.ipcRenderer?.invoke('telegraph:switch-panel', 'chat')}
            className="rounded-lg border border-border bg-card px-4 py-2.5 text-sm text-foreground shadow-sm transition-colors hover:bg-accent"
          >
            打开对话
          </button>
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

function Root() {
  const appId = RENDERER_PROCESS_ID

  // Pagelet BrowserView 的 ID 包含 'pagelet.' 模式（如 window.2_panel.monitor_pagelet.monitor）
  // 此时只渲染面板内容，不需要 Sidebar
  const isPageletView = appId && appId.includes('pagelet.')

  if (isPageletView) {
    return (
      <div className="h-screen bg-background">
        <PageletContent />
      </div>
    )
  }

  // 主窗口、登录页、辅助窗口等：带 Sidebar + Home 页面
  // Chat/Design 由独立 BrowserView 覆盖在上层渲染
  return (
    <div className="flex h-screen bg-background">
      <Sidebar />
      <div className="flex-1 overflow-hidden">
        <HomePage />
      </div>
    </div>
  )
}

document.documentElement.classList.add('dark')

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<Root />)