export {
	loadSkills,
	loadSkillsFromDir,
	formatSkillsForPrompt,
	type LoadSkillsOptions,
	type LoadSkillsFromDirOptions,
} from '@/packages/agent-resources/skills'

export {
	formatSelectedSkillBodiesForPrompt,
	resolveSkillSearchRoot,
	type FormatSelectedSkillBodiesOptions,
} from '@/packages/agent-resources/skills'

export type {
	Skill,
	SkillDiagnostic,
	SkillFrontmatter,
	LoadSkillsResult,
} from '@/packages/agent-resources/skills'
