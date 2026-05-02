import React from 'react'

export function Toolbar() {
  return (
    <div
      style={{
        height: 36,
        background: 'rgba(0, 0, 0, 0.35)',
        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
        WebkitAppRegion: 'drag',
      } as React.CSSProperties}
    />
  )
}
