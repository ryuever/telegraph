---
name: telegraph-conventions
description: Project-local conventions for the Telegraph monorepo (Electron + React + Vite, pnpm workspace). Load when writing or modifying code anywhere under `apps/telegraph/` or `packages/ui/`. Covers import paths, the renderer/main process boundary, hash routing, and other rules that the codebase enforces by convention rather than by tooling.
---

# Telegraph conventions

Rules that apply to every change in this repo. Each entry is structured as **Rule → Why → How to apply** so you can judge edge cases instead of blindly pattern-matching.

`AGENTS.md` at the repo root is the high-level architecture doc — read it once for context. This file is the operational checklist agents follow while writing code.

---

## Imports

### Use the `@telegraph/*` aliases — never reach across packages with relative paths

**Rule.** Inside a workspace package (e.g. `packages/ui/`), import other files of the *same* package via the package's own alias:

```ts
// ✅ correct
import { cn } from '@telegraph/ui/lib/utils'
import { Toolbar } from '@telegraph/ui/components/Toolbar'

// ❌ wrong — even though it resolves
import { cn } from '../../lib/utils'
import { Toolbar } from '../Toolbar'
```

The same applies to cross-package imports — always use the alias, never `../../packages/ui/src/...`.

**Why.** Three reasons, in order of importance:

1. **Refactor safety.** Aliases are stable across moves and renames; relative chains break silently when a file is reorganized.
2. **Public-API discipline.** The package's `exports` map in `packages/ui/package.json` defines what's importable. Going through the alias forces you to use that public surface; relative imports let you bypass it and create hidden coupling that breaks when the package is consumed externally.
3. **Consistency across builds.** The Vite renderer config, the TS path map, and pnpm's symlink resolution all agree on the alias. Relative imports from inside the package work in dev but can resolve to a different file in a packaged Electron build.

**How to apply.**

- Look up the right alias in `AGENTS.md` → "Path aliases" before writing the import.
- The aliases:
  - `@telegraph/ui/*` → `packages/ui/src/*` (renderer view layer)
  - `@telegraph/application/*`, `@telegraph/core/*`, `@telegraph/services/*` → `apps/telegraph/src/{application,core,services}/*`
  - `@/*` → `apps/telegraph/src/*` (the shadcn idiom — used inside `apps/telegraph` only)
- Inside `packages/ui/src/components/foo/Foo.tsx`, importing a sibling file `Bar.tsx` from the same `foo/` directory **may** use a relative path (`./Bar`) — the rule only applies once you cross a top-level boundary like `lib/`, `components/`, or `hooks/`.
- If you need a new entry on the package's public surface, extend the `exports` map in `packages/ui/package.json` (e.g. add `"./hooks/*": "./src/hooks/*.ts"`). Don't bypass it.

### `packages/ui/` must never import from Electron, Node built-ins, or `apps/telegraph/src/{application,core,services}/electron-main`

**Rule.** Code under `packages/ui/` is renderer-only. It can import:

- Other files in `@telegraph/ui/*`
- Pure types/constants from `@telegraph/services/*/common` (the `common/` subdirectory is the cross-process contract surface)
- The preload bridge via `window.telegraph` (typed in `apps/telegraph/src/types.d.ts`)

It must NOT import: `electron`, Node built-ins (`fs`, `path`, `child_process`), or anything from `*/electron-main/` or `*/node/` subdirectories.

**Why.** The Vite renderer config is the only build that bundles `packages/ui/`. The other Vite configs (main, preload, fork) deliberately don't alias it. Importing Electron or Node modules from the renderer either breaks the bundle or pulls main-process code into the browser — both are silent failures that surface as runtime crashes.

**How to apply.** Need data from a service? Define the shape in `apps/telegraph/src/services/<svc>/common/types.ts`, then call into it via the preload bridge or the existing async-call-rpc channel.

---

## Renderer routing

### Hash routes must subscribe to `hashchange` — don't compute the route at module load

**Rule.** The renderer entry (`apps/telegraph/src/index.tsx`) uses URL hash routing. Any router must re-render on `hashchange`:

```tsx
// ✅ correct
function useHashRoute() {
  const [hash, setHash] = React.useState(() => window.location.hash)
  React.useEffect(() => {
    const onChange = () => setHash(window.location.hash)
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

function Root() {
  const hash = useHashRoute()
  if (hash.includes('/monitor')) return <MonitorPanel />
  if (hash.includes('/chat')) return <ChatPanel />
  return <App />
}
```

**Why.** A naive `pickRoot()` that reads `window.location.hash` once at module load freezes the route at the initial value. Clicking an `<a href="#/chat">` link updates the URL but leaves the React tree unchanged — looks like the link is broken.

**How to apply.** When adding a new route, just add another branch inside `<Root>`. If you ever need richer routing (params, history, nested routes), pull in a real router rather than growing the hash matcher into something fragile.

---

## UI package

### New renderer views go under `packages/ui/src/components/<feature>/`

**Rule.** A new feature panel is a folder under `packages/ui/src/components/`, with a top-level `<Feature>Panel.tsx` as the entry, supporting components alongside it, and any feature-local hooks/types in the same folder.

Pattern (mirrors the existing `monitor/` and `chat/` folders):

```
packages/ui/src/components/<feature>/
├── <Feature>Panel.tsx       # top-level layout, the thing the renderer mounts
├── <Feature><Sub>.tsx       # supporting components (sidebar, list, item, …)
├── use-<feature>.ts         # state hook(s) — kebab-case filename
├── types.ts                 # feature-local types
└── (service.ts, etc.)       # pluggable backends if needed
```

**Why.** Co-locating everything per feature keeps the package's top-level `components/` directory scannable and makes a feature easy to delete or extract. The `<Feature>Panel.tsx` naming makes the renderer entry obvious to anyone wiring up a new route.

**How to apply.**

- Mount the new panel from `apps/telegraph/src/index.tsx` via a hash route (see the routing rule above).
- If the feature talks to a backend (an AI agent, an RPC service, etc.), define the contract as a TypeScript `interface` in `types.ts` and ship a mock implementation in the same folder so the UI works standalone.
- Reusable shadcn primitives belong in `packages/ui/src/components/ui/`, not in the feature folder. Use `pnpm dlx shadcn add <component>` from `apps/telegraph/` to install them in the right place.

---

## Adding a new convention to this skill

When you add an entry below, follow the same shape:

1. **Rule.** One sentence stating the rule. Include a code snippet showing ✅ correct vs ❌ wrong if the rule is about syntax.
2. **Why.** The reasoning — usually a past incident, a hidden constraint, or a tooling quirk. Without this, future readers can't judge edge cases.
3. **How to apply.** Concrete steps: where to look, what to change, what the exceptions are.

Group related rules under a top-level `## Section` heading. Keep entries terse — if a rule needs more than ~30 lines, split it into its own skill folder.
