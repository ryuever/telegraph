# speedy

Electron + React + Vite desktop app. The repo is split between **process code** (`app/`) and **UI code** (`ui/`) so that the renderer's view layer can evolve independently from main/preload/services.

## Top-level layout

- `app/` — all Electron-process source.
  - `app/application/` — main-process bootstrap, windows, menu-bar, lifecycle.
  - `app/services/` — long-running services exposed over RPC (e.g. `monitor/`).
  - `app/core/`, `app/common/` — shared infra and types reachable from any process.
  - `app/index.tsx` — renderer entry mounted by `index.html` (`/app/index.tsx`). Picks a root component from the URL hash and renders into `#root`.
  - `app/types.d.ts` — ambient renderer globals (e.g. `window.redcity` preload bridge).
- `ui/` — renderer view layer. Pure React, no Electron imports.
  - `ui/styles/` — global CSS (Tailwind entry in `globals.css`).
  - `ui/components/` — feature components.
    - `ui/components/Toolbar.tsx` — chrome-less window drag bar shared by every renderer view.
    - `ui/components/monitor/` — Activity-Monitor-style panel (`MonitorPanel`, `ProcessesTable`, `PsTreePanel`, `Sparkline`, `hooks`). Talks to the daemon via `@app/services/monitor` types over the RPC bridge.
    - `ui/components/ui/` — shadcn-style primitives (`button`, `card`, `badge`, `input`, `table`, `tabs`).
  - `ui/lib/utils.ts` — renderer-only helpers (`cn`, etc.).

## Why the split

Keeping the renderer view in `ui/` makes it obvious that:

1. Files under `ui/` must never `import` from Electron, Node built-ins, or main-process services directly — only types from `@app/services/*/common` and the preload bridge.
2. The Vite renderer config is the only build that needs `ui/`. `vite.main.config.ts`, `vite.preload.config.ts`, and `vite.fork.config.ts` deliberately do not alias it.
3. Adding a new renderer view means adding a folder under `ui/components/` and routing to it from `app/index.tsx` — no churn in `app/`.

## Path aliases

Configured in `tsconfig.json` and `vite.renderer.config.ts`:

- `@app/*` → `app/*` (any process)
- `@common/*` → `app/common/*` (cross-process shared)
- `@ui/*` → `ui/*` (renderer only)

Always import view code via `@ui/...` rather than relative `../../ui/...` paths.
