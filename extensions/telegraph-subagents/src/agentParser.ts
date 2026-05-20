/**
 * Agent definition parser.
 *
 * Reads Telegraph `.md` agent files and converts them into
 * `SubagentDefinition` objects.
 */

import type { SubagentDefinition, SubagentScope } from './types'

// ---------------------------------------------------------------------------
// YAML frontmatter parser (minimal, no external dependency)
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/

/**
 * Parse a single agent `.md` file into a SubagentDefinition.
 *
 * The filename is the default agent name. YAML frontmatter may override metadata,
 * but user-created agents do not need a `name` field just to become discoverable.
 */
export function parseAgentFile(
  content: string,
  scope: SubagentScope,
  sourcePath?: string,
): SubagentDefinition | null {
  const match = content.match(FRONTMATTER_RE)
  const fm = match ? parseSimpleYaml(match[1]) : {}
  const body = (match ? match[2] : content).trim()
  const name = asString(fm.name) ?? inferNameFromPath(sourcePath)
  if (!name) return null

  return {
    name,
    package: asString(fm.package),
    description: asString(fm.description),
    tools: parseCommaSeparated(fm.tools),
    model: asString(fm.model),
    fallbackModels: parseCommaSeparated(pick(fm, 'fallbackModels', 'fallback_models')),
    thinking: asThinking(fm.thinking),
    systemPromptMode: asString(pick(fm, 'systemPromptMode', 'system_prompt_mode', 'prompt_mode'))?.toLowerCase() === 'append'
      ? 'append'
      : 'replace',
    inheritProjectContext: parseBool(pick(fm, 'inheritProjectContext', 'inherit_project_context', 'inherit_context'), false),
    inheritSkills: parseBool(pick(fm, 'inheritSkills', 'inherit_skills'), false),
    defaultContext: pick(fm, 'defaultContext', 'default_context') === 'fork' ? 'fork' : 'fresh',
    output: asString(fm.output),
    defaultReads: parseCommaSeparated(pick(fm, 'defaultReads', 'default_reads')),
    defaultProgress: parseBool(pick(fm, 'defaultProgress', 'default_progress'), false),
    skills: parseCommaSeparated(fm.skills),
    systemPrompt: body,
    scope,
    sourcePath,
  }
}

// ---------------------------------------------------------------------------
// Minimal YAML parser (flat key:value fields plus simple string lists)
// ---------------------------------------------------------------------------

type YamlValue = string | boolean | number | string[] | undefined

function parseSimpleYaml(block: string): Record<string, YamlValue> {
  const result: Record<string, YamlValue> = {}
  let currentListKey: string | undefined

  for (const line of block.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    if (currentListKey && trimmed.startsWith('- ')) {
      const list = result[currentListKey]
      if (Array.isArray(list)) {
        list.push(unquote(trimmed.slice(2).trim()))
      }
      continue
    }

    const colonIdx = trimmed.indexOf(':')
    if (colonIdx < 1) continue

    const key = trimmed.slice(0, colonIdx).trim()
    const rawValue = trimmed.slice(colonIdx + 1).trim()
    if (rawValue === '') {
      result[key] = []
      currentListKey = key
      continue
    }

    result[key] = parseScalar(rawValue)
    currentListKey = undefined
  }
  return result
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseCommaSeparated(raw: unknown): string[] | undefined {
  if (raw === undefined || raw === null || raw === '' || raw === false) return undefined
  if (Array.isArray(raw)) return raw.filter((item): item is string => typeof item === 'string' && item.length > 0)
  const str = String(raw).trim()
  if (str === 'none') return []
  const value = str.startsWith('[') && str.endsWith(']') ? str.slice(1, -1) : str
  return value
    .split(',')
    .map(s => s.trim())
    .map(unquote)
    .filter(Boolean)
}

function parseBool(raw: unknown, fallback: boolean): boolean {
  if (raw === true || raw === 'true') return true
  if (raw === false || raw === 'false') return false
  return fallback
}

function asString(raw: unknown): string | undefined {
  return typeof raw === 'string' && raw.length > 0 ? raw : undefined
}

function pick(record: Record<string, YamlValue>, ...keys: string[]): YamlValue {
  for (const key of keys) {
    const value = record[key]
    if (value !== undefined) return value
  }
  return undefined
}

function asThinking(raw: unknown): SubagentDefinition['thinking'] {
  return raw === 'off' ||
    raw === 'minimal' ||
    raw === 'low' ||
    raw === 'medium' ||
    raw === 'high' ||
    raw === 'xhigh'
    ? raw
    : undefined
}

function inferNameFromPath(sourcePath?: string): string | undefined {
  if (!sourcePath) return undefined
  const file = sourcePath.split(/[\\/]/).pop()
  return file?.endsWith('.md') ? file.slice(0, -'.md'.length) : undefined
}

function parseScalar(raw: string): string | boolean | number {
  const value = unquote(raw)
  if (value === 'true') return true
  if (value === 'false') return false
  if (/^\d+$/.test(value)) return Number(value)
  return value
}

function unquote(value: string): string {
  return (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
    ? value.slice(1, -1)
    : value
}
