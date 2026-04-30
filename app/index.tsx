import React from 'react'
import ReactDOM from 'react-dom/client'

function App() {
  return (
    <div style={{ padding: '40px', textAlign: 'center', color: 'white' }}>
      <h1>🚀 Speedy</h1>
      <p style={{ fontSize: '18px', marginTop: '20px' }}>
        Electron App Started Successfully!
      </p>
      <div style={{ marginTop: '40px', fontSize: '14px', opacity: 0.8 }}>
        <p>Built with:</p>
        <p>⚛️ React • ⚡ Vite • 🔌 Electron • 📦 x-oasis</p>
      </div>
    </div>
  )
}

const root = ReactDOM.createRoot(document.getElementById('root')!)
root.render(<App />)
