import '@telegraph/ui/styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toolbar } from '@telegraph/ui/components/Toolbar'
import { MonitorPanel } from '@telegraph/ui/components/monitor/MonitorPanel'
import { ChatPanel } from '@telegraph/ui/components/chat/ChatPanel'

declare global {
  interface Window {
    telegraph?: any
  }
}

function App() {
  const hasBridge = typeof window !== 'undefined' && !!window.telegraph
  const bridgeKeys = hasBridge ? Object.keys(window.telegraph) : []

  return (
    <div
      style={{
        height: '100vh',
        color: 'white',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
      }}
    >
      <Toolbar />
      <div style={{ flex: 1, padding: '40px', textAlign: 'center' }}>
        <h1>🚀 Telegraph</h1>
        <p style={{ fontSize: 18, marginTop: 20 }}>Electron App Started Successfully!</p>
        <div style={{ marginTop: 40, fontSize: 14, opacity: 0.85 }}>
          <p>Built with:</p>
          <p>⚛️ React • ⚡ Vite • 🔌 Electron • 📦 x-oasis</p>
        </div>
        <div
          style={{
            marginTop: 32,
            padding: '12px 18px',
            background: hasBridge ? 'rgba(0,200,80,0.25)' : 'rgba(220,80,80,0.25)',
            borderRadius: 8,
            display: 'inline-block',
            fontSize: 13,
          }}
        >
          preload bridge: {hasBridge ? `OK (${bridgeKeys.join(', ')})` : 'NOT EXPOSED'}
        </div>
        <div style={{ marginTop: 28, display: 'flex', gap: 12, justifyContent: 'center' }}>
          <a href="#/chat" style={routeLinkStyle}>
            Open Chat →
          </a>
          <a href="#/monitor" style={routeLinkStyle}>
            Open Monitor →
          </a>
        </div>
      </div>
    </div>
  )
}

const routeLinkStyle: React.CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  background: 'rgba(255,255,255,0.12)',
  color: 'white',
  fontSize: 13,
  textDecoration: 'none',
  border: '1px solid rgba(255,255,255,0.18)',
}

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

function Root() {
  const hash = useHashRoute()
  if (hash.includes('/monitor')) return <MonitorPanel />
  if (hash.includes('/chat')) return <ChatPanel />
  return <App />
}

document.documentElement.classList.add('dark')

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<Root />)
