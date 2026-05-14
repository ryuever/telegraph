import { useState } from 'react'
import type { JSX } from 'react'
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
    <div className="flex h-full flex-col items-center justify-center px-4">
      <h1 className="mb-8 text-3xl font-semibold text-foreground">
        你想创建什么？
      </h1>
      <div className="w-full max-w-[640px]">
        <div className="rounded-xl border border-border bg-card shadow-sm">
          <Textarea
            value={prompt}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder="描述你想要生成的界面..."
            className="min-h-[80px] resize-none border-0 bg-transparent px-4 pt-4 text-base focus-visible:ring-0"
          />
          <div className="flex items-center justify-between px-4 pb-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>Shift+Enter 换行</span>
            </div>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!prompt.trim()}
              className="rounded-full"
            >
              生成
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
