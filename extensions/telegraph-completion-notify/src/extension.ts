/**
 * Hook + MessageRenderer entry point for the `@telegraph/completion-notify`
 * extension (4-pack item D).
 *
 * Contribution kinds exercised:
 *
 *   1. **Hook** (`afterRun`) — the factory subscribes via
 *      `context.hooks.on('afterRun', ...)`. The chat pagelet bridges its
 *      process-lifetime extension HookBus into each per-run AgentHarness'
 *      HookBus by snapshotting handlers at run-start time (see
 *      `ChatPageletWorker.handleSend`), so this handler fires once per
 *      completed run with the terminal AgentEvent.
 *
 *   2. **MessageRenderer** (register-only) — the factory registers a
 *      `MessageRendererContribution` keyed on `match='system:run-completed'`
 *      and `componentId='completion-notify-banner'`. The chat renderer
 *      does **not** yet ship the cross-process contribution-query RPC or
 *      a componentId → React-component registry needed to actually mount
 *      that component (D-016 §9 Q1 leaves both for a follow-up RFC), so
 *      this contribution is intentionally register-only for the demo and
 *      is exercised through the host's `listMessageRenderers()` API in
 *      tests. The notification UX in this 4-pack item flows through the
 *      complementary stream-event surface instead (see item 3 below).
 *
 *   3. **Notify capability** (chat-side, custom) — the chat pagelet
 *      publishes a `ChatNotifyCapability` under the custom key
 *      `'chat.notify'` (see {@link CHAT_NOTIFY_CAPABILITY_KEY} in
 *      `apps/chat/src/application/common`). The afterRun handler calls
 *      it to push a `ChatExtensionNotificationStreamEvent` onto the chat
 *      stream, which the renderer turns into a toast/banner. The string
 *      literal is duplicated here rather than imported because this
 *      extension package cannot reach into the chat app's source tree;
 *      keep them in sync — a missing key resolves to `undefined` and the
 *      extension silently no-ops on notify (still safe, just invisible).
 */

import type {
  AgentCapability,
  AgentCapabilityContext,
} from '@/packages/agent-capabilities'
import type { AfterRunHookPayload } from '@/packages/agent-protocol'

/**
 * Mirrors `apps/chat/src/application/common/index.ts:CHAT_NOTIFY_CAPABILITY_KEY`.
 * Duplicated to keep this extension free of an `@/apps/chat/*` import — that
 * package alias does not exist outside of chat's own tsconfig.
 */
export const CHAT_NOTIFY_CAPABILITY_KEY = 'chat.notify'

/** Subset of the chat-side `ChatNotifyCapability` shape we depend on. */
export type ChatNotifyCapability = (input: {
  extensionId: string
  level?: 'info' | 'warn' | 'error'
  message: string
  runId?: string
  sessionId?: string
}) => void

/** Extension identifier used in emitted notifications. */
export const COMPLETION_NOTIFY_EXTENSION_ID = '@telegraph/completion-notify'

/** Renderer componentId used in the (register-only) MessageRenderer contribution. */
export const COMPLETION_NOTIFY_RENDERER_COMPONENT_ID = 'completion-notify-banner'

/**
 * Build the notification message body. Pulled out so tests can exercise
 * it without spinning up the whole capability context.
 */
export function buildCompletionMessage(payload: AfterRunHookPayload): string {
  const runtimeId = payload.runtimeId
  const terminal = payload.terminalEvent
  if (!terminal) {
    return `Run completed (runtime=${runtimeId}).`
  }
  if (terminal.type === 'run_completed') {
    return `Run completed (runtime=${runtimeId}).`
  }
  if (terminal.type === 'run_failed') {
    const reason = terminal.error.message || terminal.error.code || 'unknown error'
    return `Run failed (runtime=${runtimeId}): ${reason}.`
  }
  if (terminal.type === 'run_cancelled') {
    const suffix = terminal.reason ? `: ${terminal.reason}` : ''
    return `Run cancelled (runtime=${runtimeId})${suffix}.`
  }
  return `Run completed (runtime=${runtimeId}, terminal=${terminal.type}).`
}

/**
 * Map terminal AgentEvent type → notification severity level. Defaults to
 * info so missing terminals (extension activated after the run actually
 * finished, no terminal recorded) still surface visibly.
 */
export function notificationLevelFor(payload: AfterRunHookPayload): 'info' | 'warn' | 'error' {
  const t = payload.terminalEvent?.type
  if (t === 'run_failed') return 'error'
  if (t === 'run_cancelled') return 'warn'
  return 'info'
}

const extension: AgentCapability = (context: AgentCapabilityContext) => {
  const { host, hooks } = context

  // MessageRenderer contribution — register-only per the doc comment above.
  host.registerMessageRenderer({
    id: 'completion-notify-banner',
    match: 'system:run-completed',
    componentId: COMPLETION_NOTIFY_RENDERER_COMPONENT_ID,
  })

  // Resolve the chat-side notify capability lazily on every hook fire
  // rather than caching it at activation time. Two reasons:
  //   * It avoids capturing a stale reference if the host implementation
  //     ever swaps the registered notify (today it doesn't, but cheap
  //     defense).
  //   * It keeps the extension safe to activate against hosts that don't
  //     ship the chat-notify surface at all — `getCustom` returns
  //     undefined and the handler simply no-ops.
  const offAfterRun = hooks.on('afterRun', payload => {
    const notify = host.getCustom(CHAT_NOTIFY_CAPABILITY_KEY) as ChatNotifyCapability | undefined
    if (typeof notify !== 'function') return
    notify({
      extensionId: COMPLETION_NOTIFY_EXTENSION_ID,
      level: notificationLevelFor(payload),
      message: buildCompletionMessage(payload),
      runId: payload.request.runId,
      sessionId: payload.request.sessionId,
    })
  })

  // CapabilityHost intentionally has no `unregister*` symmetric APIs as of
  // D-016 — registrations live for the host lifetime. The hook subscription
  // does support unsubscribe, so we tear it down on deactivation to avoid
  // double-firing if the extension is hot-reloaded.
  return () => {
    offAfterRun()
  }
}

export default extension
