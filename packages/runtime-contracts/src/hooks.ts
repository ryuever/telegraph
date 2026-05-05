export type HookName =
  | 'beforeRun'
  | 'afterRun'
  | 'beforeModelRequest'
  | 'afterModelEvent'
  | 'beforeToolCall'
  | 'afterToolResult'
  | 'onRuntimeEvent'
  | 'onMessageCommitted'

export type HookHandler<_N extends HookName> = (payload: unknown) => void | Promise<void>
