/**
 * Command-style entry point for the `@telegraph/todo` extension (4-pack item C).
 *
 * Contribution kind exercised: Tool. The factory owns a process-local
 * {@link TodoStore} and registers two tools backed by it:
 *
 *   - `todo_read`  → `TodoStore.snapshot()`
 *   - `todo_write` → discriminated by `op` (add | toggle | remove | clear)
 *
 * Both tools are picked up automatically by `AgentHarness.toRuntimeInput`
 * (which calls `capabilities.listToolCapabilities()`) so the chat pagelet's
 * runtime adapter sees them on every turn with zero chat-side wiring. The
 * pagelet renders tool calls + results through the existing `AgentToolCall`
 * UI; nothing extra is needed for this demo.
 *
 * Cleanup clears the store so a future deactivate→reactivate cycle starts
 * fresh. The tool registrations themselves stay on the host (CapabilityHost
 * is owned by the pagelet lifetime, per RFC §7 P5).
 */

import type {
  AgentCapability,
  AgentCapabilityContext,
} from '@/packages/agent-capabilities'
import { TodoStore } from './TodoStore'
import { createTodoReadTool, createTodoWriteTool } from './tools'

export const TELEGRAPH_TODO_STORE_KEY = 'telegraph-todo.store'

const extension: AgentCapability = (context: AgentCapabilityContext) => {
  const { host } = context

  const store = new TodoStore()
  host.registerCustom(TELEGRAPH_TODO_STORE_KEY, store)
  host.registerTool(createTodoReadTool(store))
  host.registerTool(createTodoWriteTool(store))

  return () => {
    store.clear()
  }
}

export default extension
