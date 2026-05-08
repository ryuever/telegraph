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
      'apps/_legacy/**',
      '**/node_modules/**',
      '**/.vite/**',
      '**/dist/**',
      '**/out/**',
      '**/coverage/**',
      '**/*.config.{js,cjs,mjs,ts}',
      'vitest.workspace.ts',
      'codebase-wiki/**',
      // Tooling/skill scripts checked into the repo for codewiz/Claude — not
      // first-party source.
      '.agents/**',
      '.claude/**',
      // Legacy hand-checked-in JS build artefacts that ship next to the .ts
      // sources in @telegraph/runtime-contracts. Phase 0 leaves them as-is.
      'packages/runtime-contracts/src/**/*.js',
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
    },
  },

  // Tailwind (renderer/UI only). Re-enable once tailwind config lands in a
  // later phase; Phase 1 has no tailwind so the plugin would error on every
  // file with "Cannot resolve default tailwindcss config path".

  // Prettier last — disables stylistic rules that conflict with formatter.
  prettier,
);
