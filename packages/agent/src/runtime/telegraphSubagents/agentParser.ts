/**
 * Agent definition parser.
 *
 * Reads Telegraph `.md` agent files with YAML frontmatter and converts them
 * into `SubagentDefinition` objects.
 */

import type { SubagentDefinition, SubagentScope } from './types'

// ---------------------------------------------------------------------------
// YAML frontmatter parser (minimal, no external dependency)
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/**
 * Parse a single agent `.md` file into a SubagentDefinition.
 *
 * Expects YAML frontmatter delimited by `---`, followed by the system prompt body.
 * Only the subset of frontmatter fields used by Telegraph is extracted.
 */
export function parseAgentFile(
  content: string,
  scope: SubagentScope,
  sourcePath?: string,
): SubagentDefinition | null {
  const match = content.match(FRONTMATTER_RE)
  if (!match) return null

  const yamlBlock = match[1]
  const body = (match[2] ?? '').trim()

  const fm = parseSimpleYaml(yamlBlock)
  const name = fm.name as string | undefined
  if (!name) return null

  return {
    name,
    package: fm.package as string | undefined,
    description: fm.description as string | undefined,
    tools: parseCommaSeparated(fm.tools),
    model: fm.model as string | undefined,
    fallbackModels: parseCommaSeparated(fm.fallbackModels),
    thinking: fm.thinking as SubagentDefinition['thinking'],
    systemPromptMode: (fm.systemPromptMode as string)?.toLowerCase() === 'append' ? 'append' : 'replace',
    inheritProjectContext: parseBool(fm.inheritProjectContext, false),
    inheritSkills: parseBool(fm.inheritSkills, false),
    defaultContext: fm.defaultContext as 'fresh' | 'fork' | undefined,
    output: fm.output as string | undefined,
    defaultReads: parseCommaSeparated(fm.defaultReads),
    defaultProgress: parseBool(fm.defaultProgress, false),
    skills: parseCommaSeparated(fm.skills),
    systemPrompt: body,
    scope,
    sourcePath,
  }
}

// ---------------------------------------------------------------------------
// Minimal YAML key:value parser (no nested objects needed)
// ---------------------------------------------------------------------------

function parseSimpleYaml(block: string): Record<string, string | boolean | number | undefined> {
  const result: Record<string, string | boolean | number | undefined> = {}
  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx < 1) continue
    const key = trimmed.slice(0, colonIdx).trim()
    let value: string | boolean | number = trimmed.slice(colonIdx + 1).trim()

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }

    if (value === 'true') value = true
    else if (value === 'false') value = false
    else if (/^\d+$/.test(value)) value = Number(value)

    result[key] = value
  }
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCommaSeparated(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null || raw === '' || raw === false) return undefined
  const str = String(raw)
  return str
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === 'true') return true
  if (raw === false || raw === 'false') return false
  return fallback
}
