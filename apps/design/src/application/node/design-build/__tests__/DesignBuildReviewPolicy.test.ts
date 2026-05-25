import { describe, expect, it } from 'vitest'
import { TAILWIND_PLAY_CDN_SCRIPT_URL } from '@/apps/design/application/common/design-project-contract'
import type { DesignBuildArtifact } from '../DesignBuildArtifacts'
import {
  createDefaultDesignSystemPolicy,
} from '@/apps/design/application/common/design-system-contract'
import {
  evaluateDesignBuildArtifact,
  mergeDesignBuildReview,
} from '../DesignBuildReviewPolicy'

describe('DesignBuildReviewPolicy', () => {
  it('blocks unsafe patch paths before reviewer output can pass the artifact', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact([
      {
        path: '../outside.tsx',
        content: 'export default function App() { return <main /> }\n',
      },
    ]))

    const merged = mergeDesignBuildReview(policyReview, {
      verdict: 'pass',
      checks: [{ id: 'semantic-review', passed: true, summary: 'Looks good visually.' }],
    })

    expect(policyReview.verdict).toBe('blocked')
    expect(merged.verdict).toBe('blocked')
    expect(merged.checks.some(check => check.id === 'policy:patch-path-scope' && !check.passed)).toBe(true)
  })

  it('keeps repair required when deterministic checks fail but reviewer passes', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact([
      {
        path: 'apps/design/src/generated/page.tsx',
        content: "import { Button } from '@/packages/ui/components/ui/button'\n\nexport default function App() { return <Button /> }\n",
      },
    ]))

    const merged = mergeDesignBuildReview(policyReview, {
      verdict: 'pass',
      checks: [{ id: 'semantic-review', passed: true, summary: 'Meets the brief.' }],
    })

    expect(policyReview.verdict).toBe('repair_required')
    expect(merged.verdict).toBe('repair_required')
    expect(merged.checks.some(check => check.id === 'policy:standalone-package-root' && !check.passed)).toBe(true)
    expect(merged.checks.some(check => check.id === 'policy:standalone-imports' && !check.passed)).toBe(true)
  })

  it('adds policy evidence checks when a design system policy is provided', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact([
      {
        path: 'apps/design/src/generated/page/package.json',
        content: JSON.stringify({
          dependencies: {
            react: '19.1.0',
            'react-dom': '19.1.0',
          },
        }),
      },
      {
        path: 'apps/design/src/generated/page/index.html',
        content: indexHtml(),
      },
      {
        path: 'apps/design/src/generated/page/src/index.tsx',
        content: "import App from './App'\n",
      },
      {
        path: 'apps/design/src/generated/page/src/App.tsx',
        content: 'export default function App() { return <main /> }\n',
      },
    ]), {
      designSystemPolicy: createDefaultDesignSystemPolicy(),
    })

    expect(policyReview.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'design-system-policy-resolved', passed: true }),
      expect.objectContaining({ id: 'design-system-handwrite-policy', passed: true }),
      expect.objectContaining({ id: 'design-system-dependency-closure', passed: true }),
    ]))
  })

  it('requires component edits to target composition files instead of dirtying shadcn primitives', () => {
    const policyReview = evaluateDesignBuildArtifact(patchArtifact([
      {
        path: 'apps/design/src/generated/page/package.json',
        content: JSON.stringify({
          dependencies: {
            react: '19.1.0',
            'react-dom': '19.1.0',
          },
        }),
      },
      {
        path: 'apps/design/src/generated/page/index.html',
        content: indexHtml(),
      },
      {
        path: 'apps/design/src/generated/page/src/index.tsx',
        content: "import App from './App'\n",
      },
      {
        path: 'apps/design/src/generated/page/src/App.tsx',
        content: 'export default function App() { return <main /> }\n',
      },
    ]), {
      componentEdit: {
        kind: 'component-edit',
        artifactId: 'artifact-1',
        binding: {
          editScope: 'composition',
          preferredOperationPath: 'apps/design/src/generated/page/src/App.tsx',
          protectedPrimitivePaths: ['apps/design/src/generated/page/src/components/ui/button.tsx'],
          provenance: 'shadcn-primitive',
        },
        dirtyOperationPaths: ['apps/design/src/generated/page/src/components/ui/button.tsx'],
        dirtyOperations: [
          {
            kind: 'update',
            path: 'apps/design/src/generated/page/src/components/ui/button.tsx',
            source: 'style-editor',
          },
        ],
      },
    })

    expect(policyReview.verdict).toBe('repair_required')
    expect(policyReview.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'component-edit-context-bound', passed: true }),
      expect.objectContaining({ id: 'component-edit-composition-target', passed: true }),
      expect.objectContaining({ id: 'component-edit-primitive-guard', passed: false }),
    ]))
  })

  it('requires selected shadcn components to be imported and rendered in composition source', () => {
    const policyReview = evaluateDesignBuildArtifact(shadcnPatchArtifact({
      appSource: 'export default function App() { return <main>Profile settings</main> }\n',
    }), {
      componentLedger: componentLedger(['badge']),
    })

    expect(policyReview.verdict).toBe('repair_required')
    expect(policyReview.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'selected-shadcn-components-installed', passed: true }),
      expect.objectContaining({ id: 'selected-shadcn-components-imported', passed: false }),
      expect.objectContaining({ id: 'selected-shadcn-components-rendered', passed: false }),
    ]))
  })

  it('passes selected shadcn usage checks when composition imports and renders the selected component', () => {
    const policyReview = evaluateDesignBuildArtifact(shadcnPatchArtifact({
      appSource: [
        'import { Badge } from "@/components/ui/badge"',
        '',
        'export default function App() {',
        '  return <main><Badge>Active</Badge></main>',
        '}',
        '',
      ].join('\n'),
    }), {
      componentLedger: componentLedger(['badge']),
    })

    expect(policyReview.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'selected-shadcn-components-installed', passed: true }),
      expect.objectContaining({ id: 'selected-shadcn-components-imported', passed: true }),
      expect.objectContaining({ id: 'selected-shadcn-components-rendered', passed: true }),
    ]))
  })
})

function patchArtifact(operations: Array<{ path: string; content: string }>): DesignBuildArtifact {
  return {
    id: 'artifact-1',
    kind: 'design-patch',
    title: 'Generated page',
    operations: operations.map(operation => ({
      kind: 'add',
      path: operation.path,
      content: operation.content,
    })),
  }
}

function shadcnPatchArtifact(input: { appSource: string }): DesignBuildArtifact {
  const root = 'apps/design/src/generated/page'
  return {
    id: 'artifact-shadcn',
    kind: 'design-patch',
    title: 'Generated shadcn page',
    metadata: {
      componentRetrievalLedger: componentLedger(['badge']),
    },
    operations: [
      {
        kind: 'add',
        path: `${root}/package.json`,
        content: JSON.stringify({
          dependencies: {
            'class-variance-authority': '^0.7.1',
            clsx: '^2.1.1',
            react: '19.1.0',
            'react-dom': '19.1.0',
            'tailwind-merge': '^3.3.1',
          },
          devDependencies: {
            '@vitejs/plugin-react': 'latest',
            typescript: '5.3.3',
            vite: '^5.4.0',
          },
        }),
      },
      {
        kind: 'add',
        path: `${root}/index.html`,
        content: indexHtml(),
      },
      {
        kind: 'add',
        path: `${root}/vite.config.ts`,
        content: "export default { resolve: { alias: { '@': new URL('./src', import.meta.url).pathname } } }\n",
      },
      {
        kind: 'add',
        path: `${root}/tsconfig.json`,
        content: JSON.stringify({ compilerOptions: { paths: { '@/*': ['./src/*'] } } }),
      },
      {
        kind: 'add',
        path: `${root}/components.json`,
        content: JSON.stringify({ aliases: { ui: '@/components/ui', utils: '@/lib/utils' } }),
      },
      {
        kind: 'add',
        path: `${root}/design-system.provenance.json`,
        content: JSON.stringify({ components: [{ name: 'badge' }] }),
      },
      {
        kind: 'add',
        path: `${root}/src/styles.css`,
        content: ':root { --background: #fff; --foreground: #111; --primary: #111; --primary-foreground: #fff; --border: #ddd; --input: #ddd; --ring: #999; --radius: 0.5rem; }\n',
      },
      {
        kind: 'add',
        path: `${root}/src/lib/utils.ts`,
        content: 'import { clsx, type ClassValue } from "clsx"\nimport { twMerge } from "tailwind-merge"\nexport function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }\n',
      },
      {
        kind: 'add',
        path: `${root}/src/components/ui/badge.tsx`,
        content: 'import { cva } from "class-variance-authority"\nimport { cn } from "@/lib/utils"\nconst badgeVariants = cva("")\nexport function Badge(props: React.HTMLAttributes<HTMLDivElement>) { return <div className={cn(badgeVariants())} {...props} /> }\n',
      },
      {
        kind: 'add',
        path: `${root}/src/index.tsx`,
        content: "import App from './App'\n",
      },
      {
        kind: 'add',
        path: `${root}/src/App.tsx`,
        content: input.appSource,
      },
    ],
  }
}

function indexHtml(): string {
  return `<script src="${TAILWIND_PLAY_CDN_SCRIPT_URL}"></script><div id="root"></div><script type="module" src="./src/index.tsx?entry"></script>`
}

function componentLedger(names: string[]) {
  return {
    query: {
      prompt: 'Create a profile settings page',
      pageType: 'test',
      roles: names.map(name => ({ role: name, required: true, examples: [name] })),
    },
    policy: {
      id: 'shadcn-first-standalone',
      mode: 'standalone-preview' as const,
      allowedRegistries: ['@shadcn'],
      handwritePolicy: 'only-when-unavailable' as const,
    },
    trust: {
      allowedRegistries: ['@shadcn'],
      blockedRegistries: [],
      registries: [],
    },
    retrieval: {
      status: 'complete' as const,
      sources: [],
      metrics: {
        candidateCount: names.length,
        selectedCount: names.length,
        rejectedCount: 0,
        fallbackCount: 0,
        hitRate: 1,
        fallbackRate: 0,
        repairRate: 0,
        visualFailureRate: 0,
      },
    },
    candidates: [],
    selected: names.map(name => ({
      registry: '@shadcn',
      name,
      type: 'registry:ui' as const,
      description: `${name} test component`,
      score: 9,
      reason: 'Selected for test.',
      files: [`src/components/ui/${name}.tsx`],
      materializedFiles: [`src/components/ui/${name}.tsx`],
      importExamples: [`import { Badge } from "@/components/ui/${name}"`],
    })),
    fallbacks: [],
    rejected: [],
  }
}
