import type { JSX } from 'react'

export function HomePage(): JSX.Element {
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
          <p className="mt-2 text-sm text-muted-foreground">AI-powered design &amp; development</p>
        </div>
      </div>
    </div>
  )
}
