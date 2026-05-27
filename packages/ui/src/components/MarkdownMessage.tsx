import React, { useMemo } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/packages/ui/lib/utils'

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
  const components = useMemo(() => createMarkdownComponents(compact), [compact])

  return (
    <div
      className={cn(
        'min-w-0 text-foreground',
        compact ? 'space-y-2 text-[13px] leading-relaxed' : 'space-y-3 text-[13.5px] leading-7',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={components}
        urlTransform={safeUrlTransform}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

function createMarkdownComponents(compact: boolean): Components {
  return {
    h1(props) {
      const { className, ...rest } = stripNode(props)
      return <h1 {...rest} className={cn('text-base font-semibold leading-snug text-foreground', className)} />
    },
    h2(props) {
      const { className, ...rest } = stripNode(props)
      return <h2 {...rest} className={cn('text-[15px] font-semibold leading-snug text-foreground', className)} />
    },
    h3(props) {
      const { className, ...rest } = stripNode(props)
      return <h3 {...rest} className={cn('text-sm font-semibold leading-snug text-foreground', className)} />
    },
    h4(props) {
      const { className, ...rest } = stripNode(props)
      return <h4 {...rest} className={cn('text-sm font-semibold leading-snug text-foreground', className)} />
    },
    h5(props) {
      const { className, ...rest } = stripNode(props)
      return <h5 {...rest} className={cn('text-sm font-semibold leading-snug text-foreground', className)} />
    },
    h6(props) {
      const { className, ...rest } = stripNode(props)
      return <h6 {...rest} className={cn('text-sm font-semibold leading-snug text-foreground', className)} />
    },
    p(props) {
      const { className, ...rest } = stripNode(props)
      return <p {...rest} className={cn('whitespace-pre-wrap text-foreground/95', className)} />
    },
    a(props) {
      const { className, href, ...rest } = stripNode(props)
      return (
        <a
          {...rest}
          href={safeUrlTransform(href ?? '')}
          target="_blank"
          rel="noreferrer"
          className={cn(
            'font-medium text-primary underline decoration-primary/25 underline-offset-4 hover:decoration-primary',
            className,
          )}
        />
      )
    },
    blockquote(props) {
      const { className, ...rest } = stripNode(props)
      return (
        <blockquote
          {...rest}
          className={cn('border-l-2 border-primary/30 bg-surface-soft px-3 py-2 text-muted-foreground', className)}
        />
      )
    },
    ul(props) {
      const { className, ...rest } = stripNode(props)
      return <ul {...rest} className={cn('space-y-1.5 pl-5 text-foreground/95', 'list-disc', className)} />
    },
    ol(props) {
      const { className, ...rest } = stripNode(props)
      return <ol {...rest} className={cn('space-y-1.5 pl-5 text-foreground/95', 'list-decimal', className)} />
    },
    li(props) {
      const { className, ...rest } = stripNode(props)
      return <li {...rest} className={cn('pl-1', className)} />
    },
    code(props) {
      const { className, ...rest } = stripNode(props)
      const isBlockCode = className?.includes('language-') ?? false
      return (
        <code
          {...rest}
          className={cn(
            isBlockCode
              ? 'font-mono text-inherit'
              : 'rounded bg-surface-soft px-1.5 py-0.5 font-mono text-[0.9em] text-foreground',
            className,
          )}
        />
      )
    },
    pre(props) {
      const { className, ...rest } = stripNode(props)
      return (
        <pre
          {...rest}
          className={cn(
            'overflow-x-auto rounded-md border border-border bg-slate-950 p-3 font-mono text-[12px] leading-relaxed text-slate-100 shadow-sm',
            compact && 'text-[11.5px]',
            className,
          )}
        />
      )
    },
    hr(props) {
      const { className, ...rest } = stripNode(props)
      return <hr {...rest} className={cn('border-border', className)} />
    },
    table(props) {
      const { className, ...rest } = stripNode(props)
      return (
        <div className="overflow-x-auto rounded-md border border-border">
          <table
            {...rest}
            className={cn('w-full min-w-max border-collapse text-left text-[12.5px] leading-relaxed', className)}
          />
        </div>
      )
    },
    thead(props) {
      const { className, ...rest } = stripNode(props)
      return <thead {...rest} className={cn('bg-surface-soft', className)} />
    },
    th(props) {
      const { className, ...rest } = stripNode(props)
      return (
        <th {...rest} className={cn('border-b border-border px-3 py-2 font-semibold text-foreground', className)} />
      )
    },
    tr(props) {
      const { className, ...rest } = stripNode(props)
      return <tr {...rest} className={cn('border-t border-border/70', className)} />
    },
    td(props) {
      const { className, ...rest } = stripNode(props)
      return <td {...rest} className={cn('px-3 py-2 text-foreground/95', className)} />
    },
    input(props) {
      const { className, ...rest } = stripNode(props)
      return <input {...rest} className={cn('mr-2 align-middle accent-primary', className)} />
    },
    del(props) {
      const { className, ...rest } = stripNode(props)
      return <del {...rest} className={cn('text-muted-foreground', className)} />
    },
    strong(props) {
      const { className, ...rest } = stripNode(props)
      return <strong {...rest} className={cn('font-semibold text-foreground', className)} />
    },
  }
}

function stripNode<T extends { node?: unknown }>(props: T): Omit<T, 'node'> {
  const { node, ...rest } = props
  void node
  return rest
}

function safeUrlTransform(url: string): string {
  return defaultUrlTransform(url)
}
