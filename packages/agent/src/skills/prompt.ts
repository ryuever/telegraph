import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Skill } from './types'

const DEFAULT_MAX_SKILL_CHARS = 12_000

export interface FormatSelectedSkillBodiesOptions {
  maxCharsPerSkill?: number
}

export function resolveSkillSearchRoot(cwd = process.cwd()): string {
  let current = resolve(cwd)

  for (;;) {
    if (existsSync(join(current, 'skills')) || existsSync(join(current, 'pnpm-workspace.yaml'))) {
      return current
    }

    const parent = dirname(current)
    if (parent === current) return resolve(cwd)
    current = parent
  }
}

export function formatSelectedSkillBodiesForPrompt(
  skills: Skill[],
  selectedNames: string[],
  options: FormatSelectedSkillBodiesOptions = {},
): string {
  const names = uniqueNonEmpty(selectedNames)
  if (names.length === 0) return ''

  const byName = new Map(skills.map(skill => [skill.name, skill]))
  const maxChars = Math.max(1, options.maxCharsPerSkill ?? DEFAULT_MAX_SKILL_CHARS)
  const lines = [
    'The following selected skills are loaded inline. Follow these instructions when they apply.',
    '<selected_skills>',
  ]

  for (const name of names) {
    const skill = byName.get(name)
    if (!skill) {
      lines.push(`  <missing_skill name="${escapeXml(name)}" />`)
      continue
    }

    const content = readSkillContent(skill.filePath, maxChars)
    lines.push(`  <skill name="${escapeXml(skill.name)}" location="${escapeXml(skill.filePath)}">`)
    lines.push(`    <content truncated="${String(content.truncated)}">${escapeXml(content.text)}</content>`)
    lines.push('  </skill>')
  }

  lines.push('</selected_skills>')
  return lines.join('\n')
}

function readSkillContent(filePath: string, maxChars: number): { text: string; truncated: boolean } {
  const raw = readFileSync(filePath, 'utf-8')
  if (raw.length <= maxChars) return { text: raw, truncated: false }
  return {
    text: `${raw.slice(0, maxChars)}\n\n[skill truncated: ${String(raw.length - maxChars)} characters omitted]`,
    truncated: true,
  }
}

function uniqueNonEmpty(values: string[]): string[] {
  return [...new Set(values.map(value => value.trim()).filter(Boolean))]
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}
