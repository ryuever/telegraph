import './index/styles/globals.css'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toolbar } from './index/components/Toolbar'
import { MonitorPanel } from './index/components/monitor/MonitorPanel'

declare global {
  interface Window {
    redcity?: any
  }
}

function App() {
  const hasBridge = typeof window !== 'undefined' && !!window.redcity
  const bridgeKeys = hasBridge ? Object.keys(window.redcity) : []

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
        <h1>🚀 Speedy</h1>
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
      </div>
    </div>
  )
}

function pickRoot() {
  const hash = typeof window !== 'undefined' ? window.location.hash : ''
  if (hash.includes('/monitor')) return <MonitorPanel />
  return <App />
}

document.documentElement.classList.add('dark')

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(pickRoot())
