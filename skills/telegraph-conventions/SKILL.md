---
name: telegraph-conventions
description: Project-local conventions for the Telegraph monorepo (Electron + React + Vite, pnpm workspace). Load when writing or modifying code anywhere under `apps/telegraph/` or `packages/ui/`. Covers import paths, the renderer/main process boundary, hash routing, and other rules that the codebase enforces by convention rather than by tooling.
---

# Telegraph conventions

Rules that apply to every change in this repo. Each entry is structured as **Rule → Why → How to apply** so you can judge edge cases instead of blindly pattern-matching.

`AGENTS.md` at the repo root is the high-level architecture doc — read it once for context. This file is the operational checklist agents follow while writing code.

---

## Imports

### Use the `@/` aliases — never reach across packages with relative paths

**Rule.** Inside a workspace package (e.g. `packages/ui/`), import other files of the *same* package via the package's own alias:

```ts
// ✅ correct
import { cn } from '@/packages/ui/lib/utils'
import { Toolbar } from '@/packages/ui/components/Toolbar'

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
- The aliases (all use `@/` prefix, `@` = monorepo root, `src/` is elided):
  - `@/apps/<app>/*` → `apps/<app>/src/*` (e.g. `@/apps/main/…`, `@/apps/design/…`)
  - `@/packages/ui/*` → `packages/ui/src/*` (renderer view layer)
  - `@/packages/stores` → `packages/stores/src/index.ts` (barrel import)
  - `@/packages/agent-protocol` → `packages/agent-protocol/src/index.ts` (barrel import)
  - `@/packages/agent/*` → `packages/agent/src/*`
  - `@/packages/services/pagelet-host/*` → `packages/services/src/pagelet-host/src/*`
  - `@/packages/services/main-metrics/*` → `packages/services/src/main-metrics/src/*`
- **Never use `@telegraph/`** — that prefix has been removed from the codebase.
- Inside `packages/ui/src/components/foo/Foo.tsx`, importing a sibling file `Bar.tsx` from the same `foo/` directory **may** use a relative path (`./Bar`) — the rule only applies once you cross a top-level boundary like `lib/`, `components/`, or `hooks/`.
- If you need a new entry on the package's public surface, extend the `exports` map in `packages/ui/package.json` (e.g. add `"./hooks/*": "./src/hooks/*.ts"`). Don't bypass it.

### `packages/ui/` must never import from Electron, Node built-ins, or `apps/telegraph/src/{application,core,services}/electron-main`

**Rule.** Code under `packages/ui/` is renderer-only. It can import:

- Other files in `@/packages/ui/*`
- Pure types/constants from `@/packages/services/*/common` (the `common/` subdirectory is the cross-process contract surface)
- The preload bridge via `window.telegraph` (typed in `apps/telegraph/src/types.d.ts`)

It must NOT import: `electron`, Node built-ins (`fs`, `path`, `child_process`), or anything from `*/electron-main/` or `*/node/` subdirectories.

**Why.** The Vite renderer config is the only build that bundles `packages/ui/`. The other Vite configs (main, preload, fork) deliberately don't alias it. Importing Electron or Node modules from the renderer either breaks the bundle or pulls main-process code into the browser — both are silent failures that surface as runtime crashes.

**How to apply.** Need data from a service? Define the shape in `apps/telegraph/src/services/<svc>/common/types.ts`, then call into it via the preload bridge or the existing async-call-rpc channel.

---

## DI tokens & cross-process contracts

### DI tokens (`createId`) and interfaces consumed outside the owning module must live in `common/`

**Rule.** Any symbol that is (a) a DI injection token created with `createId()`, or (b) a TypeScript `interface` that other processes / modules inject against, must be defined in the `common/` directory of the owning app or package — never inside `electron-main/`, `node/`, or `browser/`.

```ts
// ✅ correct — token + interface in common/
// apps/shared/src/application/common/index.ts
export interface ISharedApplication {
  start(): Promise<void>;
}
export const SharedApplicationId = createId('SharedApplication');

// ❌ wrong — token in implementation file
// apps/shared/src/application/node/SharedApplication.ts
export const SharedApplicationId = createId('SharedApplication');  // moved out
```

The implementation file re-exports from `common/` for backward compatibility only if needed; new consumers should import directly from `common/`.

**Why.** Three reasons:

1. **Dependency direction.** External consumers (e.g. `AppApplication` in `apps/main/`) should depend on the contract (`interface` + token), not on the concrete implementation class. Placing the token in `node/SharedApplication.ts` forces every consumer to import the implementation file, creating hidden coupling.
2. **Cross-process safety.** `common/` is the only subdirectory safe to import from any process role (main, browser, utility). Tokens in `electron-main/` or `node/` are invisible or illegal to import from the renderer or another utility process.
3. **Discoverability.** All injectable contracts in one place (`common/`) makes the app's public surface scannable. Scattering tokens across implementation files hides the dependency graph.

**How to apply.**

- When adding a new `createId()` call or a new injectable `interface`, place both in the owning module's `common/index.ts` (or `common/types.ts` if the module already splits them).
- The implementation class (`@injectable()`) stays in its process-specific directory (`electron-main/`, `node/`, `browser/`) and imports the token from `common/`.
- When refactoring an existing token out of an implementation file, also update all external import sites to point at `common/`. The implementation file may re-export for a transitional period.
- Constants and types that are *only* consumed internally (e.g. a private class-scoped helper) do not need to move — only symbols that cross the module boundary or are used by the DI container.

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

## TypeScript strictness

### Zero `any` — use proper types, generics, or `unknown`

**Rule.** Never write `any` in application or library code. If the type is genuinely unknown at write time, use `unknown` and narrow it; if it's a generic placeholder, write a proper generic parameter.

```ts
// ✅ correct
function parse<T>(raw: string, schema: ZodSchema<T>): T { … }
function handleEvent(event: unknown) {
  if (typeof event === 'object' && event !== null && 'type' in event) { … }
}

// ❌ wrong
function parse(raw: string): any { … }
function handleEvent(event: any) { … }
const data: any = response.body;
```

The only acceptable `any` is in third-party `.d.ts` declarations or `declare module` augmentation shims that you don't control — never in your own `.ts` / `.tsx` files.

**Why.** `any` silently disables the type checker: typos, missing fields, and contract drift all pass without error, turning compile-time guarantees into runtime surprises. In an Electron app with cross-process RPC, a single `any` at a serialization boundary can mask bugs that only appear in production when a field is missing or renamed.

**How to apply.**

- When tempted to write `any`, ask: "Do I not know the shape, or do I not want to spell it out?" If the former, use `unknown` + narrowing. If the latter, take the time to define the type.
- For JSON / API boundaries, define a Zod (or equivalent) schema and infer the type from it: `type MyData = z.infer<typeof mySchema>`.
- For overly broad library types, extend or narrow them with utility types (`Pick`, `Omit`, `Partial`, `Extract`) instead of casting to `any`.
- If a third-party type is wrong, use `// @ts-expect-error` with a comment explaining why — never `as any`.

### `pnpm -r typecheck` and `pnpm -r lint` must both pass with zero errors

**Rule.** Every code change must leave both `pnpm -r typecheck` and `pnpm -r lint` green (zero errors). These are the authoritative quality gates — not the IDE's LSP.

**Why.** `tsc --noEmit` catches structural type errors; ESLint with `strict-type-checked` catches semantic issues that tsc cannot (e.g. `no-unsafe-*`, `no-floating-promises`, `restrict-template-expressions`, `no-explicit-any`). Both must pass to guarantee the codebase is free of type-safety regressions. IDE language servers sometimes show stale errors; the CLI gates are deterministic.

**How to apply.**

- Run `pnpm -r typecheck && pnpm -r lint` after any non-trivial change and before considering the task done.
- If the IDE shows red squiggles but both gates pass, it's an LSP cache issue — restart the TS server in your IDE, don't "fix" phantom errors.
- Never suppress a real typecheck or lint error with `@ts-ignore`, `as any`, or `eslint-disable`. Fix the root cause. Use `@ts-expect-error` with a TODO comment only if a proper fix requires a larger refactor.
- Common ESLint fix patterns:
  - `no-explicit-any` / `no-unsafe-*` → define proper types or use `unknown` + narrowing
  - `restrict-template-expressions` → wrap numbers with `String(x)`
  - `no-floating-promises` → prefix with `void` or add `await`
  - `no-confusing-void-expression` → add braces: `() => { someFunc(); }`
  - `no-misused-promises` → wrap async handlers: `onClick={() => { void asyncFn(); }}`
  - `no-non-null-assertion` → use proper null guards instead of `!`
  - `no-empty` → add `// noop` or `// best effort` in catch blocks

---

## Adding a new convention to this skill

When you add an entry below, follow the same shape:

1. **Rule.** One sentence stating the rule. Include a code snippet showing ✅ correct vs ❌ wrong if the rule is about syntax.
2. **Why.** The reasoning — usually a past incident, a hidden constraint, or a tooling quirk. Without this, future readers can't judge edge cases.
3. **How to apply.** Concrete steps: where to look, what to change, what the exceptions are.

Group related rules under a top-level `## Section` heading. Keep entries terse — if a rule needs more than ~30 lines, split it into its own skill folder.
