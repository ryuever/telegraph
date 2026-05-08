import React, { useState } from 'react'
import { Button } from '@telegraph/ui/components/ui/button'
import { Textarea } from '@telegraph/ui/components/ui/textarea'

interface Message {
  role: 'user' | 'assistant'
  content: string
}

interface DesignWorkspaceProps {
  initialPrompt: string
}

export function DesignWorkspace({ initialPrompt }: DesignWorkspaceProps) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'user', content: initialPrompt },
    { role: 'assistant', content: '正在生成界面...\n\n这里将展示 AI 的回复内容，包括生成过程的说明和代码。' },
  ])
  const [input, setInput] = useState('')

  const handleSend = () => {
    if (!input.trim()) return
    setMessages((prev) => [...prev, { role: 'user', content: input.trim() }])
    setInput('')
    // TODO: 接入实际的 AI 生成逻辑
    setTimeout(() => {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: '已收到你的追问，正在调整...' },
      ])
    }, 500)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex h-full">
      {/* 左侧对话面板 */}
      <div className="flex w-[400px] shrink-0 flex-col border-r border-border">
        {/* 消息列表 */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.map((msg, i) => (
            <div key={i} className={msg.role === 'user' ? 'flex justify-end' : ''}>
              <div
                className={
                  msg.role === 'user'
                    ? 'max-w-[85%] rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground'
                    : 'text-sm text-foreground whitespace-pre-wrap'
                }
              >
                {msg.content}
              </div>
            </div>
          ))}
        </div>
        {/* 底部输入 */}
        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="追问或修改需求..."
              className="min-h-[40px] max-h-[120px] resize-none text-sm"
              rows={1}
            />
            <Button size="sm" onClick={handleSend} disabled={!input.trim()}>
              发送
            </Button>
          </div>
        </div>
      </div>

      {/* 右侧预览区域 */}
      <div className="flex flex-1 flex-col">
        {/* 预览工具栏 */}
        <div className="flex h-10 items-center justify-between border-b border-border px-4">
          <div className="flex items-center gap-2">
            <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
              预览
            </button>
            <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
              代码
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-accent">
              ↗ 新窗口
            </button>
          </div>
        </div>
        {/* 预览内容 */}
        <div className="flex flex-1 items-center justify-center bg-background p-8">
          <div className="rounded-lg border border-border bg-card p-8 shadow-sm">
            <p className="text-center text-sm text-muted-foreground">
              生成的界面将在这里预览
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
