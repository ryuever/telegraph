# telegraph

> **🛑 Two orthogonal Guards — read the relevant one(s) before writing code.**
>
> | Guard | Dimension | Open it when… |
> |-------|-----------|---------------|
> | [`.agents/architecture-guard.md`](./.agents/architecture-guard.md) | **Process topology / IPC** (how processes talk) | touching IPC, RPC, channels, processes, services, BrowserWindow, ConnectionOrchestrator |
> | [`.agents/agent-runtime-guard.md`](./.agents/agent-runtime-guard.md) | **Agent run protocol** (RuntimeEvent, tool, extension, trace) | touching runtime adapters, tools, extensions, hooks, trace, RuntimeEvent types, pi-ai/pi-cli |
>
> Both can apply at once (e.g. "how does renderer consume RuntimeEvent across pagelet boundary?" needs both).
> For agent **design / strategy** discussions, also open [`.agents/agent-runtime-design.md`](./.agents/agent-runtime-design.md) (8 core principles, condensed from A-005).
>
> Quick triggers — if **any** apply, open the matching guard(s) first:
>
> *Topology (architecture-guard):*
> - new/modified IPC, RPC, MessagePort, UtilityProcess, BrowserWindow code
> - adding/moving a service across processes
> - spawn/kill/restart of any process
> - renderer ↔ backend connection logic
> - anything mentioning `ConnectionOrchestrator`, `participant`, `channel`
> - user request describes "process X talks directly to process Y" patterns
>
> *Agent runtime (agent-runtime-guard):*
> - new/modified `RuntimeEvent` type or field
> - new runtime adapter (pi-ai / pi-cli / langgraph / ai-sdk / mastra / custom)
> - new tool / extension / hook / trace plumbing
> - workflow / pattern / DSL design

>
> **Hard red lines** (never write these in business code):
>
> *Topology:*
> ```
> ipcMain.{handle,on}    ipcRenderer.{invoke,send,on}
> webContents.{postMessage,send}    utilityProcess.postMessage
> parentPort.postMessage  // only PageletBootstrap may use it once
> ```
> All cross-process calls go through `ConnectionOrchestrator` + RPC service host/client.
>
> *Agent runtime:*
> ```

> runtime.run(input)  in main / daemon / shared      // runtime only lives in pagelet
> type Event = PiJsonLine | LangGraphNodeEvent       // framework types stay in adapters
> await traceSink.push(ev)  blocking model stream    // I-002 deadlock pattern
> ```
> See each guard's §2 for the full red-line catalogue.

---

Electron + React + Vite desktop app, organized as a pnpm monorepo. Built **from zero** in the
2026-05-08 rewrite (see `codebase-wiki/roadmap/20260508-from-zero-design-only-electron-app-plan.md`).
Two cooperating Electron-runtime apps live under `apps/`:

- **`apps/telegraph`** — the main process + preload + renderer (the actual desktop app).
- **`apps/design`** — a utility process hosting the design pagelet's services, plus its
  React UI surface (rendered inside telegraph's renderer bundle).



## Skill placement

Project-related skills live in `skills/` (not `.agents/skills/`, which is reserved for generic / tool-provided skills).

| Skill type | Location | Rule |
|------------|----------|------|
| **Conventions** (coding rules, style) | `skills/telegraph-conventions/SKILL.md` | Start as a section there; split out only if > ~30 lines or needs assets |
| **Workflows** (multi-step procedures) | `skills/<workflow-name>/SKILL.md` | Always its own folder — e.g. `skills/add-pagelet/` |

When creating a new project skill, add it under `skills/` and update `skills/README.md`.

---

## Workspace layout

```
/
├── apps/
│   ├── telegraph/                                 # main app — Electron entry + renderer host
│   │   ├── src/
│   │   │   ├── application/
│   │   │   │   ├── main.ts                        # main-process entry (Electron app boot)
│   │   │   │   ├── telegraph-application.ts       # high-level lifecycle (start/stop)
│   │   │   │   ├── telegraph-application-module.ts# DI registry composition
│   │   │   │   └── preload/preload.ts             # context-bridge → window.telegraph.ipc
│   │   │   ├── core/
│   │   │   │   └── log/LogService.ts              # process-wide log → /tmp/telegraph-main.log
│   │   │   ├── services/
│   │   │   │   ├── connection-orchestrator/       # x-oasis ConnectionOrchestrator wiring
│   │   │   │   │   ├── common/                    # cross-process types & cp config (DESIGN_PARTICIPANT_ID, IDesignService, …)
│   │   │   │   │   ├── electron-main/             # AppOrchestrator, MainCpServer, OrchestratorInspectorService, DesignPageletProcess
│   │   │   │   │   ├── browser/                   # renderer cp client + inspector proxy + directChannelClient factory
│   │   │   │   │   └── node/                      # UtilityCpClient (consumed by utility processes)
│   │   │   │   └── window-manager/electron-main/  # WindowManager (BrowserWindow lifecycle)
│   │   │   ├── index.tsx                          # renderer entry — mounts <DesignPanel />
│   │   │   └── types.d.ts                         # ambient renderer globals (window.telegraph)
│   │   ├── index.html                             # vite renderer root
│   │   ├── forge.config.ts                        # electron-forge VitePlugin config (3 build entries: main, preload, design)
│   │   ├── vite.main.config.ts                    # main-process bundle (cjs into .vite/build/index.js)
│   │   ├── vite.preload.config.ts                 # preload bundle
│   │   ├── vite.design.config.ts                  # design utility-process bundle (cross-app entry: ../design/src/main.ts)
│   │   ├── vite.renderer.config.ts                # renderer dev server + bundle
│   │   ├── tsconfig.json
│   │   └── package.json                           # electron + react + x-oasis deps; start/package/make/dev/lint/typecheck/test
│   │
│   ├── design/                                    # design pagelet — utility process + React surface
│   │   ├── src/
│   │   │   ├── main.ts                            # utility-process entry (electron-forge spawns this via vite.design.config.ts)
│   │   │   ├── application/
│   │   │   │   ├── node/                          # DesignApplication (the IDesignService impl), DesignBootstrap (wires UtilityCpClient + serviceHost), DI module
│   │   │   │   └── browser/                       # DesignPanel (sidebar nav) + DesignEntry + DesignWorkspace + connections/ConnectionsTab
│   │   │   └── services/                          # design-internal services (placeholder — Phase 5+)
│   │   ├── tsconfig.json                          # paths: @/apps/design/*, @/packages/{ui,services/pagelet-host,services/main-metrics}/*; include limited
│   │   └── package.json                           # x-oasis + react devDeps; typecheck/lint/test only (built by telegraph's forge config)
│   │
├── packages/
│   ├── agent-protocol/                            # @/packages/agent-protocol — AgentEvent / RuntimeEvent / run / tool / extension protocol types
│   ├── agent/                                     # @/packages/agent — harness, runtime adapters, tool/trace implementation kit
│   └── ui/                                        # @/packages/ui — shared UI component library (React + Tailwind, shadcn-based, no Electron imports)
│
├── codebase-wiki/                                 # design + decision archive
│   ├── roadmap/                                   # active + archived plans (from-zero plan is the active one)
│   ├── discussion/                                # decisions like D-006 x-oasis capability gaps
│   └── reference/                                 # R-001 x-oasis link-to-source setup, etc.
│
├── package.json                                   # workspace root (proxy scripts only)
├── pnpm-workspace.yaml                            # apps/* + packages/*
└── AGENTS.md                                      # this file
```

## Multi-Page (DI)

Keep Alive + DI

## Path aliases

**Rule: `@` = monorepo root. All cross-module imports use `@/<filesystem-path-without-src>`.**

The `@` prefix points to the project root directory. Import paths mirror the filesystem
structure, with the `src/` segment elided via tsconfig `paths` / vite `resolve.alias` mapping.
This makes imports self-documenting — you can always locate a module by its import path.

| Alias pattern                         | Resolves to (filesystem)                          | Example import                                                      |
|---------------------------------------|---------------------------------------------------|---------------------------------------------------------------------|
| `@/apps/<app>/*`                      | `apps/<app>/src/*`                                | `import { X } from '@/apps/daemon/application/common'`             |
| `@/packages/ui/*`                     | `packages/ui/src/*`                               | `import { cn } from '@/packages/ui/lib/utils'`                     |
| `@/packages/stores`                   | `packages/stores/src/index.ts`                    | `import { useSessionsStore } from '@/packages/stores'`             |
| `@/packages/stores/*`                 | `packages/stores/src/*`                           | `import type { X } from '@/packages/stores/types'`                 |
| `@/packages/agent-protocol`           | `packages/agent-protocol/src/index.ts`            | `import type { AgentEvent } from '@/packages/agent-protocol'`     |
| `@/packages/agent-protocol/*`         | `packages/agent-protocol/src/*`                   | `import { X } from '@/packages/agent-protocol/events'`            |
| `@/packages/agent/*`                  | `packages/agent/src/*`                            | `import { PiAiRuntime } from '@/packages/agent/runtime/PiAiRuntime'` |
| `@/packages/services/pagelet-host/*`  | `packages/services/src/pagelet-host/src/*`        | `import { PageletWorker } from '@/packages/services/pagelet-host/node/PageletWorker'` |
| `@/packages/services/main-metrics/*`  | `packages/services/src/main-metrics/src/*`        | `import { X } from '@/packages/services/main-metrics/common'`      |
| `@/packages/services/process/*`       | `packages/services/src/process/src/*`             | `import { X } from '@/packages/services/process/common'`           |

### Convention (MUST follow)

1. **Always use `@/` prefix** for any import that crosses a directory boundary (different app or package).
   Never use `@telegraph/` — that prefix is removed from the codebase.
2. **The import path mirrors the monorepo root structure**, minus the `src/` segment.
   - `@/apps/main/application/browser/App` → file at `apps/main/src/application/browser/App.tsx`
   - `@/packages/ui/lib/utils` → file at `packages/ui/src/lib/utils.ts`
3. **Self-referencing imports within a package** also use `@/packages/<self>/...`.
   E.g. inside `packages/agent/`: `import { X } from '@/packages/agent/types'`.
4. **Bare imports** (no sub-path) for packages with a barrel `index.ts`:
   - `@/packages/stores` → `packages/stores/src/index.ts`
   - `@/packages/agent-protocol` → `packages/agent-protocol/src/index.ts`
5. **Never introduce a new alias prefix** (no `@foo/`, `@bar/`, etc.). `@/` is the sole alias.

### Where each alias is configured

| File                                              | Aliases declared                                                                  |
|---------------------------------------------------|-----------------------------------------------------------------------------------|
| `apps/main/tsconfig.json`                         | `@/apps/{main,design,connection,daemon,shared,monitor,setting,chat}/*`, `@/packages/{ui,stores,agent-protocol,agent,services/pagelet-host,services/main-metrics,services/process}/*` |
| `apps/design/tsconfig.json`                       | `@/apps/design/*` (self), `@/apps/{main,daemon,shared}/*`, `@/packages/{ui,services/pagelet-host,services/main-metrics}/*` |
| `apps/shared/tsconfig.json`                       | `@/apps/shared/*` (self), `@/apps/main/*`, `@/packages/services/{pagelet-host,main-metrics}/*` |
| `apps/daemon/tsconfig.json`                       | `@/apps/daemon/*` (self), `@/apps/main/*`, `@/packages/services/{pagelet-host,main-metrics,process}/*` |
| `apps/setting/tsconfig.json`                      | `@/apps/setting/*` (self), `@/apps/{main,daemon,shared}/*`, `@/packages/{ui,services/pagelet-host,services/main-metrics}/*` |
| `apps/monitor/tsconfig.json`                      | `@/apps/monitor/*` (self), `@/apps/{main,daemon}/*`, `@/packages/{ui,services/pagelet-host,services/main-metrics}/*` |
| `apps/connection/tsconfig.json`                   | `@/apps/connection/*` (self), `@/apps/{main,daemon,shared}/*`, `@/packages/{ui,services/{pagelet-host,main-metrics,process}}/*` |
| `apps/chat/tsconfig.json`                         | `@/apps/chat/*` (self), `@/apps/{main,daemon}/*`, `@/packages/{ui,stores,agent-protocol,agent,services/pagelet-host,services/main-metrics}/*` |
| `packages/ui/tsconfig.json`                       | `@/packages/ui/*` (self) |
| `packages/services/tsconfig.json`                 | `@/packages/services/*` (self + sub-services), `@/apps/{main,daemon}/*` |
| `packages/agent/tsconfig.json`                    | `@/packages/agent/*` (self), `@/packages/agent-protocol/*` |
| `packages/stores/tsconfig.json`                   | `@/packages/stores/*` (self) |
| `packages/agent-protocol/tsconfig.json`           | `@/packages/agent-protocol/*` (self) |
| `apps/main/vite.*.config.ts`                      | Mirror tsconfig aliases as `resolve.alias` entries (key = `@/apps/X`, value = `resolve(__dirname, '<rel-path-to-src>')`) |

## Running and building

All commands work from the repo root and proxy via pnpm filters:

- `pnpm start` → `pnpm --filter telegraph start` (electron-forge dev — must run in a TTY,
  forge dies under nohup; vite dev server hosts the renderer, forge spawns main + design utility)
- `pnpm dev` → vite renderer dev server only (no Electron — useful for purely-UI iteration)
- `pnpm package` / `pnpm make` → electron-forge package / make
- `pnpm -r lint` / `pnpm -r typecheck` / `pnpm -r test` → workspace-wide gates

Per-app scripts available inside `apps/telegraph/` and `apps/design/`.

## Quality gates

- **TypeScript strict** + ESLint 9 flat config (typescript-eslint strict-type-checked) +
  vitest 2.1.x workspace.
- LSP in IDEs sometimes shows stale errors;
  the source of truth is `pnpm -r typecheck`. If that's green, the IDE is wrong.
- vitest is pinned to `2.x` because vitest 4 is incompatible with vite 5 in this project.

## Logging surfaces (debug)

- `/tmp/telegraph-debug.log` — earliest main-process boot logs (appendFileSync at top of `main.ts`).
- `/tmp/telegraph-main.log` — main-process LogService stream.
- `/tmp/telegraph-design.log` — design utility-process logs.

forge swallows stdout when not attached to a TTY; tail the files above instead of relying on terminal output.

## Where to look for the design

- **Architecture Guard (AI-facing, topology dimension)** — `.agents/architecture-guard.md`.
  Decision tree + red-line catalogue + standard pushback scripts for **process / IPC** work.
  **Always check §1 triggers before non-trivial work.**
- **Agent Runtime Guard (AI-facing, agent protocol dimension)** — `.agents/agent-runtime-guard.md`.
  Red lines + triggers + reality-gap reminder for **RuntimeEvent / tool / extension / trace** work.
  Orthogonal to the architecture guard; both may apply simultaneously.
- **Agent Runtime Design Principles** — `.agents/agent-runtime-design.md`. 8 condensed principles
  from A-005, used during **design / review** of agent subsystems (not for daily coding).
- **Final architecture (authoritative)** — `codebase-wiki/architecture/20260509-telegraph-final-process-architecture.md`
  (A-008). Process roles, ConnectionOrchestrator + Forwarding Proxy contract, crash recovery flow,
  Inspector data model, target apps/* topology. Supersedes A-007.
- **Agent runtime theory** — `codebase-wiki/architecture/20260505-telegraph-agent-runtime-extension-host-theory.md`
  (A-005). Read §0 first for the from-zero reality gap, §15 for the boundary with A-008. Main body
  (§1–§14) is the long-term design theory.
- **Active plan** — `codebase-wiki/roadmap/20260508-from-zero-design-only-electron-app-plan.md`
  (Phase 0–5; check the Status header for the current phase).
- **x-oasis capability gaps** — `codebase-wiki/discussion/20260508-x-oasis-orchestrator-capability-gaps.md`
  (D-006). Phase 2.5 closed Gap 2 + Gap 3 upstream; Gap 1 is queued for Phase 6.
- **x-oasis link-to-source (archived)** — `codebase-wiki/reference/20260508-x-oasis-link-to-source-setup.md` (R-001, no longer used).
