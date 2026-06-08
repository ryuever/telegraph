import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Build the jiti alias map handed to ExtensionHost in chat / design pagelet
 * workers. This must mirror the `@/packages/*` aliases the host project
 * uses, because jiti — unlike vite — does not consult any pre-existing
 * alias registry: it only sees the map passed at `createJiti` time. Without
 * this map, an extension factory that imports e.g.
 * `@/packages/agent-extensions` fails activation with
 * `Cannot find module '@/packages/agent-extensions'`.
 *
 * Alias resolution semantics (verified against jiti's pathe-based
 * `resolveAlias`, see node_modules/jiti/dist/jiti.cjs):
 *   - Prefix-based with path-segment boundary. `@/packages/agent` matches
 *     `@/packages/agent/runtime/foo` but NOT `@/packages/agent-protocol`
 *     (the next character must be `/` or end-of-string).
 *   - Longest-match-first when multiple aliases share a prefix.
 *
 * That lets us map both bare specifiers (`@/packages/agent-protocol`) and
 * sub-path specifiers (`@/packages/agent/runtime/X`) by pointing each alias
 * key at the package's `src/` directory and letting jiti's module
 * resolution find `index.ts` for the bare case and `<sub>.ts` for the
 * sub-path case.
 *
 * Resolving the monorepo root: this file is bundled into
 * `apps/main/.vite/preload/<chunk>.js` by forge's vite plugin, so at
 * runtime `__dirname` points there. Going up four segments
 * (preload → .vite → main → apps → ROOT) yields the monorepo root. We
 * sanity-check the result against `pnpm-workspace.yaml` to fail loudly if
 * the forge output layout ever changes.
 */
export function buildExtensionAliasMap(): Record<string, string> {
  const monorepoRoot = resolveMonorepoRoot();
  const pkgSrc = (name: string): string => resolve(monorepoRoot, 'packages', name, 'src');
  return {
    '@/packages/agent-protocol': pkgSrc('agent-protocol'),
    '@/packages/agent-capabilities': pkgSrc('agent-capabilities'),
    '@/packages/agent-extensions': pkgSrc('agent-extensions'),
    '@/packages/agent-resources': pkgSrc('agent-resources'),
    '@/packages/computer-use-protocol': pkgSrc('computer-use-protocol'),
    '@/packages/computer-use': pkgSrc('computer-use'),
    '@/packages/orchestrator-core': pkgSrc('orchestrator-core'),
    // `@/packages/agent` is the broadest prefix — must come last in source
    // order for human readability, but jiti sorts by segment count at
    // resolveAlias time so order here is purely cosmetic.
    '@/packages/agent': pkgSrc('agent'),
  };
}

function resolveMonorepoRoot(): string {
  // Walk up from __dirname looking for pnpm-workspace.yaml. Limit to a
  // handful of levels so a misconfigured runtime fails fast rather than
  // walking to filesystem root.
  let candidate = __dirname;
  for (let i = 0; i < 6; i++) {
    if (existsSync(resolve(candidate, 'pnpm-workspace.yaml'))) {
      return candidate;
    }
    const parent = resolve(candidate, '..');
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(
    `[buildExtensionAliasMap] unable to locate monorepo root from ${__dirname}; ` +
      `pnpm-workspace.yaml not found within 6 parent directories. ` +
      `Has the forge output layout changed?`,
  );
}
