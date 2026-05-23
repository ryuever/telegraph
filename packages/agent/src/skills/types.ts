/**
 * Skill types — follows the Agent Skills spec (https://agentskills.io).
 *
 * A skill is a markdown file (SKILL.md) with YAML frontmatter that provides
 * specialized instructions for specific tasks. Skills are discovered from
 * project-local and global directories, then injected into the system prompt
 * as XML metadata that the model can read on demand.
 */

/** YAML frontmatter fields parsed from a SKILL.md file. */
export interface SkillFrontmatter {
	name?: string
	description?: string
	/** If true, the skill is excluded from the system prompt (only invokable explicitly). */
	'disable-model-invocation'?: boolean
	[key: string]: unknown
}

/** A resolved skill ready for prompt injection or tool registration. */
export interface Skill {
	/** Skill identifier (from frontmatter `name`, or parent directory name as fallback). */
	name: string
	/** Human-readable description (required by spec — skill is skipped if missing). */
	description: string
	/** Absolute path to the SKILL.md file. */
	filePath: string
	/** Absolute path to the directory containing the SKILL.md. */
	baseDir: string
	/** Whether to exclude this skill from the automatic system prompt injection. */
	disableModelInvocation: boolean
}

/** Result of loading skills from all configured locations. */
export interface LoadSkillsResult {
	skills: Skill[]
	diagnostics: SkillDiagnostic[]
}

/** Non-fatal issue encountered during skill discovery. */
export interface SkillDiagnostic {
	type: 'warning' | 'collision'
	message: string
	path: string
	collision?: {
		resourceType: 'skill'
		name: string
		winnerPath: string
		loserPath: string
	}
}
