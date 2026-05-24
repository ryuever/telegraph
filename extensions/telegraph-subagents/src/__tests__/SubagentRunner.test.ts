import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { buildPromptForAgent } from '../SubagentRunner'
import type { SubagentDefinition } from '../types'

describe('buildPromptForAgent', () => {
  let tmpRoot: string

  beforeEach(() => {
    tmpRoot = join(tmpdir(), `telegraph-subagent-runner-${Date.now()}`)
    mkdirSync(tmpRoot, { recursive: true })
  })

  afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })

  it('injects inherited skill catalog and explicit selected skill bodies', () => {
    writeSkill('design-system', 'Design system rules', 'Use the shadcn primitive first.')
    const agent: SubagentDefinition = {
      name: 'design-worker',
      description: 'Generate design source.',
      tools: ['read'],
      inheritSkills: true,
      skills: ['design-system'],
      systemPrompt: 'You are Design Worker.',
      scope: 'builtin',
    }

    const prompt = buildPromptForAgent(agent, 'Build a login page.', { cwd: tmpRoot })

    expect(prompt).toContain('<available_skills>')
    expect(prompt).toContain('<name>design-system</name>')
    expect(prompt).toContain('<selected_skills>')
    expect(prompt).toContain('Use the shadcn primitive first.')
    expect(prompt).toContain('Task: Build a login page.')
  })

  function writeSkill(name: string, description: string, body: string): void {
    const dir = join(tmpRoot, 'skills', name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'SKILL.md'),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}`,
      'utf-8',
    )
  }
})
