/**
 * Skill loader — discovers SKILL.md files from project-local and global directories.
 *
 * Adapted from pi-mono/packages/coding-agent/src/core/skills.ts for Telegraph.
 *
 * Discovery locations (in priority order):
 * 1. `<cwd>/skills/`                — project-local skills
 * 2. `<cwd>/.telegraph/skills/`     — project-local overrides under `.telegraph/`
 * 3. `<globalDir>/skills/`          — user-global skills (e.g. `~/.telegraph/skills/`)
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import ignore, { type Ignore } from 'ignore'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { homedir } from 'node:os'
import { parseFrontmatter } from './frontmatter'
import type { Skill, SkillDiagnostic, SkillFrontmatter, LoadSkillsResult } from './types'

export type { Skill, SkillDiagnostic, SkillFrontmatter, LoadSkillsResult }

const MAX_NAME_LENGTH = 64
const MAX_DESCRIPTION_LENGTH = 1024
const IGNORE_FILE_NAMES = ['.gitignore', '.ignore', '.fdignore']

function toPosixPath(p: string): string {
	return p.split(sep).join('/')
}

function prefixIgnorePattern(line: string, prefix: string): string | null {
	const trimmed = line.trim()
	if (!trimmed) return null
	if (trimmed.startsWith('#') && !trimmed.startsWith('\\#')) return null

	let pattern = line
	let negated = false

	if (pattern.startsWith('!')) {
		negated = true
		pattern = pattern.slice(1)
	} else if (pattern.startsWith('\\!')) {
		pattern = pattern.slice(1)
	}

	if (pattern.startsWith('/')) {
		pattern = pattern.slice(1)
	}

	const prefixed = prefix ? `${prefix}${pattern}` : pattern
	return negated ? `!${prefixed}` : prefixed
}

function addIgnoreRules(ig: Ignore, dir: string, rootDir: string): void {
	const relativeDir = relative(rootDir, dir)
	const prefix = relativeDir ? `${toPosixPath(relativeDir)}/` : ''

	for (const filename of IGNORE_FILE_NAMES) {
		const ignorePath = join(dir, filename)
		if (!existsSync(ignorePath)) continue
		try {
			const content = readFileSync(ignorePath, 'utf-8')
			const patterns = content
				.split(/\r?\n/)
				.map((line) => prefixIgnorePattern(line, prefix))
				.filter((line): line is string => Boolean(line))
			if (patterns.length > 0) {
				ig.add(patterns)
			}
		} catch { /* best effort */ }
	}
}

function validateName(name: string): string[] {
	const errors: string[] = []
	if (name.length > MAX_NAME_LENGTH) {
		errors.push(`name exceeds ${String(MAX_NAME_LENGTH)} characters (${String(name.length)})`)
	}
	if (!/^[a-z0-9-]+$/.test(name)) {
		errors.push('name contains invalid characters (must be lowercase a-z, 0-9, hyphens only)')
	}
	if (name.startsWith('-') || name.endsWith('-')) {
		errors.push('name must not start or end with a hyphen')
	}
	if (name.includes('--')) {
		errors.push('name must not contain consecutive hyphens')
	}
	return errors
}

function validateDescription(description: string | undefined): string[] {
	const errors: string[] = []
	if (!description || description.trim() === '') {
		errors.push('description is required')
	} else if (description.length > MAX_DESCRIPTION_LENGTH) {
		errors.push(`description exceeds ${String(MAX_DESCRIPTION_LENGTH)} characters (${String(description.length)})`)
	}
	return errors
}

// ─── directory scanner ──────────────────────────────────────────────────────

export interface LoadSkillsFromDirOptions {
	/** Directory to scan for skills. */
	dir: string
	/** Source identifier for diagnostics ('project' | 'user' | 'path'). */
	source: string
}

/**
 * Load skills from a directory.
 *
 * Discovery rules:
 * - if a directory contains SKILL.md, treat it as a skill root and do not recurse further
 * - otherwise, load direct .md children in the root
 * - recurse into subdirectories to find SKILL.md
 */
export function loadSkillsFromDir(options: LoadSkillsFromDirOptions): LoadSkillsResult {
	const { dir, source } = options
	return loadSkillsFromDirInternal(dir, source, true)
}

function loadSkillsFromDirInternal(
	dir: string,
	source: string,
	includeRootFiles: boolean,
	ignoreMatcher?: Ignore,
	rootDir?: string,
): LoadSkillsResult {
	const skills: Skill[] = []
	const diagnostics: SkillDiagnostic[] = []

	if (!existsSync(dir)) {
		return { skills, diagnostics }
	}

	const root = rootDir ?? dir
	const ig = ignoreMatcher ?? ignore()
	addIgnoreRules(ig, dir, root)

	try {
		const entries = readdirSync(dir, { withFileTypes: true })

		// Phase 1: Check for SKILL.md at the current level
		for (const entry of entries) {
			if (entry.name !== 'SKILL.md') continue

			const fullPath = join(dir, entry.name)
			let isFile = entry.isFile()
			if (entry.isSymbolicLink()) {
				try { isFile = statSync(fullPath).isFile() } catch { continue }
			}

			const relPath = toPosixPath(relative(root, fullPath))
			if (!isFile || ig.ignores(relPath)) continue

			const result = loadSkillFromFile(fullPath, source)
			if (result.skill) skills.push(result.skill)
			diagnostics.push(...result.diagnostics)
			return { skills, diagnostics }
		}

		// Phase 2: Recurse into subdirectories and check root .md files
		for (const entry of entries) {
			if (entry.name.startsWith('.') || entry.name === 'node_modules') continue

			const fullPath = join(dir, entry.name)
			let isDirectory = entry.isDirectory()
			let isFile = entry.isFile()
			if (entry.isSymbolicLink()) {
				try {
					const stats = statSync(fullPath)
					isDirectory = stats.isDirectory()
					isFile = stats.isFile()
				} catch { continue }
			}

			const relPath = toPosixPath(relative(root, fullPath))
			const ignorePath = isDirectory ? `${relPath}/` : relPath
			if (ig.ignores(ignorePath)) continue

			if (isDirectory) {
				const subResult = loadSkillsFromDirInternal(fullPath, source, false, ig, root)
				skills.push(...subResult.skills)
				diagnostics.push(...subResult.diagnostics)
				continue
			}

			if (!isFile || !includeRootFiles || !entry.name.endsWith('.md')) continue

			const result = loadSkillFromFile(fullPath, source)
			if (result.skill) skills.push(result.skill)
			diagnostics.push(...result.diagnostics)
		}
	} catch { /* directory not readable */ }

	return { skills, diagnostics }
}

function loadSkillFromFile(
	filePath: string,
	_source: string,
): { skill: Skill | null; diagnostics: SkillDiagnostic[] } {
	const diagnostics: SkillDiagnostic[] = []

	try {
		const rawContent = readFileSync(filePath, 'utf-8')
		const { frontmatter } = parseFrontmatter<SkillFrontmatter>(rawContent)
		const skillDir = dirname(filePath)
		const parentDirName = basename(skillDir)

		const descErrors = validateDescription(frontmatter.description)
		for (const error of descErrors) {
			diagnostics.push({ type: 'warning', message: error, path: filePath })
		}

		const name = frontmatter.name || parentDirName

		const nameErrors = validateName(name)
		for (const error of nameErrors) {
			diagnostics.push({ type: 'warning', message: error, path: filePath })
		}

		if (!frontmatter.description || frontmatter.description.trim() === '') {
			return { skill: null, diagnostics }
		}

		return {
			skill: {
				name,
				description: frontmatter.description,
				filePath,
				baseDir: skillDir,
				disableModelInvocation: frontmatter['disable-model-invocation'] === true,
			},
			diagnostics,
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : 'failed to parse skill file'
		diagnostics.push({ type: 'warning', message, path: filePath })
		return { skill: null, diagnostics }
	}
}

// ─── prompt formatting ──────────────────────────────────────────────────────

/**
 * Format skills for inclusion in a system prompt.
 * Uses XML format per Agent Skills standard.
 * See: https://agentskills.io/integrate-skills
 *
 * Skills with disableModelInvocation=true are excluded from the prompt
 * (they can only be invoked explicitly via /skill:name commands).
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
	const visibleSkills = skills.filter((s) => !s.disableModelInvocation)

	if (visibleSkills.length === 0) {
		return ''
	}

	const lines = [
		'',
		'The following skills provide specialized instructions for specific tasks.',
		'Use the read tool to load a skill\'s file when the task matches its description.',
		'When a skill file references a relative path, resolve it against the skill directory (parent of SKILL.md / dirname of the path) and use that absolute path in tool commands.',
		'',
		'<available_skills>',
	]

	for (const skill of visibleSkills) {
		lines.push('  <skill>')
		lines.push(`    <name>${escapeXml(skill.name)}</name>`)
		lines.push(`    <description>${escapeXml(skill.description)}</description>`)
		lines.push(`    <location>${escapeXml(skill.filePath)}</location>`)
		lines.push('  </skill>')
	}

	lines.push('</available_skills>')

	return lines.join('\n')
}

function escapeXml(str: string): string {
	return str
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;')
}

// ─── top-level load ─────────────────────────────────────────────────────────

export interface LoadSkillsOptions {
	/** Working directory for project-local skills. */
	cwd: string
	/**
	 * Global config directory for user-level skills.
	 * Defaults to `~/.telegraph/` if not provided.
	 */
	globalDir?: string
	/** Explicit skill paths (files or directories) to additionally load. */
	skillPaths?: string[]
}

/**
 * Load skills from all configured locations.
 *
 * Scans (in order, earlier wins on name collision):
 * 1. `<cwd>/skills/`            — project skills
 * 2. `<cwd>/.telegraph/skills/` — project .telegraph overrides
 * 3. `<globalDir>/skills/`      — user-global skills (default: `~/.telegraph/skills/`)
 * 4. `skillPaths` entries       — explicit paths
 *
 * Returns skills (deduplicated by name, first-wins) and diagnostics.
 */
export function loadSkills(options: LoadSkillsOptions): LoadSkillsResult {
	const { cwd, skillPaths } = options
	const globalDir = options.globalDir ?? join(homedir(), '.telegraph')

	const resolvedCwd = resolve(cwd)
	const resolvedGlobalDir = resolve(globalDir)

	const skillMap = new Map<string, Skill>()
	const allDiagnostics: SkillDiagnostic[] = []
	const collisionDiagnostics: SkillDiagnostic[] = []

	function addSkills(result: LoadSkillsResult): void {
		allDiagnostics.push(...result.diagnostics)
		for (const skill of result.skills) {
			const existing = skillMap.get(skill.name)
			if (existing) {
				collisionDiagnostics.push({
					type: 'collision',
					message: `name "${skill.name}" collision`,
					path: skill.filePath,
					collision: {
						resourceType: 'skill',
						name: skill.name,
						winnerPath: existing.filePath,
						loserPath: skill.filePath,
					},
				})
			} else {
				skillMap.set(skill.name, skill)
			}
		}
	}

	// 1. Project-root skills/ directory
	addSkills(loadSkillsFromDirInternal(join(resolvedCwd, 'skills'), 'project', true))

	// 2. Project-root .telegraph/skills/ directory
	addSkills(loadSkillsFromDirInternal(join(resolvedCwd, '.telegraph', 'skills'), 'project', true))

	// 3. Global ~/.telegraph/skills/ directory
	addSkills(loadSkillsFromDirInternal(join(resolvedGlobalDir, 'skills'), 'user', true))

	// 4. Explicit skill paths
	for (const rawPath of skillPaths ?? []) {
		const resolvedPath = resolve(resolvedCwd, rawPath)
		if (!existsSync(resolvedPath)) {
			allDiagnostics.push({ type: 'warning', message: 'skill path does not exist', path: resolvedPath })
			continue
		}

		try {
			const stats = statSync(resolvedPath)
			if (stats.isDirectory()) {
				addSkills(loadSkillsFromDirInternal(resolvedPath, 'path', true))
			} else if (stats.isFile() && resolvedPath.endsWith('.md')) {
				const result = loadSkillFromFile(resolvedPath, 'path')
				if (result.skill) {
					addSkills({ skills: [result.skill], diagnostics: result.diagnostics })
				} else {
					allDiagnostics.push(...result.diagnostics)
				}
			} else {
				allDiagnostics.push({ type: 'warning', message: 'skill path is not a markdown file', path: resolvedPath })
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'failed to read skill path'
			allDiagnostics.push({ type: 'warning', message, path: resolvedPath })
		}
	}

	return {
		skills: Array.from(skillMap.values()),
		diagnostics: [...allDiagnostics, ...collisionDiagnostics],
	}
}
