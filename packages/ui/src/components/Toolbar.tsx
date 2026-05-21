import React from 'react'

export function Toolbar({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="relative flex h-9 shrink-0 items-center justify-center border-b border-border bg-card/80"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
