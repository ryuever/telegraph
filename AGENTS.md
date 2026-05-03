# telegraph

Electron + React + Vite desktop app, organized as a pnpm monorepo modeled after the [shadcn vite-monorepo](https://ui.shadcn.com/docs/monorepo) template. Process code (main/preload/services) lives in `apps/telegraph/src/`; the renderer view layer lives in `packages/ui/` (workspace package `@telegraph/ui`) so the UI can evolve independently and `npx shadcn add` works out of the box.

## Workspace layout

```
/
├── apps/
│   └── telegraph/                          # the Electron app (npm name: telegraph)
│       ├── src/
│       │   ├── application/                # main-process bootstrap, windows, menu, lifecycle
│       │   ├── core/                       # shared infra reachable from any process
│       │   ├── services/                   # long-running services exposed over RPC (e.g. monitor/)
│       │   ├── index.tsx                   # renderer entry mounted by index.html
│       │   └── types.d.ts                  # ambient renderer globals (window.telegraph bridge)
│       ├── index.html                      # vite root; <script src="/src/index.tsx">
│       ├── components.json                 # shadcn CLI config (app side)
│       ├── vite.{main,preload,fork,renderer}.config.ts
│       ├── forge.config.ts
│       ├── tsconfig.json
│       └── package.json                    # electron deps + start/package/make/dev/lint scripts
├── packages/
│   └── ui/                                 # workspace package @telegraph/ui (shadcn-style)
│       ├── src/
│       │   ├── components/
│       │   │   ├── Toolbar.tsx             # chrome-less window drag bar
│       │   │   ├── monitor/                # Activity-Monitor-style panel
│       │   │   │   ├── MonitorPanel.tsx
│       │   │   │   ├── ProcessesTable.tsx
│       │   │   │   ├── PsTreePanel.tsx
│       │   │   │   ├── Sparkline.tsx
│       │   │   │   └── hooks.ts
│       │   │   └── ui/                     # shadcn-style primitives (button, card, …)
│       │   ├── lib/utils.ts                # renderer-only helpers (cn, etc.)
│       │   └── styles/globals.css          # tailwind entry + @source globs
│       ├── components.json                 # shadcn CLI config (package side)
│       ├── tsconfig.json
│       └── package.json                    # exports map: ./globals.css, ./components/*, ./lib/*, ./hooks/*
├── package.json                            # workspace root (proxy scripts only)
├── pnpm-workspace.yaml                     # apps/* + packages/* + x-oasis link overrides
└── AGENTS.md
```

## Why the split

- Files under `packages/ui/` must never `import` from Electron, Node built-ins, or main-process services directly — only types/constants from `@telegraph/services/*/common` and the preload bridge.
- The Vite renderer config is the only build that needs `packages/ui/`. `vite.{main,preload,fork}.config.ts` deliberately do not alias it.
- Adding a new renderer view means adding a folder under `packages/ui/src/components/` and routing to it from `apps/telegraph/src/index.tsx` — no churn in the Electron-process tree.
- The package follows shadcn's exports-map convention (`./components/*: ./src/components/*.tsx`) so `npx shadcn add button` writes to the package and the app picks it up via the workspace symlink.

## Path aliases

| Alias                            | Resolves to                                  | Used by                                                                 |
|----------------------------------|----------------------------------------------|-------------------------------------------------------------------------|
| `@/*`                            | `apps/telegraph/src/*`                       | Renderer-only code that wants the shadcn idiom (e.g. `@/components/...`)|
| `@telegraph/application/*`       | `apps/telegraph/src/application/*`           | All `apps/telegraph` source; cross-imports from `packages/ui`           |
| `@telegraph/core/*`              | `apps/telegraph/src/core/*`                  | Same as above                                                           |
| `@telegraph/services/*`          | `apps/telegraph/src/services/*`              | Same as above                                                           |
| `@telegraph/ui/*`                | `packages/ui/src/*` (workspace + exports map)| App imports of UI, e.g. `@telegraph/ui/components/Toolbar`              |

The three `@telegraph/{application,core,services}/*` subroots are explicit (not a single `@telegraph/*` wildcard) so they don't collide with the `@telegraph/ui` workspace package.

### Where each alias is configured

| File                                       | Aliases declared                                                                           |
|--------------------------------------------|--------------------------------------------------------------------------------------------|
| `apps/telegraph/tsconfig.json`             | `@/*`, `@telegraph/{application,core,services}/*`, `@telegraph/ui/*`                       |
| `packages/ui/tsconfig.json`                | `@telegraph/ui/*` (self-reference), `@telegraph/{application,core,services}/*` (cross-pkg) |
| `apps/telegraph/vite.{main,preload,fork}.config.ts` | `@telegraph/{application,core,services}` (no UI in these processes)               |
| `apps/telegraph/vite.renderer.config.ts`   | `@`, `@telegraph/{application,core,services}` (NO `@telegraph/ui` — see below)             |

**Important — vite alias for the workspace package**: `@telegraph/ui` is intentionally *not* a vite alias. pnpm symlinks it into `apps/telegraph/node_modules/@telegraph/ui`, and the package's `exports` map handles all sub-path resolution (`@telegraph/ui/components/Toolbar` → `./src/components/Toolbar.tsx`). This matches the shadcn vite-monorepo reference and lets node-style consumers (electron-forge, esbuild, vite SSR) resolve the package the same way as the renderer build.

## shadcn integration

Both `apps/telegraph/components.json` and `packages/ui/components.json` are present so the shadcn CLI works at either level:

- `pnpm dlx shadcn add button` from `apps/telegraph/` writes into `packages/ui/src/components/` (because the app's `components.json` has `aliases.ui: "@telegraph/ui/components"`).
- `pnpm dlx shadcn add button` from `packages/ui/` does the same directly.

The package-side `components.json` references `src/styles/globals.css` for tailwind tokens; the app-side points to the package's globals.css via relative path. Tailwind v4's `@source` globs in `packages/ui/src/styles/globals.css` make sure the CSS scans both `apps/**/*.{ts,tsx}` and the package itself, so utility-class detection works regardless of which build is consuming it.

## Running and building

All commands work from the repo root and proxy via pnpm filters:

- `pnpm start` → `pnpm --filter telegraph start` (electron-forge dev)
- `pnpm dev` → vite renderer only
- `pnpm package` / `pnpm make` → electron-forge package/make
- `pnpm lint` → `pnpm -r lint`

Or run them inside `apps/telegraph/` directly with the same script names.

## Cross-package coupling (follow-up)

`packages/ui/src/components/monitor/*` imports `@telegraph/services/monitor/common/*` (types and a runtime channel constant). This dependency direction (package → app) is resolved at consumer build time via the renderer's vite alias and works today. The cleaner long-term split is to extract `services/monitor/common/*` into a shared `packages/contracts/` package; left as future work.
