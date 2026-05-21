import { useState } from 'react'
import type { JSX } from 'react'
import { Sparkles } from 'lucide-react'
import { Button } from '@/packages/ui/components/ui/button'
import { Textarea } from '@/packages/ui/components/ui/textarea'

interface DesignEntryProps {
  onSubmit: (prompt: string) => void
}

export function DesignEntry({ onSubmit }: DesignEntryProps): JSX.Element {
  const [prompt, setPrompt] = useState('')

  const handleSubmit = () => {
    if (prompt.trim()) {
      onSubmit(prompt.trim())
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    setPrompt(e.target.value)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center bg-background px-6">
      <div className="mb-6 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-sm">
        <span className="h-2 w-2 rounded-full bg-accent-mint" />
        <span>Design workspace</span>
      </div>
      <h1 className="mb-7 text-2xl font-semibold text-foreground">
        你想创建什么界面？
      </h1>
      <div className="w-full max-w-[680px]">
        <div className="rounded-md border border-border bg-card shadow-sm">
          <Textarea
            value={prompt}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要生成的界面..."
            className="min-h-[96px] resize-none border-0 bg-transparent px-4 pt-4 text-[15px] shadow-none focus-visible:ring-0"
          />
          <div className="flex items-center justify-end border-t border-border/70 px-3 py-3">
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              className="rounded-md"
            >
              <Sparkles size={14} />
              生成
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
