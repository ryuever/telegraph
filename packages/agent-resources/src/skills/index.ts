/**
 * Skills module — discover, load, and format SKILL.md files.
 *
 * This module is Node.js-only (uses `fs`, `path`, `os`).
 *
 * @example
 * ```ts
 * import { loadSkills, formatSkillsForPrompt } from '@/packages/agent/skills'
 *
 * const { skills, diagnostics } = loadSkills({ cwd: process.cwd() })
 * const prompt = formatSkillsForPrompt(skills)
 * ```
 */

export {
	loadSkills,
	loadSkillsFromDir,
	formatSkillsForPrompt,
	type LoadSkillsOptions,
	type LoadSkillsFromDirOptions,
} from './loader'

export {
	formatSelectedSkillBodiesForPrompt,
	resolveSkillSearchRoot,
	type FormatSelectedSkillBodiesOptions,
} from './prompt'

export type {
	Skill,
	SkillDiagnostic,
	SkillFrontmatter,
	LoadSkillsResult,
} from './types'
