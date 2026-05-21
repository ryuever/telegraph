import React from 'react'
import { cn } from '@/packages/ui/lib/utils'

type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'code'; language?: string; code: string }
  | { type: 'quote'; text: string }
  | { type: 'rule' }

interface MarkdownMessageProps {
  content: string
  className?: string
  compact?: boolean
}

export function MarkdownMessage({
  content,
  className,
  compact = false,
}: MarkdownMessageProps): React.JSX.Element {
  const blocks = parseMarkdownBlocks(content)

  return (
    <div
      className={cn(
        'min-w-0 text-foreground',
        compact ? 'space-y-2 text-[13px] leading-relaxed' : 'space-y-3 text-[13.5px] leading-7',
        className,
      )}
    >
      {blocks.map((block, index) => renderBlock(block, index, compact))}
    </div>
  )
}

function renderBlock(block: MarkdownBlock, index: number, compact: boolean): React.ReactNode {
  if (block.type === 'heading') {
    const size = block.level === 1
      ? 'text-base'
      : block.level === 2
        ? 'text-[15px]'
        : 'text-sm'
    const Tag = block.level === 1 ? 'h2' : block.level === 2 ? 'h3' : 'h4'
    return (
      <Tag key={index} className={cn('font-semibold leading-snug text-foreground', size, index > 0 && 'pt-1')}>
        {renderInline(block.text)}
      </Tag>
    )
  }

  if (block.type === 'paragraph') {
    return (
      <p key={index} className="text-foreground/95">
        {renderInline(block.text)}
      </p>
    )
  }

  if (block.type === 'quote') {
    return (
      <blockquote
        key={index}
        className="border-l-2 border-primary/30 bg-surface-soft px-3 py-2 text-muted-foreground"
      >
        {renderInline(block.text)}
      </blockquote>
    )
  }

  if (block.type === 'list') {
    const Tag = block.ordered ? 'ol' : 'ul'
    return (
      <Tag
        key={index}
        className={cn(
          'space-y-1.5 pl-5 text-foreground/95',
          block.ordered ? 'list-decimal' : 'list-disc',
        )}
      >
        {block.items.map((item, itemIndex) => (
          <li key={`${String(index)}-${String(itemIndex)}`} className="pl-1">
            {renderInline(item)}
          </li>
        ))}
      </Tag>
    )
  }

  if (block.type === 'code') {
    return (
      <div key={index} className="overflow-hidden rounded-md border border-border bg-slate-950 shadow-sm">
        {block.language && (
          <div className="border-b border-white/10 px-3 py-1.5 font-mono text-[10px] text-slate-400">
            {block.language}
          </div>
        )}
        <pre
          className={cn(
            'overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-slate-100',
            compact && 'text-[11.5px]',
          )}
        >
          <code>{block.code}</code>
        </pre>
      </div>
    )
  }

  return <hr key={index} className="border-border" />
}

function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n')
  const blocks: MarkdownBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index] ?? ''
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim() || undefined
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !(lines[index] ?? '').trim().startsWith('```')) {
        codeLines.push(lines[index] ?? '')
        index += 1
      }
      if (index < lines.length) index += 1
      blocks.push({ type: 'code', language, code: codeLines.join('\n') })
      continue
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(trimmed)
    if (heading) {
      blocks.push({
        type: 'heading',
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2],
      })
      index += 1
      continue
    }

    if (/^[-*_]{3,}$/.test(trimmed)) {
      blocks.push({ type: 'rule' })
      index += 1
      continue
    }

    if (isListLine(trimmed)) {
      const ordered = isOrderedListLine(trimmed)
      const items: string[] = []
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim()
        if (!current || isOrderedListLine(current) !== ordered || !isListLine(current)) break
        items.push(stripListMarker(current))
        index += 1
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    if (trimmed.startsWith('>')) {
      const quoteLines: string[] = []
      while (index < lines.length) {
        const current = (lines[index] ?? '').trim()
        if (!current.startsWith('>')) break
        quoteLines.push(current.replace(/^>\s?/, ''))
        index += 1
      }
      blocks.push({ type: 'quote', text: joinTextLines(quoteLines) })
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length) {
      const current = lines[index] ?? ''
      const currentTrimmed = current.trim()
      if (
        !currentTrimmed ||
        currentTrimmed.startsWith('```') ||
        /^(#{1,3})\s+/.test(currentTrimmed) ||
        isListLine(currentTrimmed) ||
        currentTrimmed.startsWith('>') ||
        /^[-*_]{3,}$/.test(currentTrimmed)
      ) {
        break
      }
      paragraphLines.push(currentTrimmed)
      index += 1
    }
    blocks.push({ type: 'paragraph', text: joinTextLines(paragraphLines) })
  }

  return blocks
}

function joinTextLines(lines: string[]): string {
  return lines.join('\n')
}

function isListLine(value: string): boolean {
  return /^[-*]\s+/.test(value) || isOrderedListLine(value)
}

function isOrderedListLine(value: string): boolean {
  return /^\d+[.)]\s+/.test(value)
}

function stripListMarker(value: string): string {
  return value.replace(/^[-*]\s+/, '').replace(/^\d+[.)]\s+/, '')
}

function renderInline(text: string): React.ReactNode[] {
  const result: React.ReactNode[] = []
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g
  let cursor = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      result.push(renderTextWithBreaks(text.slice(cursor, match.index), `t-${String(cursor)}`))
    }

    const token = match[0]
    if (token.startsWith('**') && token.endsWith('**')) {
      result.push(
        <strong key={`b-${String(match.index)}`} className="font-semibold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      )
    } else if (token.startsWith('`') && token.endsWith('`')) {
      result.push(
        <code
          key={`c-${String(match.index)}`}
          className="rounded bg-surface-soft px-1.5 py-0.5 font-mono text-[0.9em] text-foreground"
        >
          {token.slice(1, -1)}
        </code>,
      )
    } else {
      const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(token)
      if (link) {
        result.push(
          <a
            key={`a-${String(match.index)}`}
            href={safeHref(link[2])}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-primary underline decoration-primary/25 underline-offset-4 hover:decoration-primary"
          >
            {link[1]}
          </a>,
        )
      }
    }

    cursor = match.index + token.length
  }

  if (cursor < text.length) {
    result.push(renderTextWithBreaks(text.slice(cursor), `t-${String(cursor)}`))
  }

  return result
}

function renderTextWithBreaks(text: string, keyPrefix: string): React.ReactNode {
  const parts = text.split('\n')
  if (parts.length === 1) return parts[0]
  return parts.flatMap((part, index) => {
    if (index === parts.length - 1) return [part]
    return [part, <br key={`${keyPrefix}-br-${String(index)}`} />]
  })
}

function safeHref(href: string): string {
  const trimmed = href.trim()
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('#')
  ) {
    return trimmed
  }
  return '#'
}
