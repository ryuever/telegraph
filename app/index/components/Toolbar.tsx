import React from 'react'

export function Toolbar({ children }: { children?: React.ReactNode }) {
  return (
    <div
      className="relative flex h-9 shrink-0 items-center justify-center border-b border-zinc-800/80 bg-zinc-950/80"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {children}
    </div>
  )
}
