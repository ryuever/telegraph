/**
 * Frontmatter parser for SKILL.md files.
 *
 * Extracts YAML frontmatter delimited by `---` at the top of a markdown file.
 * This is a minimal implementation that does not depend on external YAML libraries;
 * it handles simple key-value pairs with string, number, and boolean values.
 */

/**
 * Parse YAML frontmatter from a markdown string.
 *
 * Supports the standard `---`-delimited block at the start of the file:
 *
 * ```
 * ---
 * name: my-skill
 * description: Does things
 * disable-model-invocation: true
 * ---
 *
 * Body content here...
 * ```
 *
 * Returns an object with the parsed frontmatter fields. If no frontmatter
 * is found, returns an empty object.
 */
export function parseFrontmatter<T extends Record<string, unknown> = Record<string, unknown>>(
	content: string,
): { frontmatter: T; body: string } {
	const trimmed = content.trimStart()

	// Must start with ---
	if (!trimmed.startsWith('---')) {
		return { frontmatter: {} as T, body: content }
	}

	// Find the closing ---
	const endOfFrontmatter = trimmed.indexOf('---', 3)
	if (endOfFrontmatter === -1) {
		return { frontmatter: {} as T, body: content }
	}

	const yamlBlock = trimmed.slice(3, endOfFrontmatter).trim()
	const body = trimmed.slice(endOfFrontmatter + 3).trimStart()

	const frontmatter = parseSimpleYaml<T>(yamlBlock)
	return { frontmatter, body }
}

/**
 * Minimal YAML parser that handles flat key-value pairs.
 * Supports: strings (quoted and unquoted), numbers, booleans.
 */
function parseSimpleYaml<T extends Record<string, unknown> = Record<string, unknown>>(
	yaml: string,
): T {
	const result: Record<string, unknown> = {}

	for (const line of yaml.split(/\r?\n/)) {
		const trimmedLine = line.trim()
		if (!trimmedLine || trimmedLine.startsWith('#')) continue

		const colonIndex = trimmedLine.indexOf(':')
		if (colonIndex === -1) continue

		const key = trimmedLine.slice(0, colonIndex).trim()
		const rawValue = trimmedLine.slice(colonIndex + 1).trim()

		result[key] = parseYamlValue(rawValue)
	}

	return result as T
}

function parseYamlValue(raw: string): unknown {
	if (raw === '') return undefined

	// Quoted strings
	if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
		return raw.slice(1, -1)
	}

	// Booleans
	if (raw === 'true') return true
	if (raw === 'false') return false

	// Numbers
	if (/^-?\d+(\.\d+)?$/.test(raw)) {
		const num = Number(raw)
		if (!Number.isNaN(num)) return num
	}

	return raw
}
