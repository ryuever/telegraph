import { describe, it, expect } from 'vitest'
import { parseFrontmatter } from '../frontmatter'

describe('parseFrontmatter', () => {
	it('parses simple frontmatter', () => {
		const content = '---\nname: my-skill\ndescription: A test skill\n---\n\nBody content'
		const { frontmatter, body } = parseFrontmatter(content)
		expect(frontmatter.name).toBe('my-skill')
		expect(frontmatter.description).toBe('A test skill')
		expect(body).toBe('Body content')
	})

	it('returns empty frontmatter for content without frontmatter', () => {
		const content = '# Just a markdown file\n\nNo frontmatter here.'
		const { frontmatter, body } = parseFrontmatter(content)
		expect(Object.keys(frontmatter)).toHaveLength(0)
		expect(body).toBe(content)
	})

	it('handles boolean values', () => {
		const content = '---\nname: test\ndisable-model-invocation: true\n---\n\nBody'
		const { frontmatter } = parseFrontmatter(content)
		expect(frontmatter['disable-model-invocation']).toBe(true)
	})

	it('handles quoted string values', () => {
		const content = '---\nname: test\ndescription: "A quoted description"\n---\n\nBody'
		const { frontmatter } = parseFrontmatter(content)
		expect(frontmatter.description).toBe('A quoted description')
	})

	it('handles unclosed frontmatter (no closing ---)', () => {
		const content = '---\nname: test\n\nNo closing delimiter'
		const { frontmatter } = parseFrontmatter(content)
		expect(Object.keys(frontmatter)).toHaveLength(0)
	})

	it('handles empty body', () => {
		const content = '---\nname: test\ndescription: desc\n---\n'
		const { frontmatter, body } = parseFrontmatter(content)
		expect(frontmatter.name).toBe('test')
		expect(body).toBe('')
	})
})
