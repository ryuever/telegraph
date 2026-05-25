import { describe, expect, it } from 'vitest'
import {
  GENERATED_REACT_VERSION,
  mergeGeneratedPackageJsonContent,
  normalizeGeneratedPackageJsonContent,
} from '../design-package-json'

describe('design-package-json', () => {
  it('pins generated React runtime dependencies when merging package.json content', () => {
    const merged = mergeGeneratedPackageJsonContent(
      JSON.stringify({
        dependencies: {
          react: GENERATED_REACT_VERSION,
          'react-dom': GENERATED_REACT_VERSION,
          clsx: '^2.1.1',
        },
      }),
      JSON.stringify({
        dependencies: {
          react: 'latest',
          'react-dom': '19.3.0-canary-fef12a01-20260413',
          '@radix-ui/react-slot': '^1.2.3',
        },
      }),
    )

    expect(JSON.parse(merged ?? '{}')).toEqual({
      dependencies: {
        react: GENERATED_REACT_VERSION,
        'react-dom': GENERATED_REACT_VERSION,
        clsx: '^2.1.1',
        '@radix-ui/react-slot': '^1.2.3',
      },
      devDependencies: {},
    })
  })

  it('normalizes single-package generated package.json content with unstable React versions', () => {
    const normalized = normalizeGeneratedPackageJsonContent(JSON.stringify({
      dependencies: {
        react: 'next',
      },
    }))

    expect(JSON.parse(normalized ?? '{}')).toEqual({
      dependencies: {
        react: GENERATED_REACT_VERSION,
        'react-dom': GENERATED_REACT_VERSION,
      },
    })
  })
})
