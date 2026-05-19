// Root ESLint 9 flat config.
// Phase 0 baseline; will tighten as new code lands in apps/telegraph/src and apps/design/src.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    // Global ignores must be in their own object with no other keys.
    ignores: [
      '**/node_modules/**',
      '**/.vite/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '.vitepress/cache/**',
      '**/*.config.{js,cjs,mjs,ts}',
      'vitest.workspace.ts',
      'codebase-wiki/**',
      // Stale root-level Vite template entry; active apps live under apps/*.
      'src/**',
      // Historical / migration packages are validated by their own focused
      // typecheck/test gates until they are brought into the root strict lint
      // baseline.
      'packages/orchestrator-core/**',
      'packages/stores/**',
      'packages/agent/src/extensions/node/**',
      'packages/agent/src/extensions/ExtensionManifest.ts',
      'packages/agent/src/extensions/__tests__/ExtensionManifest.test.ts',
      'packages/agent/src/memory/**',
      'packages/agent/src/persistence/**',
      'packages/agent/src/providers/**',
      'packages/agent/src/runtime/**',
      'packages/agent/src/types.ts',
      // Tooling/skill scripts checked into the repo for codewiz/Claude — not
      // first-party source.
      '.agents/**',
      '.claude/**',
    ],
  },

  // Base JS recommended.
  js.configs.recommended,

  // TypeScript: strict + type-checked. Scope to *.ts/*.tsx so JS files do not
  // get parsed by the type-aware parser.
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts', '**/*.tsx'],
  })),
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Allow `_`-prefixed identifiers everywhere (params, locals, type
      // parameters) — standard convention for "intentionally unused".
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['scripts/**/*.{js,cjs,mjs}'],
    languageOptions: {
      globals: {
        console: 'readonly',
      },
    },
  },

  // React (renderer code).
  {
    files: ['apps/telegraph/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    ...react.configs.flat.recommended,
    settings: { react: { version: 'detect' } },
  },
  {
    files: ['apps/telegraph/src/**/*.{ts,tsx}', 'packages/ui/src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React 17+ automatic jsx-runtime — no need to import React.
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
      // TypeScript already validates props; runtime PropTypes are not used in
      // this component library.
      'react/prop-types': 'off',
    },
  },

  // Tailwind (renderer/UI only). Re-enable once tailwind config lands in a
  // later phase; Phase 1 has no tailwind so the plugin would error on every
  // file with "Cannot resolve default tailwindcss config path".

  // Prettier last — disables stylistic rules that conflict with formatter.
  prettier,
);
