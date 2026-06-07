import React from 'react'
import { CornerDownLeft, Loader2, Square, X } from 'lucide-react'
import { Button, type ButtonProps } from '@/packages/ui/components/ui/button'
import { Textarea } from '@/packages/ui/components/ui/textarea'
import { cn } from '@/packages/ui/lib/utils'

export type PromptInputStatus = 'submitted' | 'streaming' | 'ready' | 'error'

export interface PromptInputMessage {
  text: string
}

export interface PromptInputProps
  extends Omit<React.FormHTMLAttributes<HTMLFormElement>, 'onSubmit'> {
  onSubmit: (
    message: PromptInputMessage,
    event: React.FormEvent<HTMLFormElement>
  ) => void | Promise<void>
}

export function PromptInput({ className, onSubmit, children, ...props }: PromptInputProps) {
  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const formData = new FormData(form)
    const message = formData.get('message')
    const text = typeof message === 'string' ? message : ''
    void onSubmit({ text }, event)
  }

  return (
    <form className={cn('w-full', className)} onSubmit={handleSubmit} {...props}>
      <div
        className={cn(
          'relative flex w-full flex-col gap-2 rounded-md border border-border bg-background px-3 py-2.5 shadow-sm transition-colors',
          'focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/25'
        )}
      >
        {children}
      </div>
    </form>
  )
}

export type PromptInputBodyProps = React.HTMLAttributes<HTMLDivElement>

export function PromptInputBody({ className, ...props }: PromptInputBodyProps) {
  return <div className={cn('w-full pb-1', className)} {...props} />
}

export interface PromptInputTextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  minHeight?: number
  maxHeight?: number
}

export const PromptInputTextarea = React.forwardRef<HTMLTextAreaElement, PromptInputTextareaProps>(
  function PromptInputTextarea(
    {
      className,
      minHeight = 24,
      maxHeight = 220,
      onChange,
      onKeyDown,
      placeholder = 'What would you like to know?',
      ...props
    },
    ref
  ) {
    const internalRef = React.useRef<HTMLTextAreaElement | null>(null)
    const [isComposing, setIsComposing] = React.useState(false)

    const assignRef = React.useCallback(
      (node: HTMLTextAreaElement | null) => {
        internalRef.current = node
        if (typeof ref === 'function') {
          ref(node)
          return
        }
        if (ref) {
          ref.current = node
        }
      },
      [ref]
    )

    const resize = React.useCallback(() => {
      const element = internalRef.current
      if (!element) return
      element.style.height = '0px'
      const next = Math.min(maxHeight, Math.max(minHeight, element.scrollHeight))
      element.style.height = String(next) + 'px'
      element.style.overflowY = element.scrollHeight > maxHeight ? 'auto' : 'hidden'
    }, [maxHeight, minHeight])

    React.useEffect(() => {
      resize()
    }, [resize, props.value, props.defaultValue])

    const submitForm = React.useCallback((element: HTMLTextAreaElement) => {
      const form = element.form
      if (!form) return
      if (typeof form.requestSubmit === 'function') {
        form.requestSubmit()
        return
      }
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
    }, [])

    const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      onChange?.(event)
      resize()
    }

    const handleKeyDownInternal = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      onKeyDown?.(event)
      if (event.defaultPrevented) return
      if (event.key !== 'Enter' || event.shiftKey || isComposing || event.nativeEvent.isComposing) {
        return
      }
      event.preventDefault()
      submitForm(event.currentTarget)
    }

    return (
      <Textarea
        ref={assignRef}
        name="message"
        onChange={handleChange}
        onCompositionEnd={() => {
          setIsComposing(false)
        }}
        onCompositionStart={() => {
          setIsComposing(true)
        }}
        onKeyDown={handleKeyDownInternal}
        placeholder={placeholder}
        rows={1}
        className={cn(
          'min-h-[24px] resize-none border-0 bg-transparent px-0 py-0 text-[13.5px] leading-6 shadow-none focus-visible:ring-0',
          className
        )}
        {...props}
      />
    )
  }
)

export type PromptInputFooterProps = React.HTMLAttributes<HTMLDivElement>

export function PromptInputFooter({ className, ...props }: PromptInputFooterProps) {
  return (
    <div
      className={cn(
        'flex items-center justify-between gap-2 border-t border-border/70 pt-2',
        className
      )}
      {...props}
    />
  )
}

export type PromptInputToolsProps = React.HTMLAttributes<HTMLDivElement>

export function PromptInputTools({ className, ...props }: PromptInputToolsProps) {
  return <div className={cn('flex min-w-0 items-center gap-1', className)} {...props} />
}

export type PromptInputButtonProps = ButtonProps

export function PromptInputButton({ className, variant = 'ghost', size, ...props }: PromptInputButtonProps) {
  const nextSize = size ?? (React.Children.count(props.children) > 1 ? 'sm' : 'icon')
  return <Button className={className} size={nextSize} variant={variant} type="button" {...props} />
}

export interface PromptInputSubmitProps extends ButtonProps {
  status?: PromptInputStatus
  onStop?: () => void
}

export function PromptInputSubmit({
  className,
  status = 'ready',
  onStop,
  onClick,
  size = 'icon',
  variant = 'default',
  children,
  ...props
}: PromptInputSubmitProps) {
  const isGenerating = status === 'submitted' || status === 'streaming'

  let icon: React.ReactNode = <CornerDownLeft className="size-4" />
  if (status === 'submitted') {
    icon = <Loader2 className="size-4 animate-spin" />
  } else if (status === 'streaming') {
    icon = <Square className="size-4 fill-current" />
  } else if (status === 'error') {
    icon = <X className="size-4" />
  }

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (isGenerating && onStop) {
      event.preventDefault()
      onStop()
      return
    }
    onClick?.(event)
  }

  return (
    <Button
      aria-label={isGenerating ? 'Stop' : 'Submit'}
      className={className}
      onClick={handleClick}
      size={size}
      type={isGenerating && onStop ? 'button' : 'submit'}
      variant={variant}
      {...props}
    >
      {children ?? icon}
    </Button>
  )
}
