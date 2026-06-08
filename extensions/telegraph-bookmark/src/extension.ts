/**
 * Command-style entry point for the `@telegraph/bookmark` extension
 * (4-pack item B).
 *
 * Contribution kind exercised: Command. The factory owns a process-local
 * {@link BookmarkStore} and registers a single command:
 *
 *   /bookmark <messageId> [label?]
 *
 * The chat pagelet routes `/bookmark` typed in `ChatComposer` through the
 * new `IChatPageletService.invokeCommand(id, args)` RPC, which resolves the
 * command on the host (`CapabilityHost.getCommand('bookmark').invoke(args)`)
 * and ships the returned snapshot back to the renderer. The renderer mirrors
 * the snapshot into its own `bookmark-store` zustand slice so the bookmark
 * badge can re-render synchronously.
 *
 * The command intentionally takes `messageId` as an explicit argument
 * rather than "bookmark the most recent assistant message". Doing the
 * latter on the pagelet side would require leaking the chat-session message
 * history across the RPC boundary; the renderer already knows which message
 * is the user's bookmark target (whatever was selected / right-clicked) and
 * can pass its id in. This keeps the contribution decoupled from chat's
 * message-store internals.
 *
 * Cleanup wipes the store. The command registration stays on the host
 * (CapabilityHost is owned by the pagelet lifetime, per RFC §7 P5).
 */

import type {
  AgentCapability,
  AgentCapabilityContext,
} from '@/packages/agent-capabilities'
import { BookmarkStore, type BookmarkSnapshot } from './BookmarkStore'

export const TELEGRAPH_BOOKMARK_STORE_KEY = 'telegraph-bookmark.store'

export interface BookmarkCommandInput {
  messageId: string
  label?: string
}

export interface BookmarkCommandResult {
  /** New bookmark state for the target messageId. */
  bookmarked: boolean
  /** Fresh snapshot of all bookmarks. Renderer overlays this onto its mirror. */
  snapshot: BookmarkSnapshot
}

function parseInvokeArgs(args: unknown): BookmarkCommandInput {
  if (typeof args !== 'object' || args === null) {
    throw new Error('/bookmark: args must be an object with at least a "messageId" field')
  }
  const record = args as Record<string, unknown>
  const messageId = record.messageId
  if (typeof messageId !== 'string' || messageId.length === 0) {
    throw new Error('/bookmark: "messageId" must be a non-empty string')
  }
  const label = typeof record.label === 'string' && record.label.length > 0 ? record.label : undefined
  return label === undefined ? { messageId } : { messageId, label }
}

const extension: AgentCapability = (context: AgentCapabilityContext) => {
  const { host } = context

  const store = new BookmarkStore()
  host.registerCustom(TELEGRAPH_BOOKMARK_STORE_KEY, store)

  host.registerCommand({
    id: 'bookmark',
    title: 'Toggle bookmark on a chat message',
    command: '/bookmark',
    invoke: (args?: unknown): BookmarkCommandResult => {
      const input = parseInvokeArgs(args)
      const { bookmarked } = store.toggle(input.messageId, input.label)
      return { bookmarked, snapshot: store.snapshot() }
    },
  })

  return () => {
    store.clear()
  }
}

export default extension
