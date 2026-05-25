---
name: design-shadcn-generation
description: Generate standalone Design Page React artifacts with shadcn/ui-first component usage, local source vendoring, and theme-token discipline.
---

# Design shadcn Generation

Use this skill when producing or reviewing Design Page standalone React projects.

## Rule

Generated apps are shadcn/ui-first. Use shadcn registry primitives or blocks whenever they cover the requested UI. Handwrite components only for app-specific composition that shadcn does not provide.

## Standalone Project Requirements

- Do not import Telegraph workspace UI modules such as `@/packages/ui/...` in generated Sandpacker projects.
- Vendor shadcn source into the generated project, for example `src/components/ui/button.tsx`, `src/components/ui/card.tsx`, and `src/lib/utils.ts`.
- If generated source imports `@/components/ui/button`, also provide `vite.config.ts` and `tsconfig.json` alias config that maps `@` to `src`.
- Add Tailwind Play CDN to generated `index.html`: `<script src="https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4"></script>`. Put custom Tailwind theme CSS in `<style type="text/tailwindcss">` when needed.
- Include `components.json` with shadcn-compatible aliases and `tailwind.cssVariables: true`.
- Declare every shadcn dependency in `package.json`, including Radix packages, `class-variance-authority`, `clsx`, `tailwind-merge`, `lucide-react`, and animation helpers when used.
- Put application-specific compositions under `src/components/app/` or the page file. Do not fake shadcn primitives by writing simplified `Button`, `Card`, `Dialog`, or `Tabs` files unless the registry item is unavailable and a fallback reason is recorded.

## React Hooks Requirements

- Call React hooks only inside React function components or custom hooks.
- Never call `useState`, `useEffect`, `useMemo`, `useCallback`, `useContext`, or `useRef` at module scope.
- Never call hooks inside conditions, loops, event handlers, callbacks, or ordinary helper functions.
- Keep stateful data and state-changing handlers inside the component or custom hook that owns the rendered interaction.
- Name custom hooks with the `use` prefix, for example `useTodos` or `useDashboardFilters`.

## Component Retrieval

Before code generation, prefer evidence from shadcn registry search, docs, or provided materialized registry items. A good retrieval result names:

- component or block name
- registry source
- files to vendor
- dependencies
- reason it matches the brief
- fallback reason if no shadcn component fits

## Theme Requirements

- Use semantic CSS variables such as `--background`, `--foreground`, `--primary`, `--border`, `--radius`, and shadcn token classes like `bg-background`, `text-foreground`, `border-border`.
- Keep raw hex colors out of JSX and component files unless they are inside the theme token definition.
- Use lucide icons for ordinary interface actions when an icon is needed.
- Keep component radius, density, and typography consistent with the selected style pack.

## Review Checklist

- Every `@/components/ui/*` import resolves to a local generated file.
- Every vendored shadcn file has its helper dependencies and `src/lib/utils.ts`.
- The page composes shadcn primitives rather than replacing them with handwritten primitives.
- Theme tokens exist and are used by the visible UI.
- Fallback handwritten components are narrow, app-specific, and justified.
