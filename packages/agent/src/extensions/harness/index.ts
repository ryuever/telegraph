/**
 * Backwards-compatibility shim (D-016 P6).
 *
 * Forwards the historical `@/packages/agent/extensions/harness` import path
 * to its new home in `@/packages/agent-extensions`. The shim is retained
 * during the P6→P7 window so consumers under `extensions/telegraph-subagents`
 * (and any downstream callers re-exported via `packages/agent/src/index.ts`)
 * keep compiling without churn. P7 will delete `packages/agent/src/extensions/`
 * outright and migrate the call-sites to import from
 * `@/packages/agent-extensions` directly.
 */
export * from '@/packages/agent-extensions'
export {
  CapabilityBroker,
} from '@/packages/agent-capabilities'
