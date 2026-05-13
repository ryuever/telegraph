// Vitest 2.x workspace config.
// Each entry is either a glob to a sub-package's vitest config or a project
// definition. Phase 0 just enumerates the workspaces; per-project configs can
// be added later as test suites land.
export default [
  'apps/telegraph',
  'apps/design',
  'packages/runtime-contracts',
];
