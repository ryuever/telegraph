import React, { useEffect, useRef, useState } from 'react'
import { Globe, Plus } from 'lucide-react'
import {
  PromptInput,
  PromptInputButton,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  type PromptInputMessage,
} from '@/packages/ui/components/ai-elements'

export interface ChatComposerProps {
  sessionId: string
  seedText: string
  modelValue: string
  modelOptions: Array<{ value: string; label: string }>
  onSelectModel: (value: string) => void
  onPersistSessionDraft: (sessionId: string, text: string) => void
  onSendMessage: (text: string) => void
  onStop: () => void
  isStreaming: boolean
  placeholder?: string
}

export const ChatComposer = React.memo(function ChatComposer({
  sessionId,
  seedText,
  modelValue,
  modelOptions,
  onSelectModel,
  onPersistSessionDraft,
  onSendMessage,
  onStop,
  isStreaming,
  placeholder = 'Message the agent',
}: ChatComposerProps) {
  const [text, setText] = useState(seedText)
  const textRef = useRef(text)
  textRef.current = text

  useEffect(() => {
    return () => {
      if (sessionId) {
        onPersistSessionDraft(sessionId, textRef.current)
      }
    }
  }, [sessionId, onPersistSessionDraft])

  const handleSend = (message: PromptInputMessage) => {
    const t = message.text.trim()
    if (!t || isStreaming) return
    onSendMessage(t)
    setText('')
    if (sessionId) {
      onPersistSessionDraft(sessionId, '')
    }
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text/plain')
    if (!pastedText) return

    e.preventDefault()
    const target = e.currentTarget
    const selectionStart = target.selectionStart
    const selectionEnd = target.selectionEnd
    setText(current => {
      const next = current.slice(0, selectionStart) + pastedText + current.slice(selectionEnd)
      requestAnimationFrame(() => {
        const caret = selectionStart + pastedText.length
        target.setSelectionRange(caret, caret)
      })
      return next
    })
  }

  const canSend = text.trim().length > 0 && !isStreaming

  return (
    <div className="border-t border-border bg-card/70 px-4 pb-4 pt-3">
      <div className="mx-auto max-w-3xl">
        <PromptInput className="group" onSubmit={handleSend}>
          <PromptInputBody>
            <PromptInputTextarea
              value={text}
              onChange={e => { setText(e.target.value); }}
              onPaste={handlePaste}
              placeholder={placeholder}
              className="flex-1"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputButton
                aria-label="Add attachment"
                className="h-7 w-7 rounded-full text-muted-foreground"
                variant="ghost"
              >
                <Plus className="size-4" />
              </PromptInputButton>
              <PromptInputButton
                className="h-7 rounded-full px-2.5 text-muted-foreground"
                variant="ghost"
              >
                <Globe className="size-4" />
                <span className="text-xs">Search</span>
              </PromptInputButton>
              <label className="sr-only" htmlFor="chat-model-select">Model</label>
              <select
                id="chat-model-select"
                value={modelValue}
                onChange={e => { onSelectModel(e.target.value); }}
                className="h-7 max-w-[220px] rounded-full border border-border bg-background px-2.5 text-xs text-muted-foreground outline-none transition-colors hover:text-foreground focus:border-ring"
                aria-label="Model selection"
              >
                {modelOptions.map(option => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </PromptInputTools>
            <PromptInputSubmit
              className="h-8 w-8 rounded-md"
              disabled={!canSend && !isStreaming}
              onStop={onStop}
              status={isStreaming ? 'streaming' : 'ready'}
            />
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  )
})
