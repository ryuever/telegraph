# telegraph

Electron + React + Vite desktop app, organized as a pnpm monorepo. Built **from zero** in the
2026-05-08 rewrite (see `codebase-wiki/roadmap/20260508-from-zero-design-only-electron-app-plan.md`).
Two cooperating Electron-runtime apps live under `apps/`:

- **`apps/telegraph`** — the main process + preload + renderer (the actual desktop app).
- **`apps/design`** — a utility process hosting the design pagelet's services, plus its
  React UI surface (rendered inside telegraph's renderer bundle).

The legacy codebase (port-manager based, ad-hoc MessagePort plumbing) is preserved in
`apps/_legacy/` for documentation purposes only — see `apps/_legacy/README.md`.

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
│   │   │   │   └── browser/                       # DesignPanel + connections/ConnectionsTab — react UI bundled into telegraph's renderer
│   │   │   └── services/                          # design-internal services (placeholder — Phase 5+)
│   │   ├── tsconfig.json                          # paths: @design/*, @telegraph/services/*, @telegraph/core/*; include limited
│   │   └── package.json                           # x-oasis + react devDeps; typecheck/lint/test only (built by telegraph's forge config)
│   │
│   └── _legacy/                                   # frozen previous codebase — DO NOT IMPORT (see _legacy/README.md)
│
├── packages/
│   └── runtime-contracts/                         # @telegraph/runtime-contracts — RunInput / RuntimeEvent / tool & extension types (kept across rewrite)
│
├── codebase-wiki/                                 # design + decision archive
│   ├── roadmap/                                   # active + archived plans (from-zero plan is the active one)
│   ├── discussion/                                # decisions like D-006 x-oasis capability gaps
│   └── reference/                                 # R-001 x-oasis link-to-source setup, etc.
│
├── package.json                                   # workspace root (proxy scripts only)
├── pnpm-workspace.yaml                            # apps/* + packages/*; excludes apps/_legacy/**; pnpm.overrides link x-oasis to source
└── AGENTS.md                                      # this file
```

## Process topology

```
┌─────────────────────────────────────────────────────────────────────┐
│ telegraph (main process)                                             │
│   ├─ AppOrchestrator (extends ElectronConnectionOrchestrator)        │
│   │     • registers main-side participants                           │
│   │     • drives connect()/handleParticipantLost lifecycle           │
│   ├─ OrchestratorInspectorService                                    │
│   │     • mounted on cp via MainCpServer (RPCServiceHost)            │
│   │     • exposes getTopology() / requestConnect() to the renderer   │
│   ├─ DesignPageletProcess                                            │
│   │     • spawns apps/design's main.ts as a utilityProcess           │
│   │     • registers it as participant 'pagelet:design'               │
│   └─ WindowManager → main BrowserWindow                              │
└──┬──────────────────────────────────────┬───────────────────────────┘
   │ IPCMainChannel ('orchestrator-cp')   │ ElectronUtilityProcessChannel
   ▼                                      ▼
┌──────────────────────────┐   ┌──────────────────────────────────────┐
│ renderer (telegraph)     │   │ design (utility process)              │
│   <DesignPanel />        │   │   DesignBootstrap                     │
│   <ConnectionsTab />     │   │     • UtilityCpClient (cp + service   │
│     • inspector proxy    │   │       host shared)                    │
│     • requestConnect →   │   │     • mounts DesignApplication on     │
│     • awaitDirect-       │   │       /services/design path           │
│       ChannelClient<     │   │     • on activate: bind MessagePort   │
│       IDesignService>    │   │       to ElectronMessagePortMain-     │
│     • ping(now) ──┐      │   │       Channel + serviceHost           │
└───────────────────┼──────┘   └───────▲──────────────────────────────┘
                    │                  │
                    └──────────────────┘
                  direct MessagePort channel
                  (RPCMessageChannel ↔ ElectronMessagePortMainChannel)
                  carries /services/design.ping() RPC
```

**Key invariants** (from-zero rewrite):
- Main is **not** a participant — only utilities + renderers are. The inspector lives on
  main's cp channel and proxies between the orchestrator and the renderer.
- The renderer is the participant `'renderer:main'`; its cp channel is created in main
  the moment the BrowserWindow is wired (single channel, multi-renderer supported via
  `acceptAllSenders: true`).
- Each utility participant exposes its business services via a single
  `RPCServiceHost`; the `UtilityCpClient` rebinds it onto every direct channel that
  the orchestrator activates (Phase 5+ multi-peer fan-out kept in mind via
  `directChannels: Map<symbol, channel>`).
- x-oasis is consumed via `pnpm.overrides` link-to-source (R-001). Its packages have
  stale dist for some types, so telegraph's `tsconfig.json` paths redirect each
  `@x-oasis/*` import to the package's `dist/.../index.d.ts`. Required: run
  `pnpm compile` (NOT `pnpm build`) inside x-oasis after editing source.

## Path aliases

| Alias                            | Resolves to                                    | Used by                                                                 |
|----------------------------------|------------------------------------------------|-------------------------------------------------------------------------|
| `@/*`                            | `apps/telegraph/src/*`                         | Renderer-only code (kept for shadcn idiom)                              |
| `@telegraph/application/*`       | `apps/telegraph/src/application/*`             | telegraph internal main-process imports                                 |
| `@telegraph/core/*`              | `apps/telegraph/src/core/*`                    | Cross-process (main + utility + renderer can all hit `core/log`)        |
| `@telegraph/services/*`          | `apps/telegraph/src/services/*`                | telegraph internal + cross-app (design imports `connection-orchestrator/{common,node}`) |
| `@design/*`                      | `apps/design/src/*`                            | telegraph renderer entry imports `@design/application/browser/DesignPanel`; design app self-reference |

The three `@telegraph/{application,core,services}/*` subroots are explicit prefixes (not a single
`@telegraph/*` wildcard) so the new design preserves the clean per-area dependency split.

### Where each alias is configured

| File                                              | Aliases declared                                                                  |
|---------------------------------------------------|-----------------------------------------------------------------------------------|
| `apps/telegraph/tsconfig.json`                    | `@/*`, `@telegraph/{application,core,services}/*`, `@design/*`, x-oasis dist redirects |
| `apps/design/tsconfig.json`                       | `@design/*` (self), `@telegraph/{services,core}/*`, x-oasis dist redirects        |
| `apps/telegraph/vite.main.config.ts`              | `@telegraph/{application,core,services}` (no design — main never touches React)   |
| `apps/telegraph/vite.preload.config.ts`           | minimal                                                                           |
| `apps/telegraph/vite.design.config.ts`            | `@telegraph/{application,core,services}` for cross-app entry                      |
| `apps/telegraph/vite.renderer.config.ts`          | `@`, `@telegraph/{application,core,services}`, **`@design`** (cross-app UI bundle) |

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
- LSP in IDEs sometimes shows stale errors pointing to legacy paths under `apps/_legacy/`;
  the source of truth is `pnpm -r typecheck`. If that's green, the IDE is wrong.
- vitest is pinned to `2.x` because vitest 4 is incompatible with vite 5 in this project.

## Logging surfaces (debug)

- `/tmp/telegraph-debug.log` — earliest main-process boot logs (appendFileSync at top of `main.ts`).
- `/tmp/telegraph-main.log` — main-process LogService stream.
- `/tmp/telegraph-design.log` — design utility-process logs.

forge swallows stdout when not attached to a TTY; tail the files above instead of relying on terminal output.

## Where to look for the design

- **Active plan** — `codebase-wiki/roadmap/20260508-from-zero-design-only-electron-app-plan.md`
  (Phase 0–5; check the Status header for the current phase).
- **x-oasis capability gaps** — `codebase-wiki/discussion/20260508-x-oasis-orchestrator-capability-gaps.md`
  (D-006). Phase 2.5 closed Gap 2 + Gap 3 upstream; Gap 1 is queued for Phase 6.
- **x-oasis link-to-source** — `codebase-wiki/reference/20260508-x-oasis-link-to-source-setup.md` (R-001).
- **Legacy code** — `apps/_legacy/README.md` (rules: do not import; treat as historical literature).
