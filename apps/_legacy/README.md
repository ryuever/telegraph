# `apps/_legacy/` — Reference-Only Archive

This directory holds the **previous** telegraph codebase (apps `telegraph`,
`design`, `chat`, `monitor`, plus the legacy renderer/runtime packages
`packages/{ui,agent,stores}`) preserved for documentation purposes only after
the project was rewritten from zero.

The only package kept live in the new workspace is `packages/runtime-contracts`,
since its types (RunInput, RuntimeEvent, …) are stable and likely to be reused
by the new agent layer in later phases.

## Rules

- **DO NOT import** anything from `apps/_legacy/**` in the new codebase. The
  workspace explicitly excludes it (`pnpm-workspace.yaml`: `!apps/_legacy/**`),
  the root `tsconfig` does not reference it, and lint/typecheck/test should not
  see these files.
- Treat the contents as **historical literature**. They use a different process
  topology (`port-manager`, ad-hoc `MessagePortMain` plumbing) that the new
  design replaces with `@x-oasis/async-call-rpc-electron`'s
  `ElectronConnectionOrchestrator` model.
- If you copy a fragment, **rewrite** it against the new contracts in
  `apps/telegraph/src/` and `apps/design/src/` — do not lift it verbatim.

## Why we kept it

- Source for future audit ("how did the old port-manager work, why did we
  abandon it?").
- Reference for renderer UI ideas (`packages/ui/src/components/monitor/...`)
  even though the new app rebuilds the panels from scratch.

## Where the new design lives

- Active plan: `codebase-wiki/roadmap/20260508-from-zero-design-only-electron-app-plan.md`
- Archived plans: same directory, files marked `ARCHIVED` in their headers.

When the new codebase reaches Phase 5 and is fully self-sufficient, this
directory may be deleted from the working tree (it remains in git history).
