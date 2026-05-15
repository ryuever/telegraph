# skills/

Project-local skills that capture **Telegraph's development conventions and workflows**.

These are written in Claude Code's [skill format](https://docs.claude.com/en/docs/claude-code/skills) (a `SKILL.md` file with frontmatter inside each skill folder), so any agent working on this repo can load them and follow the same rules.

## Layout

```
skills/
├── README.md                          # this file
├── telegraph-conventions/
│   └── SKILL.md                       # umbrella skill — repo-wide coding conventions
├── add-pagelet/
│   └── SKILL.md                       # workflow skill — new app → pagelet wiring
└── <future-skill>/
    └── SKILL.md                       # …more as needed
```

## Skill categories

| Category | What goes here | Example |
|----------|---------------|---------|
| **Conventions** | Coding rules, style, import constraints | `telegraph-conventions/` |
| **Workflows** | Multi-step procedures for common tasks | `add-pagelet/` (new app → pagelet wiring) |

**Conventions** start as sections inside `telegraph-conventions/SKILL.md` and split into their own skill folder only when they become too long or need bundled assets.

**Workflows** always get their own skill folder from the start — they describe a repeatable multi-file procedure (create X files, edit Y configs, verify with Z commands).

## When to add a new convention

Add a new section to `telegraph-conventions/SKILL.md` whenever:

1. You catch yourself (or another agent) making the same mistake twice.
2. The user corrects an approach with a rule that will apply to future work ("we always do X here", "don't do Y, use Z instead").
3. You discover a non-obvious project rule by reading code or commit history that future-you would benefit from being told upfront.

Each convention should follow the **Rule / Why / How to apply** structure (see existing entries in `telegraph-conventions/SKILL.md`) so the next reader can judge edge cases instead of blindly following a rule.

## When NOT to add a convention

- It's already in `AGENTS.md` (the human-facing repo README for agents). Reference it from there instead of duplicating.
- It's a one-off task detail, not a recurring rule.
- It's about external tools (TypeScript / React / Tailwind) with no Telegraph-specific twist — link to upstream docs.
