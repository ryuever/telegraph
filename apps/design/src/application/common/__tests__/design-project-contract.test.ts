import { describe, expect, it } from 'vitest'
import { evaluateStandaloneProjectFiles } from '../design-project-contract'

describe('design-project-contract', () => {
  it('accepts renamed default imports from generated App sources', () => {
    const contract = evaluateStandaloneProjectFiles(projectOperations({
      entrySource: "import GeneratedDesignPage from './App'\n\nvoid GeneratedDesignPage\n",
      appSource: 'export default function SaasPage() { return <main>SaaS</main> }\n',
    }))

    expect(contract.checks).toContainEqual(expect.objectContaining({
      id: 'standalone-local-import-exports',
      passed: true,
    }))
    expect(contract.passed).toBe(true)
  })

  it('rejects named imports that are only default exports in generated App sources', () => {
    const contract = evaluateStandaloneProjectFiles(projectOperations({
      entrySource: "import { GeneratedDesignPage } from './App'\n\nvoid GeneratedDesignPage\n",
      appSource: 'export default function SaasPage() { return <main>SaaS</main> }\n',
    }))
    const mismatchCheck = contract.checks.find(check => check.id === 'standalone-local-import-exports')

    expect(mismatchCheck?.passed).toBe(false)
    expect(mismatchCheck?.summary).toContain('src/index.tsx -> ./App { GeneratedDesignPage }')
    expect(contract.passed).toBe(false)
  })
})

function projectOperations(input: {
  entrySource: string
  appSource: string
}): Array<{ kind: 'add'; path: string; content: string }> {
  const root = 'apps/design/src/generated/import-contract'
  return [
    {
      kind: 'add',
      path: `${root}/package.json`,
      content: JSON.stringify({
        dependencies: {
          react: '19.1.0',
          'react-dom': '19.1.0',
        },
      }),
    },
    {
      kind: 'add',
      path: `${root}/index.html`,
      content: '<div id="root"></div><script type="module" src="./src/index.tsx?entry"></script>',
    },
    {
      kind: 'add',
      path: `${root}/src/index.tsx`,
      content: input.entrySource,
    },
    {
      kind: 'add',
      path: `${root}/src/App.tsx`,
      content: input.appSource,
    },
  ]
}
