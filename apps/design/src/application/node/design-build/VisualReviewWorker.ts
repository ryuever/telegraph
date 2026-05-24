import {
  inferSandboxProjectRoot,
  type StandaloneProjectContractCheck,
} from '@/apps/design/application/common/design-project-contract'
import type {
  DesignBuildArtifact,
  DesignPatchArtifact,
  DesignPatchOperation,
  DesignPreviewArtifact,
} from './DesignBuildArtifacts'
import type { DesignBuildReview } from './DesignBuildInitialState'

export interface VisualReviewReport {
  id: string
  status: 'pass' | 'repair_required'
  viewports: VisualReviewViewport[]
  checks: VisualReviewCheck[]
  compileRuntime: {
    status: 'pass' | 'error-signals'
    messages: string[]
  }
}

export interface VisualReviewViewport {
  id: 'desktop' | 'mobile'
  width: number
  height: number
  screenshot: {
    status: 'captured' | 'heuristic'
    nonblank: boolean
  }
}

export interface VisualReviewCheck extends StandaloneProjectContractCheck {
  viewport?: VisualReviewViewport['id']
}

export class VisualReviewWorker {
  review(artifact: DesignBuildArtifact): VisualReviewReport {
    const viewports: VisualReviewViewport[] = [
      viewport('desktop', 1440, 960),
      viewport('mobile', 390, 844),
    ]
    const checks = artifact.kind === 'design-preview'
      ? reviewPreviewArtifact(artifact)
      : reviewPatchArtifact(artifact)
    const compileRuntimeMessages = compileRuntimeSignals(artifact)
    const allChecks = [
      ...viewports.map(item => ({
        id: `visual-${item.id}-nonblank`,
        passed: item.screenshot.nonblank && checks.some(check => check.id === 'visual-nonblank' && check.passed),
        summary: `${item.id} preview has nonblank renderable content.`,
        viewport: item.id,
      })),
      ...checks,
      {
        id: 'visual-compile-runtime-errors',
        passed: compileRuntimeMessages.length === 0,
        summary: compileRuntimeMessages.length === 0
          ? 'No obvious compile/runtime error signals found in generated source.'
          : `Compile/runtime error signals found: ${compileRuntimeMessages.slice(0, 4).join('; ')}`,
      },
    ]

    return {
      id: 'visual-review',
      status: allChecks.every(check => check.passed) ? 'pass' : 'repair_required',
      viewports,
      checks: allChecks,
      compileRuntime: {
        status: compileRuntimeMessages.length === 0 ? 'pass' : 'error-signals',
        messages: compileRuntimeMessages,
      },
    }
  }
}

export function reviewFromVisualReport(report: VisualReviewReport): DesignBuildReview {
  return {
    verdict: report.status,
    checks: report.checks.map(check => ({
      id: check.id,
      passed: check.passed,
      summary: check.summary,
    })),
  }
}

function viewport(id: VisualReviewViewport['id'], width: number, height: number): VisualReviewViewport {
  return {
    id,
    width,
    height,
    screenshot: {
      status: 'heuristic',
      nonblank: true,
    },
  }
}

function reviewPreviewArtifact(artifact: DesignPreviewArtifact): VisualReviewCheck[] {
  const source = artifact.html
  const text = visibleText(source)
  return [
    {
      id: 'visual-nonblank',
      passed: text.length > 0,
      summary: text.length > 0 ? 'Preview HTML contains visible content.' : 'Preview HTML appears blank.',
    },
    horizontalOverflowCheck(source, 'desktop'),
    horizontalOverflowCheck(source, 'mobile'),
    textClippingCheck(source),
    overlapCheck(source),
  ]
}

function reviewPatchArtifact(artifact: DesignPatchArtifact): VisualReviewCheck[] {
  const files = projectFiles(artifact.operations)
  const source = [...files.values()].join('\n')
  const appSource = [...files.entries()]
    .filter(([path]) => /src\/.*\.(tsx|jsx|ts|js)$/i.test(path))
    .map(([, content]) => content)
    .join('\n')
  return [
    {
      id: 'visual-nonblank',
      passed: hasRenderableContent(appSource),
      summary: hasRenderableContent(appSource)
        ? 'Generated React source contains renderable visual content.'
        : 'Generated React source appears blank or returns null.',
    },
    horizontalOverflowCheck(source, 'desktop'),
    horizontalOverflowCheck(source, 'mobile'),
    textClippingCheck(source),
    overlapCheck(source),
  ]
}

function horizontalOverflowCheck(source: string, viewportId: VisualReviewViewport['id']): VisualReviewCheck {
  const maxWidth = viewportId === 'desktop' ? 1440 : 390
  const vwOverflow = [...source.matchAll(/(?<!max-)(?:width|min-width)\s*:\s*(\d+(?:\.\d+)?)vw/gi)]
    .some(match => Number(match[1]) > 100)
  const pxOverflow = [...source.matchAll(/(?<!max-)(?:width|min-width)\s*:\s*(\d+(?:\.\d+)?)px/gi)]
    .some(match => Number(match[1]) > maxWidth)
  return {
    id: `visual-${viewportId}-horizontal-overflow`,
    passed: !vwOverflow && !pxOverflow,
    summary: !vwOverflow && !pxOverflow
      ? `${viewportId} layout has no obvious horizontal overflow rules.`
      : `${viewportId} layout has width/min-width rules likely to overflow.`,
    viewport: viewportId,
  }
}

function textClippingCheck(source: string): VisualReviewCheck {
  const clipsOverflow = /overflow\s*:\s*hidden/i.test(source) && /white-space\s*:\s*nowrap/i.test(source)
  const smallButtonHeight = /button[^{]*{[^}]*height\s*:\s*(?:1[0-9]|2[0-3])px/i.test(source) ||
    /\bh-(?:3|4|5)\b/.test(source)
  return {
    id: 'visual-text-button-clipping',
    passed: !clipsOverflow && !smallButtonHeight,
    summary: !clipsOverflow && !smallButtonHeight
      ? 'No obvious text or button clipping rules found.'
      : 'Text or button clipping is likely due to overflow/nowrap or undersized button height.',
  }
}

function overlapCheck(source: string): VisualReviewCheck {
  const absolutePositions = [...source.matchAll(/position\s*:\s*(absolute|fixed)[^}]*?(?:top|left)\s*:\s*0/gi)]
  const negativeMargins = /margin(?:-[a-z]+)?\s*:\s*-\d/.test(source)
  return {
    id: 'visual-element-overlap',
    passed: absolutePositions.length < 2 && !negativeMargins,
    summary: absolutePositions.length < 2 && !negativeMargins
      ? 'No obvious overlapping absolute/fixed placement patterns found.'
      : 'Possible overlapping elements found from repeated absolute/fixed placement or negative margins.',
  }
}

function compileRuntimeSignals(artifact: DesignBuildArtifact): string[] {
  const source = artifact.kind === 'design-preview'
    ? artifact.html
    : artifact.operations.map(operation => operation.content ?? '').join('\n')
  const messages: string[] = []
  if (/throw\s+new\s+Error\s*\(/.test(source)) messages.push('explicit throw new Error() in source')
  if (/ReferenceError|TypeError|SyntaxError/.test(source)) messages.push('runtime error text embedded in source')
  if (/<<<<<<<|=======|>>>>>>>/.test(source)) messages.push('merge conflict marker in source')
  return messages
}

function projectFiles(operations: DesignPatchOperation[]): Map<string, string> {
  const projectRoot = inferSandboxProjectRoot(operations)
  return new Map(
    operations
      .filter(operation => operation.kind !== 'delete' && operation.content)
      .map(operation => [projectRelativePath(operation.path, projectRoot), operation.content ?? '']),
  )
}

function projectRelativePath(path: string, projectRoot: string | undefined): string {
  const normalized = path.trim().replace(/^\/+/, '')
  if (projectRoot && normalized.startsWith(`${projectRoot}/`)) {
    return normalized.slice(projectRoot.length + 1)
  }
  return normalized
}

function hasRenderableContent(source: string): boolean {
  if (!source.trim()) return false
  if (/return\s+(?:null|<>\s*<\/>|['"]{2})/.test(source)) return false
  return /return\s*\(|<main\b|<section\b|<div\b|<button\b|createRoot\(/.test(source)
}

function visibleText(source: string): string {
  return source
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
