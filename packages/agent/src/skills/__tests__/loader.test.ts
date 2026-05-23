import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { loadSkills, loadSkillsFromDir, formatSkillsForPrompt } from '../loader'
import type { Skill } from '../types'

function makeTmpDir(prefix: string): string {
	const dir = join(tmpdir(), `telegraph-skills-test-${prefix}-${Date.now()}`)
	mkdirSync(dir, { recursive: true })
	return dir
}

function writeSkill(dir: string, frontmatter: Record<string, string>, body: string = 'Skill body'): string {
	mkdirSync(dir, { recursive: true })
	const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`)
	const content = `---\n${fmLines.join('\n')}\n---\n\n${body}`
	const filePath = join(dir, 'SKILL.md')
	writeFileSync(filePath, content, 'utf-8')
	return filePath
}

describe('loadSkills', () => {
	let tmpRoot: string
	beforeEach(() => { tmpRoot = makeTmpDir('root') })
	afterEach(() => { rmSync(tmpRoot, { recursive: true, force: true }) })

	it('loads skills from project-root skills/ directory', () => {
		writeSkill(join(tmpRoot, 'skills', 'my-skill'), { name: 'my-skill', description: 'A test skill' })
		const { skills, diagnostics } = loadSkills({ cwd: tmpRoot })
		expect(diagnostics).toHaveLength(0)
		expect(skills).toHaveLength(1)
		expect(skills[0]!.name).toBe('my-skill')
	})

	it('loads skills from .telegraph/skills/ directory', () => {
		writeSkill(join(tmpRoot, '.telegraph', 'skills', 'global-skill'), { name: 'global-skill', description: 'A global skill' })
		const { skills } = loadSkills({ cwd: tmpRoot })
		expect(skills).toHaveLength(1)
		expect(skills[0]!.name).toBe('global-skill')
	})

	it('loads skills from custom globalDir', () => {
		const globalDir = makeTmpDir('global')
		writeSkill(join(globalDir, 'skills', 'user-skill'), { name: 'user-skill', description: 'User skill' })
		const { skills } = loadSkills({ cwd: tmpRoot, globalDir })
		expect(skills).toHaveLength(1)
		expect(skills[0]!.name).toBe('user-skill')
		rmSync(globalDir, { recursive: true, force: true })
	})

	it('loads skills from explicit skillPaths', () => {
		const extraDir = makeTmpDir('extra')
		writeSkill(join(extraDir, 'explicit-skill'), { name: 'explicit-skill', description: 'Explicit' })
		const { skills } = loadSkills({ cwd: tmpRoot, skillPaths: [extraDir] })
		expect(skills).toHaveLength(1)
		expect(skills[0]!.name).toBe('explicit-skill')
		rmSync(extraDir, { recursive: true, force: true })
	})

	it('project skills win over global on name collision', () => {
		writeSkill(join(tmpRoot, 'skills', 'shared-name'), { name: 'shared-name', description: 'Project' })
		const globalDir = makeTmpDir('global')
		writeSkill(join(globalDir, 'skills', 'shared-name'), { name: 'shared-name', description: 'Global' })
		const { skills, diagnostics } = loadSkills({ cwd: tmpRoot, globalDir })
		expect(skills).toHaveLength(1)
		expect(skills[0]!.description).toBe('Project')
		expect(diagnostics.some(d => d.type === 'collision')).toBe(true)
		rmSync(globalDir, { recursive: true, force: true })
	})

	it('skips skills without description', () => {
		mkdirSync(join(tmpRoot, 'skills', 'no-desc'), { recursive: true })
		writeFileSync(join(tmpRoot, 'skills', 'no-desc', 'SKILL.md'), '---\nname: no-desc\n---\n\nBody', 'utf-8')
		const { skills, diagnostics } = loadSkills({ cwd: tmpRoot })
		expect(skills).toHaveLength(0)
		expect(diagnostics.some(d => d.message === 'description is required')).toBe(true)
	})

	it('uses parent directory name as fallback', () => {
		writeSkill(join(tmpRoot, 'skills', 'fallback-name'), { description: 'No explicit name' })
		const { skills } = loadSkills({ cwd: tmpRoot })
		expect(skills).toHaveLength(1)
		expect(skills[0]!.name).toBe('fallback-name')
	})

	it('reports warning for non-existent explicit skill path', () => {
		const { diagnostics } = loadSkills({ cwd: tmpRoot, skillPaths: [join(tmpRoot, 'nonexistent')] })
		expect(diagnostics.some(d => d.message === 'skill path does not exist')).toBe(true)
	})

	it('returns empty result when no skills directories exist', () => {
		const { skills, diagnostics } = loadSkills({ cwd: tmpRoot })
		expect(skills).toHaveLength(0)
		expect(diagnostics).toHaveLength(0)
	})

	it('respects disable-model-invocation flag', () => {
		mkdirSync(join(tmpRoot, 'skills', 'hidden-skill'), { recursive: true })
		writeFileSync(
			join(tmpRoot, 'skills', 'hidden-skill', 'SKILL.md'),
			'---\nname: hidden-skill\ndescription: Not in prompt\ndisable-model-invocation: true\n---\n\nBody',
			'utf-8',
		)
		const { skills } = loadSkills({ cwd: tmpRoot })
		expect(skills).toHaveLength(1)
		expect(skills[0]!.disableModelInvocation).toBe(true)
	})
})

describe('loadSkillsFromDir', () => {
	let tmpDir: string
	beforeEach(() => { tmpDir = makeTmpDir('dir') })
	afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }) })

	it('returns empty result for non-existent directory', () => {
		const { skills, diagnostics } = loadSkillsFromDir({ dir: join(tmpDir, 'missing'), source: 'project' })
		expect(skills).toHaveLength(0)
		expect(diagnostics).toHaveLength(0)
	})

	it('recursively discovers skills in nested directories', () => {
		writeSkill(join(tmpDir, 'category', 'nested-skill'), { name: 'nested-skill', description: 'Nested' })
		const { skills } = loadSkillsFromDir({ dir: tmpDir, source: 'project' })
		expect(skills).toHaveLength(1)
		expect(skills[0]!.name).toBe('nested-skill')
	})

	it('stops recursion when SKILL.md is found', () => {
		writeSkill(join(tmpDir, 'parent-skill'), { name: 'parent-skill', description: 'Parent' })
		writeSkill(join(tmpDir, 'parent-skill', 'child-skill'), { name: 'child-skill', description: 'Child' })
		const { skills } = loadSkillsFromDir({ dir: tmpDir, source: 'project' })
		expect(skills).toHaveLength(1)
		expect(skills[0]!.name).toBe('parent-skill')
	})
})

describe('formatSkillsForPrompt', () => {
	it('returns empty string for empty skills array', () => {
		expect(formatSkillsForPrompt([])).toBe('')
	})

	it('formats visible skills as XML', () => {
		const skills: Skill[] = [{
			name: 'my-skill',
			description: 'A test skill with <special> & "chars"',
			filePath: '/path/to/skills/my-skill/SKILL.md',
			baseDir: '/path/to/skills/my-skill',
			disableModelInvocation: false,
		}]
		const result = formatSkillsForPrompt(skills)
		expect(result).toContain('<available_skills>')
		expect(result).toContain('<name>my-skill</name>')
		expect(result).toContain('<description>A test skill with &lt;special&gt; &amp; &quot;chars&quot;</description>')
		expect(result).toContain('<location>/path/to/skills/my-skill/SKILL.md</location>')
		expect(result).toContain('</available_skills>')
	})

	it('excludes skills with disableModelInvocation=true', () => {
		const skills: Skill[] = [
			{ name: 'visible', description: 'Visible skill', filePath: '/a/SKILL.md', baseDir: '/a', disableModelInvocation: false },
			{ name: 'hidden', description: 'Hidden skill', filePath: '/b/SKILL.md', baseDir: '/b', disableModelInvocation: true },
		]
		const result = formatSkillsForPrompt(skills)
		expect(result).toContain('<name>visible</name>')
		expect(result).not.toContain('<name>hidden</name>')
	})
})
